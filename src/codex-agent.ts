import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import { buildAgentPrompt, readAgentDocuments, resolveAgentDirectory } from "./agent.js";
import { getCanonicalProviderKeyEnvVar } from "./provider.js";
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

    return this.runProviderCli(prompt, state);
  }

  private runProviderCli(prompt: string, state: OpenColabState): Promise<string> {
    const apiKey = resolveSecretReference(state.provider.apiKeyEnvVar);
    if (!apiKey) {
      throw new Error("Missing required provider API key (env var or literal value).");
    }
    const configuredReference = state.provider.apiKeyEnvVar.trim();
    const canonicalKeyName = getCanonicalProviderKeyEnvVar(state.provider.name);
    const preferredKeyName = isLiteralSecretReference(configuredReference)
      ? canonicalKeyName
      : configuredReference;

    const cwd = resolveAgentDirectory(this.config.rootDir, state.agent.path);
    const resolvedArgs = state.provider.cliArgs.map((arg) => arg.replaceAll("{model}", state.provider.model));
    const promptProvidedInArgs = resolvedArgs.some((arg) => arg.includes("{prompt}"));
    const cliArgs = resolvedArgs.map((arg) => arg.replaceAll("{prompt}", prompt));
    const providerLabel = state.provider.name.replaceAll("_", " ");

    return new Promise<string>((resolve, reject) => {
      const child = spawn(state.provider.cliCommand, cliArgs, {
        cwd,
        env: {
          ...process.env,
          [canonicalKeyName]: apiKey,
          ...(preferredKeyName !== canonicalKeyName ? { [preferredKeyName]: apiKey } : {}),
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
        finish(() => reject(new Error(`${providerLabel} CLI timed out`)));
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
          finish(() => resolve(response || `(empty response from ${providerLabel} CLI)`));
          return;
        }

        const message = stderr.trim() || `${providerLabel} CLI exited with code ${String(code)}`;
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

  private mockResponse(model: string, text: string): string {
    return [
      `[mock-${this.getState().provider.name}:${model}]`,
      "This is a simulated response from the OpenColab research agent.",
      `Question: ${text}`
    ].join("\n");
  }
}
