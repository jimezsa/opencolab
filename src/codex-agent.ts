import { spawn } from "node:child_process";
import type { OpenColabConfig } from "./config.js";
import { buildAgentPrompt, readAgentDocuments, resolveAgentDirectory } from "./agent.js";
import { getActiveAgent, getActiveProject } from "./project-config.js";
import { getCanonicalProviderKeyEnvVar } from "./provider.js";
import { isLiteralSecretReference, resolveSecretReference } from "./secrets.js";
import type { ConversationMessage, OpenColabState, TelegramFilePayload } from "./types.js";

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
    const state = this.getState();
    const project = getActiveProject(state);
    const agent = getActiveAgent(project);
    const docs = readAgentDocuments(this.config.rootDir, agent);
    const prompt = buildAgentPrompt(docs, input.history, input.text);

    if (this.config.forceMockCodex) {
      return this.mockResponse(project.provider.name, project.provider.model, input.text);
    }

    return this.runProviderCli(prompt, project.provider, agent.path);
  }

  private runProviderCli(
    prompt: string,
    provider: OpenColabState["projects"][string]["provider"],
    agentPath: string
  ): Promise<string> {
    const apiKey = resolveSecretReference(provider.apiKeyEnvVar);
    if (!apiKey) {
      throw new Error("Missing required provider API key (env var or literal value).");
    }
    const configuredReference = provider.apiKeyEnvVar.trim();
    const canonicalKeyName = getCanonicalProviderKeyEnvVar(provider.name);
    const preferredKeyName = isLiteralSecretReference(configuredReference)
      ? canonicalKeyName
      : configuredReference;

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
          ...(preferredKeyName !== canonicalKeyName ? { [preferredKeyName]: apiKey } : {}),
          OPENCOLAB_MODEL: provider.model
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

  private mockResponse(providerName: string, model: string, text: string): string {
    return [
      `[mock-${providerName}:${model}]`,
      "This is a simulated response from the OpenColab research agent.",
      `Question: ${text}`
    ].join("\n");
  }
}
