import type { ProviderName } from "./types.js";

export interface ProviderSetupDefaults {
  model: string;
  cliCommand: string;
  cliArgs: string[];
}

export function normalizeProviderName(value: string): ProviderName | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }

  if (normalized === "codex") {
    return "openai";
  }

  if (normalized === "claude_code") {
    return "anthropic";
  }

  return null;
}

export function isProviderName(value: string): value is ProviderName {
  return value === "openai" || value === "anthropic";
}

export function getProviderSetupDefaults(providerName: ProviderName): ProviderSetupDefaults {
  if (providerName === "anthropic") {
    return {
      model: "claude-opus-4-6",
      cliCommand: "claude",
      cliArgs: ["-p", "{prompt}", "--model", "{model}"]
    };
  }

  return {
    model: "gpt-5.3-codex",
    cliCommand: "codex",
    cliArgs: ["exec", "-"]
  };
}

export function getCanonicalProviderKeyEnvVar(providerName: ProviderName): string {
  return providerName === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}
