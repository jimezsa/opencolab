/**
 * Provider CLI adapter for agent responses.
 * Builds prompts, invokes provider CLIs, and normalizes command output/errors.
 */
import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import {
  buildAgentPromptForInput,
  buildPiSystemPromptForInput,
  resolveAgentDirectory,
  resolveSharedSkillsDirectory,
} from "./agent.js";
import { getActiveAgent, getActiveProject } from "./project-config.js";
import {
  buildProviderRuntimeEnv,
  getProviderOauthMissingSessionMessage,
  getProviderOauthSetupHint,
  resolveProviderAuthMode,
} from "./provider.js";
import {
  getProviderApiKeyEnvVar,
  resolveOpenAiOauthStatus,
  resolveProviderApiKey,
} from "./secrets.js";
import type {
  AgentProgressEvent,
  AgentMemoryContext,
  OpenColabState,
  ProviderAuthMode,
  ProviderAgentStreamCallbacks,
  ProviderConfig,
  TelegramFilePayload,
} from "./types.js";
import { ensureDir } from "./utils.js";

const MAX_CLI_CAPTURE_CHARS = 200_000;
const TELEGRAM_PROGRESS_PREFIX = "@telegram-progress";

interface ProviderCliInput {
  prompt: string;
  systemPrompt: string;
  userMessage: string;
}

interface CodexExecJsonEvent {
  type: string;
  item?: Record<string, unknown>;
  delta?: string;
  message?: string;
}

export interface ProviderAgentInput {
  chatId: string;
  sender: string;
  text: string;
  files: TelegramFilePayload[];
  memory: AgentMemoryContext;
}

export class ProviderAgent {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly getState: () => OpenColabState,
  ) {}

  async respond(input: ProviderAgentInput): Promise<string> {
    return this.respondStreaming(input);
  }

  async respondStreaming(
    input: ProviderAgentInput,
    callbacks: ProviderAgentStreamCallbacks = {},
  ): Promise<string> {
    const startedAt = Date.now();
    const state = this.getState();
    const project = getActiveProject(state);
    const agent = getActiveAgent(project);
    const provider = agent.provider;
    const promptStartedAt = Date.now();
    const cliInput = this.buildCliInput(
      agent,
      provider,
      input.memory,
      input.text,
    );
    const promptMs = Date.now() - promptStartedAt;

    if (this.config.forceMockCodex) {
      this.logPerf(
        promptMs,
        0,
        Date.now() - startedAt,
        provider.name,
        provider.model,
      );
      return this.mockResponse(provider.name, provider.model, input.text);
    }

    const cliStartedAt = Date.now();
    const output = await this.runProviderCli(
      cliInput,
      provider,
      project.path,
      agent.path,
      callbacks,
    );
    const cliMs = Date.now() - cliStartedAt;
    this.logPerf(
      promptMs,
      cliMs,
      Date.now() - startedAt,
      provider.name,
      provider.model,
    );
    return output;
  }

  private runProviderCli(
    input: ProviderCliInput,
    provider: ProviderConfig,
    projectPath: string,
    agentPath: string,
    callbacks: ProviderAgentStreamCallbacks,
  ): Promise<string> {
    const authMode = resolveProviderAuthMode(provider.name, provider.authMode);
    const canonicalKeyName = getProviderApiKeyEnvVar(provider.name);
    let apiKey: string | null = null;
    if (authMode === "api_key") {
      apiKey = resolveProviderApiKey(provider.name);
      if (!apiKey) {
        throw new Error(
          `Missing required provider API key (${canonicalKeyName}). Set it in .env.local or in the shell environment.`,
        );
      }
    }

    if (provider.name === "openai" && authMode === "oauth") {
      const oauthStatus = resolveOpenAiOauthStatus(provider.cliCommand);
      if (!oauthStatus.authenticated) {
        throw new Error(
          getProviderOauthMissingSessionMessage(
            provider.name,
            provider.cliCommand,
            oauthStatus.detail,
          ),
        );
      }
    }

    const cwd = resolveAgentDirectory(this.config.rootDir, agentPath);
    const projectDir = resolveAgentDirectory(this.config.rootDir, projectPath);
    const sharedSkillsDir = resolveSharedSkillsDirectory(this.config.rootDir);
    const resolvedArgs = provider.cliArgs.map((arg: string) =>
      replaceCliArgTokens(arg, {
        "{provider}": provider.name,
        "{runtime_provider}": provider.name,
        "{model}": provider.model,
        "{project_dir}": projectDir,
        "{shared_skills_dir}": sharedSkillsDir,
        "{agent_dir}": cwd,
        "{prompt}": input.prompt,
        "{system_prompt}": input.systemPrompt,
        "{user_message}": input.userMessage,
      }),
    );
    const promptProvidedInArgs = provider.cliArgs.some(
      (arg: string) =>
        arg.includes("{prompt}") ||
        arg.includes("{system_prompt}") ||
        arg.includes("{user_message}"),
    );
    const codexJsonMode = usesCodexJsonEventStream(provider);
    const cliArgs = codexJsonMode
      ? addCodexJsonFlag(resolvedArgs)
      : resolvedArgs;
    const providerLabel = provider.name.replaceAll("_", " ");
    return new Promise<string>((resolve, reject) => {
      const providerEnv = buildProviderRuntimeEnv(
        process.env,
        provider.name,
        authMode,
        apiKey,
        provider.model,
      );
      if (provider.runtime === "pi") {
        ensureDir(this.config.piAgentDir);
        providerEnv.PI_CODING_AGENT_DIR = this.config.piAgentDir;
        providerEnv.PI_OFFLINE = "1";
      }
      const child = spawn(provider.cliCommand, cliArgs, {
        cwd,
        env: {
          ...providerEnv,
          OPENCOLAB_MODEL: provider.model,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let pendingStdoutLine = "";
      let stdoutProcessing = Promise.resolve();
      let settled = false;

      const appendLimited = (
        current: string,
        chunkText: string,
      ): { next: string; truncated: boolean } => {
        const nextRaw = current + chunkText;
        if (nextRaw.length <= MAX_CLI_CAPTURE_CHARS) {
          return { next: nextRaw, truncated: false };
        }
        return {
          next: nextRaw.slice(nextRaw.length - MAX_CLI_CAPTURE_CHARS),
          truncated: true,
        };
      };

      const appendStdoutText = async (chunkText: string): Promise<void> => {
        if (!chunkText) {
          return;
        }
        const result = appendLimited(stdout, chunkText);
        stdout = result.next;
        stdoutTruncated = stdoutTruncated || result.truncated;
        try {
          await callbacks.onFinalTextChunk?.(chunkText);
        } catch {
          // Final-text chunk delivery is best-effort.
        }
      };

      const emitProgress = async (event: AgentProgressEvent): Promise<void> => {
        try {
          await callbacks.onProgress?.(event);
        } catch {
          // Progress delivery is best-effort.
        }
      };

      const replaceStdoutText = (nextText: string): void => {
        const result = appendLimited("", nextText);
        stdout = result.next;
        stdoutTruncated = result.truncated;
      };

      const processStdoutLine = async (
        lineText: string,
        rawText: string,
      ): Promise<void> => {
        if (codexJsonMode) {
          const codexEvent = parseCodexExecJsonEvent(lineText);
          if (codexEvent) {
            const progressEvent = deriveProgressEventFromCodexExecEvent(
              codexEvent,
            );
            if (progressEvent) {
              await emitProgress(progressEvent);
            }

            const agentMessageText = extractCodexAgentMessageText(codexEvent);
            if (agentMessageText !== null) {
              replaceStdoutText(stripProgressControlLines(agentMessageText));
            }
            return;
          }
        }

        const progressEvent = parseAgentProgressLine(lineText);
        if (progressEvent) {
          await emitProgress(progressEvent);
          return;
        }
        if (looksLikeProgressControlLine(lineText)) {
          return;
        }
        await appendStdoutText(rawText);
      };

      const processStdoutChunk = async (chunkText: string): Promise<void> => {
        pendingStdoutLine += chunkText;
        while (true) {
          const newlineIndex = pendingStdoutLine.indexOf("\n");
          if (newlineIndex < 0) {
            return;
          }

          const rawLine = pendingStdoutLine.slice(0, newlineIndex + 1);
          pendingStdoutLine = pendingStdoutLine.slice(newlineIndex + 1);
          const lineText = rawLine.endsWith("\r\n")
            ? rawLine.slice(0, -2)
            : rawLine.slice(0, -1);
          await processStdoutLine(lineText, rawLine);
        }
      };

      const flushPendingStdout = async (): Promise<void> => {
        if (!pendingStdoutLine) {
          return;
        }

        const rawLine = pendingStdoutLine;
        pendingStdoutLine = "";
        const lineText = rawLine.endsWith("\r")
          ? rawLine.slice(0, -1)
          : rawLine;
        await processStdoutLine(lineText, rawLine);
      };

      const finish = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        handler();
      };

      const timeoutHandle = setTimeout(
        () => {
          child.kill("SIGKILL");
          finish(() =>
            reject(new Error(normalizeProviderCliTimeout(provider, authMode))),
          );
        },
        Math.max(this.config.codexTimeoutMs, 1000),
      );

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutProcessing = stdoutProcessing.then(() =>
          processStdoutChunk(chunk.toString("utf8")),
        );
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const result = appendLimited(stderr, chunk.toString("utf8"));
        stderr = result.next;
        stderrTruncated = stderrTruncated || result.truncated;
      });

      child.on("error", (error) => {
        finish(() =>
          reject(normalizeProviderCliSpawnError(provider, authMode, error)),
        );
      });

      child.on("close", (code) => {
        const finalizeClose = async (): Promise<void> => {
          await stdoutProcessing;
          await flushPendingStdout();

          if (code === 0) {
            const response = stdout.trim();
            const suffix = stdoutTruncated ? " (truncated)" : "";
            finish(() =>
              resolve(
                response ||
                  `(empty response from ${providerLabel} CLI)${suffix}`,
              ),
            );
            return;
          }

          const fallback = `${providerLabel} CLI exited with code ${String(code)}`;
          const message = `${stderr.trim() || fallback}${stderrTruncated ? " (stderr truncated)" : ""}`;
          finish(() =>
            reject(
              new Error(normalizeProviderCliError(provider, authMode, message)),
            ),
          );
        };

        void finalizeClose().catch((error) => {
          const detail =
            error instanceof Error ? error : new Error(String(error));
          finish(() => reject(detail));
        });
      });

      if (promptProvidedInArgs) {
        child.stdin.end();
        return;
      }

      child.stdin.write(input.prompt);
      child.stdin.end();
    });
  }

  private buildCliInput(
    agent: ReturnType<typeof getActiveAgent>,
    provider: ProviderConfig,
    memory: AgentMemoryContext,
    userMessage: string,
  ): ProviderCliInput {
    const prompt = buildAgentPromptForInput(
      this.config.rootDir,
      agent,
      memory,
      userMessage,
    );
    if (provider.runtime === "pi") {
      return {
        prompt,
        systemPrompt: buildPiSystemPromptForInput(
          this.config.rootDir,
          agent,
          memory,
        ),
        userMessage,
      };
    }

    return {
      prompt,
      systemPrompt: "",
      userMessage,
    };
  }

  private logPerf(
    promptMs: number,
    cliMs: number,
    totalMs: number,
    providerName: string,
    model: string,
  ): void {
    if (process.env.OPENCOLAB_TRACE_PERF !== "1") {
      return;
    }
    console.log(
      `[opencolab:perf] provider=${providerName} model=${model} prompt_ms=${promptMs} cli_ms=${cliMs} total_ms=${totalMs}`,
    );
  }

  private mockResponse(
    providerName: string,
    model: string,
    text: string,
  ): string {
    return [
      `[mock-${providerName}:${model}]`,
      "This is a simulated response from the OpenColab research agent.",
      `Question: ${text}`,
    ].join("\n");
  }
}

export function parseAgentProgressLine(
  line: string,
): AgentProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TELEGRAM_PROGRESS_PREFIX)) {
    return null;
  }

  const payloadRaw = trimmed.slice(TELEGRAM_PROGRESS_PREFIX.length).trim();
  if (!payloadRaw) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    return normalizeAgentProgressEvent(payload);
  } catch {
    return null;
  }
}

function normalizeProviderCliError(
  provider: ProviderConfig,
  authMode: ProviderAuthMode,
  message: string,
): string {
  if (provider.name !== "gemini" || authMode !== "oauth") {
    return message;
  }

  const normalized = message.toLowerCase();
  if (
    normalized.includes("login with google") ||
    normalized.includes("not authenticated") ||
    normalized.includes("authentication") ||
    normalized.includes("credential") ||
    normalized.includes("gemini_api_key") ||
    normalized.includes("google_api_key")
  ) {
    return getProviderOauthMissingSessionMessage(
      provider.name,
      provider.cliCommand,
      message,
    );
  }

  return message;
}

function normalizeProviderCliTimeout(
  provider: ProviderConfig,
  authMode: ProviderAuthMode,
): string {
  const providerLabel = provider.name.replaceAll("_", " ");
  if (provider.name === "gemini" && authMode === "oauth") {
    return `${providerLabel} CLI timed out. ${getProviderOauthSetupHint(provider.name, provider.cliCommand)}`;
  }
  return `${providerLabel} CLI timed out`;
}

function normalizeProviderCliSpawnError(
  provider: ProviderConfig,
  authMode: ProviderAuthMode,
  error: Error,
): Error {
  const spawnError = error as NodeJS.ErrnoException;
  const providerLabel = provider.name.replaceAll("_", " ");
  if (spawnError.code === "ENOENT") {
    return new Error(
      `${providerLabel} CLI is not installed or not available on PATH. Install '${provider.cliCommand}' and retry.`,
    );
  }
  if (spawnError.code === "EACCES") {
    return new Error(
      `${providerLabel} CLI is not executable. Fix '${provider.cliCommand}' permissions and retry.`,
    );
  }

  const message = error.message?.trim();
  if (message) {
    return new Error(normalizeProviderCliError(provider, authMode, message));
  }

  return new Error(`${providerLabel} CLI failed to start`);
}

function replaceCliArgTokens(
  arg: string,
  replacements: Record<string, string>,
): string {
  let next = arg;
  for (const [token, value] of Object.entries(replacements)) {
    next = next.replaceAll(token, value);
  }
  return next;
}

function usesCodexJsonEventStream(provider: ProviderConfig): boolean {
  return provider.runtime === "codex" && provider.cliCommand === "codex";
}

function addCodexJsonFlag(args: string[]): string[] {
  if (args.includes("--json")) {
    return args;
  }
  if (args[0] === "exec") {
    return [args[0], "--json", ...args.slice(1)];
  }
  return ["--json", ...args];
}

function looksLikeProgressControlLine(line: string): boolean {
  return line.trim().startsWith(TELEGRAM_PROGRESS_PREFIX);
}

export function parseCodexExecJsonEvent(
  line: string,
): CodexExecJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof payload.type === "string"
      ? {
          type: payload.type,
          ...(isRecord(payload.item) ? { item: payload.item } : {}),
          ...(typeof payload.delta === "string" ? { delta: payload.delta } : {}),
          ...(typeof payload.message === "string"
            ? { message: payload.message }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

export function deriveProgressEventFromCodexExecEvent(
  event: CodexExecJsonEvent,
): AgentProgressEvent | null {
  if (event.type === "turn.started") {
    return {
      phase: "planning",
      message: "Planning approach",
    };
  }

  if (event.type !== "item.started" || !event.item) {
    return null;
  }

  const itemType = asString(event.item.type);
  if (itemType === "command_execution") {
    const command = asString(event.item.command);
    return command ? progressEventFromCommand(command) : null;
  }

  if (itemType === "web_search_call") {
    return {
      phase: "searching",
      message: "Searching sources",
    };
  }

  return null;
}

function extractCodexAgentMessageText(event: CodexExecJsonEvent): string | null {
  if (event.type !== "item.completed" || !event.item) {
    return null;
  }

  const itemType = asString(event.item.type);
  if (itemType !== "agent_message") {
    return null;
  }

  return asString(event.item.text);
}

function progressEventFromCommand(command: string): AgentProgressEvent {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("papercli") && lower.includes("search")) {
    return {
      phase: "searching",
      message: "Searching papers",
    };
  }

  if (
    lower.includes("wget ") ||
    lower.includes("curl ") ||
    lower.includes("download") ||
    lower.includes("fetch")
  ) {
    return {
      phase: "downloading",
      message: "Downloading sources",
    };
  }

  if (
    lower.includes("rg ") ||
    lower.includes("grep ") ||
    lower.includes("find ") ||
    lower.includes("fd ")
  ) {
    return {
      phase: "reading",
      message: "Scanning files and evidence",
    };
  }

  if (
    lower.includes("cat ") ||
    lower.includes("sed ") ||
    lower.includes("head ") ||
    lower.includes("tail ") ||
    lower.includes("less ") ||
    lower.includes("ls ")
  ) {
    return {
      phase: "reading",
      message: "Inspecting files",
    };
  }

  if (
    lower.includes("pytest") ||
    lower.includes("pnpm test") ||
    lower.includes("go test") ||
    lower.includes("npm test")
  ) {
    return {
      phase: "info",
      message: "Running tests",
    };
  }

  return {
    phase: "info",
    message: `Running command: ${summarizeCommand(normalized)}`,
  };
}

function summarizeCommand(command: string): string {
  if (command.length <= 80) {
    return command;
  }
  return `${command.slice(0, 77).trimEnd()}...`;
}

function stripProgressControlLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !looksLikeProgressControlLine(line))
    .join("\n")
    .trim();
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeAgentProgressEvent(
  source: Record<string, unknown>,
): AgentProgressEvent | null {
  const phase = normalizeProgressPhase(source.phase);
  const message =
    typeof source.message === "string" ? source.message.trim() : "";
  if (!phase || !message) {
    return null;
  }

  const items = Array.isArray(source.items)
    ? source.items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
  const done = source.done === true;

  return {
    phase,
    message,
    ...(items && items.length > 0 ? { items } : {}),
    ...(done ? { done } : {}),
  };
}

function normalizeProgressPhase(
  value: unknown,
): AgentProgressEvent["phase"] | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  switch (normalized) {
    case "planning":
      return "planning";
    case "searching":
      return "searching";
    case "downloading":
      return "downloading";
    case "reading":
      return "reading";
    case "summarizing":
      return "summarizing";
    case "drafting":
      return "drafting";
    case "done":
      return "done";
    case "info":
      return "info";
    default:
      return null;
  }
}
