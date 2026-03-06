import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import { buildAgentPromptForInput, resolveAgentDirectory } from "./agent.js";
import { getActiveAgent, getActiveProject } from "./project-config.js";
import { getProviderApiKeyEnvVar, resolveProviderApiKey } from "./secrets.js";
import type { ConversationMessage, OpenColabState, TelegramFilePayload } from "./types.js";

const MAX_CLI_CAPTURE_CHARS = 200_000;

export interface CodexAgentInput {
  chatId: string;
  sender: string;
  text: string;
  files: TelegramFilePayload[];
  history: ConversationMessage[];
}

export class CodexAgent {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly getState: () => OpenColabState
  ) {}

  async respond(input: CodexAgentInput): Promise<string> {
    const startedAt = Date.now();
    const state = this.getState();
    const project = getActiveProject(state);
    const agent = getActiveAgent(project);
    const promptStartedAt = Date.now();
    const prompt = buildAgentPromptForInput(this.config.rootDir, agent, input.history, input.text);
    const promptMs = Date.now() - promptStartedAt;

    if (this.config.forceMockCodex) {
      this.logPerf(promptMs, 0, Date.now() - startedAt, project.provider.name, project.provider.model);
      return this.mockResponse(project.provider.name, project.provider.model, input.text);
    }

    const cliStartedAt = Date.now();
    const output = await this.runProviderCli(prompt, project.provider, agent.path);
    const cliMs = Date.now() - cliStartedAt;
    this.logPerf(promptMs, cliMs, Date.now() - startedAt, project.provider.name, project.provider.model);
    return output;
  }

  private runProviderCli(
    prompt: string,
    provider: OpenColabState["projects"][string]["provider"],
    agentPath: string
  ): Promise<string> {
    const canonicalKeyName = getProviderApiKeyEnvVar(provider.name);
    const apiKey = resolveProviderApiKey(provider.name);
    if (!apiKey) {
      throw new Error(
        `Missing required provider API key (${canonicalKeyName}). Set it in .env.local or in the shell environment.`
      );
    }

    const cwd = resolveAgentDirectory(this.config.rootDir, agentPath);
    const resolvedArgs = provider.cliArgs.map((arg) => arg.replaceAll("{model}", provider.model));
    const promptProvidedInArgs = resolvedArgs.some((arg) => arg.includes("{prompt}"));
    const cliArgs = resolvedArgs.map((arg) => arg.replaceAll("{prompt}", prompt));
    const providerLabel = provider.name.replaceAll("_", " ");
    return new Promise<string>((resolve, reject) => {
      const child = spawn(provider.cliCommand, cliArgs, {
        cwd,
        env: {
          ...process.env,
          [canonicalKeyName]: apiKey,
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
        finish(() => reject(new Error(`${providerLabel} CLI timed out`)));
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
        finish(() => reject(error));
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
        finish(() => reject(new Error(message)));
      });

      if (promptProvidedInArgs) {
        child.stdin.end();
        return;
      }

      child.stdin.write(prompt);
      child.stdin.end();
    });
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
