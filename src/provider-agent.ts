/**
 * Provider CLI adapter for agent responses.
 * Builds prompts, invokes provider CLIs, and normalizes command output/errors.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { OpenColabConfig } from "./config.js";
import {
  buildAgentPromptForInput,
  buildPiSystemPromptForInput,
  resolveAgentDirectory,
  resolveSharedSkillsDirectory
} from "./agent.js";
import { getActiveAgent, getActiveProject } from "./project-config.js";
import {
  buildProviderRuntimeEnv,
  getProviderOauthMissingSessionMessage,
  getProviderOauthSetupHint,
  resolveProviderAuthMode
} from "./provider.js";
import { getProviderApiKeyEnvVar, resolveOpenAiOauthStatus, resolveProviderApiKey } from "./secrets.js";
import type {
  AgentMemoryContext,
  OpenColabState,
  ProviderAuthMode,
  ProviderConfig,
  TaskProgressEvent,
  TelegramFilePayload
} from "./types.js";
import { ensureDir } from "./utils.js";

const MAX_CLI_CAPTURE_CHARS = 200_000;
const PROGRESS_ENV_VAR = "OPENCOLAB_PROGRESS_FILE";
const PROGRESS_POLL_INTERVAL_MS = 400;

interface ProviderCliInput {
  prompt: string;
  systemPrompt: string;
  userMessage: string;
}

export interface ProviderAgentInput {
  chatId: string;
  sender: string;
  text: string;
  files: TelegramFilePayload[];
  memory: AgentMemoryContext;
}

export interface ProviderRespondOptions {
  onProgress?: (event: TaskProgressEvent) => void | Promise<void>;
}

export class ProviderAgent {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly getState: () => OpenColabState
  ) {}

  async respond(
    input: ProviderAgentInput,
    options: ProviderRespondOptions = {},
  ): Promise<string> {
    const startedAt = Date.now();
    const state = this.getState();
    const project = getActiveProject(state);
    const agent = getActiveAgent(project);
    const provider = agent.provider;
    const promptStartedAt = Date.now();
    const cliInput = this.buildCliInput(agent, project.path, provider, input.memory, input.text);
    const promptMs = Date.now() - promptStartedAt;

    if (this.config.forceMockCodex) {
      this.logPerf(promptMs, 0, Date.now() - startedAt, provider.name, provider.model);
      return this.mockResponse(provider.name, provider.model, input.text);
    }

    const cliStartedAt = Date.now();
    const output = await this.runProviderCli(
      cliInput,
      provider,
      project.path,
      agent.path,
      options,
    );
    const cliMs = Date.now() - cliStartedAt;
    this.logPerf(promptMs, cliMs, Date.now() - startedAt, provider.name, provider.model);
    return output;
  }

  private runProviderCli(
    input: ProviderCliInput,
    provider: ProviderConfig,
    projectPath: string,
    agentPath: string,
    options: ProviderRespondOptions
  ): Promise<string> {
    const authMode = resolveProviderAuthMode(provider.name, provider.authMode);
    const canonicalKeyName = getProviderApiKeyEnvVar(provider.name);
    let apiKey: string | null = null;
    if (authMode === "api_key") {
      apiKey = resolveProviderApiKey(provider.name);
      if (!apiKey) {
        throw new Error(
          `Missing required provider API key (${canonicalKeyName}). Set it in .env.local or in the shell environment.`
        );
      }
    }

    if (provider.name === "openai" && authMode === "oauth") {
      const oauthStatus = resolveOpenAiOauthStatus(provider.cliCommand);
      if (!oauthStatus.authenticated) {
        throw new Error(
          getProviderOauthMissingSessionMessage(provider.name, provider.cliCommand, oauthStatus.detail)
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
        "{user_message}": input.userMessage
      })
    );
    const promptProvidedInArgs = provider.cliArgs.some(
      (arg: string) =>
        arg.includes("{prompt}") || arg.includes("{system_prompt}") || arg.includes("{user_message}")
    );
    const cliArgs = resolvedArgs;
    const providerLabel = provider.name.replaceAll("_", " ");
    const progressFilePath = buildProgressFilePath(cwd);
    const progressRelay = startProgressRelay(progressFilePath, options.onProgress);
    return new Promise<string>((resolve, reject) => {
      const providerEnv = buildProviderRuntimeEnv(
        process.env,
        provider.name,
        authMode,
        apiKey,
        provider.model
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
          [PROGRESS_ENV_VAR]: progressFilePath
        },
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;

      const appendLimited = (current: string, chunk: Buffer): { next: string; truncated: boolean } => {
        const nextRaw = current + chunk.toString("utf8");
        if (nextRaw.length <= MAX_CLI_CAPTURE_CHARS) {
          return { next: nextRaw, truncated: false };
        }
        return { next: nextRaw.slice(nextRaw.length - MAX_CLI_CAPTURE_CHARS), truncated: true };
      };

      const finish = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        void finalizeProgressRelay(progressRelay, progressFilePath).finally(handler);
      };

      const timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error(normalizeProviderCliTimeout(provider, authMode))));
      }, Math.max(this.config.codexTimeoutMs, 1000));

      child.stdout.on("data", (chunk: Buffer) => {
        const result = appendLimited(stdout, chunk);
        stdout = result.next;
        stdoutTruncated = stdoutTruncated || result.truncated;
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const result = appendLimited(stderr, chunk);
        stderr = result.next;
        stderrTruncated = stderrTruncated || result.truncated;
      });

      child.on("error", (error) => {
        finish(() => reject(normalizeProviderCliSpawnError(provider, authMode, error)));
      });

      child.on("close", (code) => {
        if (code === 0) {
          const response = stdout.trim();
          const suffix = stdoutTruncated ? " (truncated)" : "";
          finish(() => resolve(response || `(empty response from ${providerLabel} CLI)${suffix}`));
          return;
        }

        const fallback = `${providerLabel} CLI exited with code ${String(code)}`;
        const message = `${stderr.trim() || fallback}${stderrTruncated ? " (stderr truncated)" : ""}`;
        finish(() => reject(new Error(normalizeProviderCliError(provider, authMode, message))));
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
    projectPath: string,
    provider: ProviderConfig,
    memory: AgentMemoryContext,
    userMessage: string
  ): ProviderCliInput {
    const prompt = buildAgentPromptForInput(
      this.config.rootDir,
      agent,
      memory,
      userMessage,
      projectPath
    );
    if (provider.runtime === "pi") {
      return {
        prompt,
        systemPrompt: buildPiSystemPromptForInput(this.config.rootDir, agent, memory, projectPath),
        userMessage
      };
    }

    return {
      prompt,
      systemPrompt: "",
      userMessage
    };
  }

  private logPerf(
    promptMs: number,
    cliMs: number,
    totalMs: number,
    providerName: string,
    model: string
  ): void {
    if (process.env.OPENCOLAB_TRACE_PERF !== "1") {
      return;
    }
    console.log(
      `[opencolab:perf] provider=${providerName} model=${model} prompt_ms=${promptMs} cli_ms=${cliMs} total_ms=${totalMs}`
    );
  }

  private mockResponse(providerName: string, model: string, text: string): string {
    return [
      `[mock-${providerName}:${model}]`,
      "This is a simulated response from the OpenColab research agent.",
      `Question: ${text}`
    ].join("\n");
  }
}

function buildProgressFilePath(agentDir: string): string {
  const progressDir = path.join(agentDir, ".opencolab-progress");
  ensureDir(progressDir);
  return path.join(
    progressDir,
    `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}.jsonl`
  );
}

function startProgressRelay(
  filePath: string,
  onProgress?: (event: TaskProgressEvent) => void | Promise<void>
): {
  flush: () => Promise<void>;
  stop: () => void;
} {
  fs.writeFileSync(filePath, "", "utf8");

  if (!onProgress) {
    return {
      flush: async () => undefined,
      stop: () => undefined
    };
  }

  let offset = 0;
  let buffer = "";
  let timer: NodeJS.Timeout | null = null;
  let reading: Promise<void> | null = null;
  let stopped = false;

  const emitLine = async (line: string): Promise<void> => {
    const event = parseTaskProgressEvent(line);
    if (!event) {
      return;
    }
    await onProgress(event);
  };

  const consume = async (): Promise<void> => {
    if (stopped || reading) {
      return reading ?? undefined;
    }

    reading = (async () => {
      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        const code = getErrorCode(error);
        if (code === "ENOENT") {
          return;
        }
        throw error;
      }

      if (content.length < offset) {
        offset = 0;
        buffer = "";
      }

      const chunk = content.slice(offset);
      offset = content.length;
      if (!chunk) {
        return;
      }

      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          await emitLine(line);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    })().finally(() => {
      reading = null;
    });

    return reading;
  };

  timer = setInterval(() => {
    void consume();
  }, PROGRESS_POLL_INTERVAL_MS);

  return {
    flush: async () => {
      await consume();
      const finalLine = buffer.trim();
      buffer = "";
      if (finalLine) {
        await emitLine(finalLine);
      }
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

async function finalizeProgressRelay(
  relay: { flush: () => Promise<void>; stop: () => void },
  filePath: string
): Promise<void> {
  try {
    await relay.flush();
  } catch {
    // Progress forwarding is best-effort.
  } finally {
    relay.stop();
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      const code = getErrorCode(error);
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function parseTaskProgressEvent(raw: string): TaskProgressEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeTaskProgressEvent(parsed);
  } catch {
    return null;
  }
}

function normalizeTaskProgressEvent(source: Record<string, unknown>): TaskProgressEvent | null {
  const kind = asProgressKind(source.kind);
  const message = asProgressString(source.message);
  if (!kind || !message) {
    return null;
  }

  const current = asOptionalProgressNumber(source.current);
  const total = asOptionalProgressNumber(source.total);
  const stage = asProgressString(source.stage);
  const slot = asProgressString(source.slot);
  return {
    kind,
    message,
    ...(stage ? { stage } : {}),
    ...(current !== null ? { current } : {}),
    ...(total !== null ? { total } : {}),
    ...(slot ? { slot } : {}),
    ...(typeof source.ephemeral === "boolean" ? { ephemeral: source.ephemeral } : {})
  };
}

function asProgressKind(value: unknown): TaskProgressEvent["kind"] | null {
  const normalized = asProgressString(value);
  if (
    normalized !== "started" &&
    normalized !== "milestone" &&
    normalized !== "progress" &&
    normalized !== "warning" &&
    normalized !== "needs_input" &&
    normalized !== "completed"
  ) {
    return null;
  }
  return normalized;
}

function asProgressString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asOptionalProgressNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function normalizeProviderCliError(
  provider: ProviderConfig,
  authMode: ProviderAuthMode,
  message: string
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
    return getProviderOauthMissingSessionMessage(provider.name, provider.cliCommand, message);
  }

  return message;
}

function normalizeProviderCliTimeout(provider: ProviderConfig, authMode: ProviderAuthMode): string {
  const providerLabel = provider.name.replaceAll("_", " ");
  if (provider.name === "gemini" && authMode === "oauth") {
    return `${providerLabel} CLI timed out. ${getProviderOauthSetupHint(provider.name, provider.cliCommand)}`;
  }
  return `${providerLabel} CLI timed out`;
}

function normalizeProviderCliSpawnError(
  provider: ProviderConfig,
  authMode: ProviderAuthMode,
  error: Error
): Error {
  const spawnError = error as NodeJS.ErrnoException;
  const providerLabel = provider.name.replaceAll("_", " ");
  if (spawnError.code === "ENOENT") {
    return new Error(
      `${providerLabel} CLI is not installed or not available on PATH. Install '${provider.cliCommand}' and retry.`
    );
  }
  if (spawnError.code === "EACCES") {
    return new Error(
      `${providerLabel} CLI is not executable. Fix '${provider.cliCommand}' permissions and retry.`
    );
  }

  const message = error.message?.trim();
  if (message) {
    return new Error(normalizeProviderCliError(provider, authMode, message));
  }

  return new Error(`${providerLabel} CLI failed to start`);
}

function replaceCliArgTokens(arg: string, replacements: Record<string, string>): string {
  let next = arg;
  for (const [token, value] of Object.entries(replacements)) {
    next = next.replaceAll(token, value);
  }
  return next;
}
