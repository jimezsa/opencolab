import type { ProviderName } from "./types.js";

export interface ProviderSetupDefaults {
  model: string;
  apiKeyEnvVar: string;
  cliCommand: string;
  cliArgs: string[];
}

export function isProviderName(value: string): value is ProviderName {
  return value === "codex" || value === "claude_code";
}

export function getProviderSetupDefaults(providerName: ProviderName): ProviderSetupDefaults {
  if (providerName === "claude_code") {
    return {
      model: "claude-sonnet-4-5",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      cliCommand: "claude",
      cliArgs: ["-p", "{prompt}", "--model", "{model}"]
    };
  }

  return {
    model: "gpt-5",
    apiKeyEnvVar: "OPENAI_API_KEY",
    cliCommand: "codex",
    cliArgs: ["exec", "-"]
  };
}

export function getCanonicalProviderKeyEnvVar(providerName: ProviderName): string {
  return providerName === "claude_code" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}
