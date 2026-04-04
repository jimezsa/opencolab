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
  buildProviderInvocationArgs,
  buildProviderRuntimeEnv,
  getProviderOauthMissingSessionMessage,
  getProviderOauthSetupHint,
  getProviderRuntimeProviderName,
  resolveProviderAuthMode
} from "./provider.js";
import {
  getProviderApiKeyEnvVar,
  resolveAnthropicOauthStatus,
  resolveOpenAiOauthStatus,
  resolveProviderApiKey
} from "./secrets.js";
import type {
  AgentMemoryContext,
  OpenColabState,
  ProviderAuthMode,
  ProviderConfig,
  ProviderRuntime,
  TaskProgressEvent,
  TelegramFilePayload
} from "./types.js";
import { ensureDir } from "./utils.js";

const MAX_CLI_CAPTURE_CHARS = 200_000;

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

    if (provider.name === "anthropic" && authMode === "oauth") {
      const oauthStatus = resolveAnthropicOauthStatus(provider.cliCommand);
      if (!oauthStatus.authenticated) {
        throw new Error(
          getProviderOauthMissingSessionMessage(provider.name, provider.cliCommand, oauthStatus.detail)
        );
      }
    }

    const cwd = resolveAgentDirectory(this.config.rootDir, agentPath);
    const projectDir = resolveAgentDirectory(this.config.rootDir, projectPath);
    const sharedSkillsDir = resolveSharedSkillsDirectory(this.config.rootDir);
    const invocationArgs = buildProviderInvocationArgs(provider);
    const outputFilePath = invocationArgs.some((arg: string) => arg.includes("{output_file}"))
      ? buildProviderOutputFilePath(cwd)
      : "";
    const resolvedArgs = invocationArgs.map((arg: string) =>
      replaceCliArgTokens(arg, {
        "{provider}": provider.name,
        "{runtime_provider}": getProviderRuntimeProviderName(provider.name),
        "{model}": provider.model,
        "{project_dir}": projectDir,
        "{shared_skills_dir}": sharedSkillsDir,
        "{agent_dir}": cwd,
        "{prompt}": input.prompt,
        "{system_prompt}": input.systemPrompt,
        "{user_message}": input.userMessage,
        "{output_file}": outputFilePath
      })
    );
    const promptProvidedInArgs = invocationArgs.some(
      (arg: string) =>
        arg.includes("{prompt}") || arg.includes("{system_prompt}") || arg.includes("{user_message}")
    );
    const cliArgs = resolvedArgs;
    const providerLabel = provider.name.replaceAll("_", " ");
    const streamState = createProviderStreamState(provider, outputFilePath || null, options.onProgress);
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
          OPENCOLAB_MODEL: provider.model
        },
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;
      let streamQueue = Promise.resolve();

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
        void Promise.resolve(streamQueue)
          .finally(() => finalizeProviderStreamState(streamState))
          .finally(handler);
      };

      const timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error(normalizeProviderCliTimeout(provider, authMode))));
      }, Math.max(this.config.providerCliTimeoutMs, 1000));

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        const result = appendLimited(stdout, chunk);
        stdout = result.next;
        stdoutTruncated = stdoutTruncated || result.truncated;
        stdoutBuffer += text;
        streamQueue = streamQueue
          .then(async () => {
            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex >= 0) {
              const line = stdoutBuffer.slice(0, newlineIndex).trim();
              stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
              if (line) {
                await consumeProviderStreamLine(provider.runtime, line, streamState);
              }
              newlineIndex = stdoutBuffer.indexOf("\n");
            }
          })
          .catch(() => undefined);
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
          streamQueue = streamQueue
            .then(async () => {
              const finalLine = stdoutBuffer.trim();
              stdoutBuffer = "";
              if (finalLine) {
                await consumeProviderStreamLine(provider.runtime, finalLine, streamState);
              }
            })
            .catch(() => undefined);
          const response = resolveProviderCliResponse(provider, streamState, stdout).trim();
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

interface ProviderStreamState {
  readonly outputFilePath: string | null;
  readonly onProgress?: (event: TaskProgressEvent) => void | Promise<void>;
  finalResponse: string | null;
  assistantText: string;
  sawStructuredOutput: boolean;
  lastProgressKey: string | null;
  started: boolean;
}

function buildProviderOutputFilePath(agentDir: string): string {
  const outputDir = path.join(agentDir, ".opencolab-provider-output");
  ensureDir(outputDir);
  return path.join(
    outputDir,
    `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}.txt`
  );
}

function createProviderStreamState(
  provider: ProviderConfig,
  outputFilePath: string | null,
  onProgress?: (event: TaskProgressEvent) => void | Promise<void>
): ProviderStreamState {
  void provider;
  return {
    outputFilePath,
    onProgress,
    finalResponse: null,
    assistantText: "",
    sawStructuredOutput: false,
    lastProgressKey: null,
    started: false
  };
}

async function finalizeProviderStreamState(state: ProviderStreamState): Promise<void> {
  if (!state.outputFilePath) {
    return;
  }
  try {
    fs.unlinkSync(state.outputFilePath);
  } catch (error) {
    const code = getErrorCode(error);
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function resolveProviderCliResponse(
  provider: ProviderConfig,
  state: ProviderStreamState,
  stdoutFallback: string
): string {
  const outputFileResponse = readProviderOutputFile(state.outputFilePath);
  if (outputFileResponse) {
    return outputFileResponse;
  }
  if (state.finalResponse?.trim()) {
    return state.finalResponse.trim();
  }
  if (state.assistantText.trim()) {
    return state.assistantText.trim();
  }
  if (state.sawStructuredOutput) {
    return "";
  }
  return stdoutFallback.trim();
}

function readProviderOutputFile(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    return content || null;
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function consumeProviderStreamLine(
  runtime: ProviderRuntime,
  rawLine: string,
  state: ProviderStreamState
): Promise<void> {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  const parsed = parseJsonObject(line);
  if (!parsed) {
    return;
  }

  state.sawStructuredOutput = true;

  switch (runtime) {
    case "claude":
      await consumeClaudeStreamEvent(parsed, state);
      return;
    case "gemini":
      await consumeGeminiStreamEvent(parsed, state);
      return;
    case "pi":
      await consumePiStreamEvent(parsed, state);
      return;
    case "codex":
      await consumeCodexStreamEvent(parsed, state);
      return;
    default:
      return;
  }
}

async function consumeClaudeStreamEvent(
  parsed: Record<string, unknown>,
  state: ProviderStreamState
): Promise<void> {
  const type = asProgressString(parsed.type);
  const subtype = asProgressString(parsed.subtype);

  if (type === "system" && subtype === "init") {
    await emitProviderProgress(state, {
      kind: "started",
      stage: "inspect",
      slot: "inspect",
      message: "Inspecting the project."
    });
    return;
  }

  if (type === "assistant") {
    const assistantMessage = asRecord(parsed.message);
    const content = asArray(assistantMessage?.content);
    const toolProgress = extractAssistantToolProgress(content);
    if (toolProgress) {
      await emitProviderProgress(state, toolProgress);
    }
    const text = extractAssistantText(content);
    if (text) {
      state.assistantText = text;
    }
    return;
  }

  if (type === "result") {
    const resultText =
      asProgressString(parsed.result) ??
      asProgressString(parsed.response) ??
      state.assistantText;
    if (resultText) {
      state.finalResponse = resultText;
    }
    await emitProviderProgress(state, {
      kind: "completed",
      stage: "finalize",
      slot: "finalize",
      message: "Preparing the final answer."
    });
  }
}

async function consumeGeminiStreamEvent(
  parsed: Record<string, unknown>,
  state: ProviderStreamState
): Promise<void> {
  const type = asProgressString(parsed.type);
  if (!type) {
    return;
  }

  if (type === "init") {
    await emitProviderProgress(state, {
      kind: "started",
      stage: "inspect",
      slot: "inspect",
      message: "Inspecting the project."
    });
    return;
  }

  if (type === "tool_use") {
    const toolName = asProgressString(parsed.tool_name);
    const progress = describeToolProgress(toolName, asRecord(parsed.parameters));
    if (progress) {
      await emitProviderProgress(state, progress);
    }
    return;
  }

  if (type === "tool_result") {
    if (asProgressString(parsed.status) === "error") {
      await emitProviderProgress(state, {
        kind: "warning",
        stage: "warning",
        slot: "warning",
        message:
          asProgressString(asRecord(parsed.error)?.message) ??
          "A tool reported an issue during execution."
      });
    }
    return;
  }

  if (type === "message" && asProgressString(parsed.role) === "assistant") {
    const content = asProgressString(parsed.content);
    if (content && parsed.delta === true) {
      state.assistantText += content;
    } else if (content) {
      state.assistantText = content;
    }
    return;
  }

  if (type === "error") {
    const severity = asProgressString(parsed.severity);
    const message = asProgressString(parsed.message);
    if (message && severity === "warning") {
      await emitProviderProgress(state, {
        kind: "warning",
        stage: "warning",
        slot: "warning",
        message
      });
    }
    return;
  }

  if (type === "result") {
    state.finalResponse = state.assistantText.trim() || state.finalResponse;
    await emitProviderProgress(state, {
      kind: "completed",
      stage: "finalize",
      slot: "finalize",
      message: "Preparing the final answer."
    });
  }
}

async function consumePiStreamEvent(
  parsed: Record<string, unknown>,
  state: ProviderStreamState
): Promise<void> {
  const type = asProgressString(parsed.type);
  if (!type) {
    return;
  }

  if (type === "session") {
    return;
  }

  if (type === "agent_start" || type === "turn_start") {
    if (!state.started) {
      await emitProviderProgress(state, {
        kind: "started",
        stage: "inspect",
        slot: "inspect",
        message: "Inspecting the project."
      });
    }
    return;
  }

  if (type === "tool_execution_start") {
    const toolName = asProgressString(parsed.toolName);
    const progress = describeToolProgress(toolName, asRecord(parsed.args));
    if (progress) {
      await emitProviderProgress(state, progress);
    }
    return;
  }

  if (type === "tool_execution_end" && parsed.isError === true) {
    await emitProviderProgress(state, {
      kind: "warning",
      stage: "warning",
      slot: "warning",
      message:
        extractUnknownText(parsed.result) ??
        "A tool reported an issue during execution."
    });
    return;
  }

  if (type === "message_update") {
    const assistantMessageEvent = asRecord(parsed.assistantMessageEvent);
    if (asProgressString(assistantMessageEvent?.type) === "text_delta") {
      const delta = asProgressString(assistantMessageEvent?.delta);
      if (delta) {
        state.assistantText += delta;
      }
    }
    return;
  }

  if (type === "message_end" || type === "turn_end" || type === "agent_end") {
    const message =
      asRecord(parsed.message) ??
      asRecord((asArray(parsed.messages)?.at(-1) as Record<string, unknown> | undefined) ?? null);
    const text = extractPiAssistantText(message);
    if (text) {
      state.finalResponse = text;
    }
    if (type === "agent_end" || type === "turn_end") {
      await emitProviderProgress(state, {
        kind: "completed",
        stage: "finalize",
        slot: "finalize",
        message: "Preparing the final answer."
      });
    }
  }
}

async function consumeCodexStreamEvent(
  parsed: Record<string, unknown>,
  state: ProviderStreamState
): Promise<void> {
  const type = asProgressString(parsed.type);
  if (!type) {
    return;
  }

  if (type === "thread.started" || type === "turn.started") {
    if (!state.started) {
      await emitProviderProgress(state, {
        kind: "started",
        stage: "inspect",
        slot: "inspect",
        message: "Inspecting the project."
      });
    }
    return;
  }

  if (type === "error") {
    const detail = asProgressString(parsed.message);
    if (detail) {
      await emitProviderProgress(state, {
        kind: "warning",
        stage: "warning",
        slot: "warning",
        message: detail.startsWith("Reconnecting")
          ? "Codex is reconnecting after a stream interruption."
          : detail
      });
    }
    return;
  }

  const progress =
    describeToolProgress(
      asProgressString(parsed.tool_name) ??
        asProgressString(parsed.toolName) ??
        asProgressString(parsed.event) ??
        type,
      parsed
    ) ??
    describeCodexEventProgress(type, parsed);
  if (progress) {
    await emitProviderProgress(state, progress);
  }
}

function describeCodexEventProgress(
  type: string,
  parsed: Record<string, unknown>
): TaskProgressEvent | null {
  const normalized = type.toLowerCase();
  if (normalized.includes("exec_command")) {
    return describeToolProgress("exec_command", parsed);
  }
  if (normalized.includes("apply_patch") || normalized.includes("patch")) {
    return {
      kind: "progress",
      stage: "edit",
      slot: "edit",
      message: "Editing the implementation."
    };
  }
  if (normalized.includes("message")) {
    const text = extractUnknownText(parsed);
    if (text) {
      return {
        kind: "progress",
        stage: "inspect",
        slot: "inspect",
        message: "Reviewing the current implementation."
      };
    }
  }
  return null;
}

async function emitProviderProgress(
  state: ProviderStreamState,
  event: TaskProgressEvent
): Promise<void> {
  state.started = true;
  if (!state.onProgress) {
    return;
  }

  const message = asProgressString(event.message);
  if (!message) {
    return;
  }

  const normalizedEvent: TaskProgressEvent = {
    ...event,
    message
  };
  const key = [
    normalizedEvent.kind,
    normalizedEvent.slot ?? normalizedEvent.stage ?? "",
    normalizedEvent.message
  ].join("|");
  if (key === state.lastProgressKey) {
    return;
  }
  state.lastProgressKey = key;
  await state.onProgress(normalizedEvent);
}

function extractAssistantToolProgress(content: unknown[] | null): TaskProgressEvent | null {
  if (!content) {
    return null;
  }

  for (const block of content) {
    const record = asRecord(block);
    if (!record || asProgressString(record.type) !== "tool_use") {
      continue;
    }
    const progress = describeToolProgress(asProgressString(record.name), asRecord(record.input));
    if (progress) {
      return progress;
    }
  }

  return null;
}

function extractAssistantText(content: unknown[] | null): string {
  if (!content) {
    return "";
  }

  return content
    .map((block) => {
      const record = asRecord(block);
      if (!record) {
        return "";
      }
      return asProgressString(record.text) ?? "";
    })
    .filter(Boolean)
    .join("");
}

function describeToolProgress(
  toolNameRaw: string | null,
  payload?: Record<string, unknown> | null
): TaskProgressEvent | null {
  const toolName = toolNameRaw?.trim().toLowerCase();
  if (!toolName) {
    return null;
  }

  if (
    toolName.includes("read") ||
    toolName.includes("grep") ||
    toolName.includes("find") ||
    toolName.includes("glob") ||
    toolName.includes("search") ||
    toolName.includes("ls") ||
    toolName.includes("view")
  ) {
    return {
      kind: "progress",
      stage: "inspect",
      slot: "inspect",
      message: "Reviewing the current implementation."
    };
  }

  if (
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("patch") ||
    toolName.includes("replace") ||
    toolName.includes("apply")
  ) {
    return {
      kind: "progress",
      stage: "edit",
      slot: "edit",
      message: "Editing the implementation."
    };
  }

  if (
    toolName.includes("bash") ||
    toolName.includes("shell") ||
    toolName.includes("exec") ||
    toolName.includes("command") ||
    toolName.includes("terminal")
  ) {
    const command = extractCommandText(payload);
    if (command && /\b(test|lint|build|check|pytest|vitest|jest|pnpm test|npm test|cargo test|go test|make test)\b/i.test(command)) {
      return {
        kind: "progress",
        stage: "run",
        slot: "run",
        message: "Running checks."
      };
    }
    if (command && /\b(curl|wget|http|fetch)\b/i.test(command)) {
      return {
        kind: "progress",
        stage: "search",
        slot: "search",
        message: "Checking relevant docs."
      };
    }
    return {
      kind: "progress",
      stage: "run",
      slot: "run",
      message: "Running project commands."
    };
  }

  if (toolName.includes("web") || toolName.includes("browser") || toolName.includes("http")) {
    return {
      kind: "progress",
      stage: "search",
      slot: "search",
      message: "Checking relevant docs."
    };
  }

  return {
    kind: "progress",
    stage: "inspect",
    slot: "inspect",
    message: "Working through the task."
  };
}

function extractCommandText(payload?: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct =
    asProgressString(payload.command) ??
    asProgressString(payload.cmd) ??
    asProgressString(payload.commandLine) ??
    asProgressString(payload.input);
  if (direct) {
    return direct;
  }

  return extractUnknownText(payload);
}

function extractPiAssistantText(message: Record<string, unknown> | null): string {
  if (!message) {
    return "";
  }

  const role = asProgressString(message.role);
  if (role && role !== "assistant") {
    return "";
  }

  return extractUnknownText(message) ?? "";
}

function extractUnknownText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const combined = value
      .map((entry) => extractUnknownText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(" ")
      .trim();
    return combined || null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const direct =
    asProgressString(record.text) ??
    asProgressString(record.message) ??
    asProgressString(record.content) ??
    asProgressString(record.result) ??
    asProgressString(record.output) ??
    asProgressString(record.delta);
  if (direct) {
    return direct;
  }

  for (const key of ["content", "message", "messages", "parts", "result", "output", "response"]) {
    if (!(key in record)) {
      continue;
    }
    const nested = extractUnknownText(record[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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
  if (authMode !== "oauth") {
    return message;
  }

  const normalized = message.toLowerCase();
  if (provider.name === "anthropic") {
    if (
      normalized.includes("not logged in") ||
      normalized.includes("/login") ||
      normalized.includes("authentication") ||
      normalized.includes("anthropic_api_key")
    ) {
      return getProviderOauthMissingSessionMessage(provider.name, provider.cliCommand, message);
    }
    return message;
  }

  if (provider.name !== "gemini") {
    return message;
  }

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
  if (provider.name === "anthropic" && authMode === "oauth") {
    return `${providerLabel} CLI timed out. ${getProviderOauthSetupHint(provider.name, provider.cliCommand)}`;
  }
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
