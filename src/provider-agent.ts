/**
 * Provider CLI adapter for agent responses.
 * Builds prompts, invokes provider CLIs, and normalizes command output/errors.
 */
import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import { buildAgentPromptForInput, buildPiSystemPromptForInput, resolveAgentDirectory } from "./agent.js";
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

export class ProviderAgent {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly getState: () => OpenColabState
  ) {}

  async respond(input: ProviderAgentInput): Promise<string> {
    const startedAt = Date.now();
    const state = this.getState();
    const project = getActiveProject(state);
    const agent = getActiveAgent(project);
    const provider = agent.provider;
    const promptStartedAt = Date.now();
    const cliInput = this.buildCliInput(agent, provider, input.memory, input.text);
    const promptMs = Date.now() - promptStartedAt;

    if (this.config.forceMockCodex) {
      this.logPerf(promptMs, 0, Date.now() - startedAt, provider.name, provider.model);
      return this.mockResponse(provider.name, provider.model, input.text);
    }

    const cliStartedAt = Date.now();
    const output = await this.runProviderCli(cliInput, provider, project.path, agent.path);
    const cliMs = Date.now() - cliStartedAt;
    this.logPerf(promptMs, cliMs, Date.now() - startedAt, provider.name, provider.model);
    return output;
  }

  private runProviderCli(
    input: ProviderCliInput,
    provider: ProviderConfig,
    projectPath: string,
    agentPath: string
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
    const resolvedArgs = provider.cliArgs.map((arg: string) =>
      replaceCliArgTokens(arg, {
        "{provider}": provider.name,
        "{runtime_provider}": provider.name,
        "{model}": provider.model,
        "{project_dir}": projectDir,
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
        handler();
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
    provider: ProviderConfig,
    memory: AgentMemoryContext,
    userMessage: string
  ): ProviderCliInput {
    const prompt = buildAgentPromptForInput(this.config.rootDir, agent, memory, userMessage);
    if (provider.runtime === "pi") {
      return {
        prompt,
        systemPrompt: buildPiSystemPromptForInput(this.config.rootDir, agent, memory),
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
