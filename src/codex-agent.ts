import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import { buildAgentPrompt, readAgentDocuments, resolveAgentDirectory } from "./agent.js";
import { isLiteralSecretReference, resolveSecretReference } from "./secrets.js";
import type { ConversationMessage, OpenColabState } from "./types.js";

export interface CodexAgentInput {
  chatId: string;
  sender: string;
  text: string;
  history: ConversationMessage[];
}

export class CodexAgent {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly getState: () => OpenColabState
  ) {}

  async respond(input: CodexAgentInput): Promise<string> {
    const state = this.getState();
    const docs = readAgentDocuments(this.config.rootDir, state.agent);
    const prompt = buildAgentPrompt(docs, input.history, input.text);

    if (this.config.forceMockCodex) {
      return this.mockResponse(state.provider.model, input.text);
    }

    return this.runCodexCli(prompt, state);
  }

  private runCodexCli(prompt: string, state: OpenColabState): Promise<string> {
    const apiKey = resolveSecretReference(state.provider.apiKeyEnvVar);
    if (!apiKey) {
      throw new Error("Missing required provider API key (env var or literal value).");
    }
    const configuredReference = state.provider.apiKeyEnvVar.trim();
    const preferredKeyName = isLiteralSecretReference(configuredReference)
      ? "OPENAI_API_KEY"
      : configuredReference;

    const cwd = resolveAgentDirectory(this.config.rootDir, state.agent.path);

    return new Promise<string>((resolve, reject) => {
      const child = spawn(state.provider.cliCommand, state.provider.cliArgs, {
        cwd,
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKey,
          ...(preferredKeyName !== "OPENAI_API_KEY" ? { [preferredKeyName]: apiKey } : {}),
          OPENCOLAB_MODEL: state.provider.model
        },
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

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
        finish(() => reject(new Error("Codex CLI timed out")));
      }, Math.max(this.config.codexTimeoutMs, 1000));

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        finish(() => reject(error));
      });

      child.on("close", (code) => {
        if (code === 0) {
          const response = stdout.trim();
          finish(() => resolve(response || "(empty response from Codex CLI)"));
          return;
        }

        const message = stderr.trim() || `Codex CLI exited with code ${String(code)}`;
        finish(() => reject(new Error(message)));
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  private mockResponse(model: string, text: string): string {
    return [
      `[mock-codex:${model}]`,
      "This is a simulated response from the OpenColab research agent.",
      `Question: ${text}`
    ].join("\n");
  }
}
