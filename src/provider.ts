/**
 * Provider configuration primitives.
 * Maps provider identifiers to canonical defaults and setup-time aliases.
 */
import type { ProviderName } from "./types.js";

export interface ProviderSetupDefaults {
  model: string;
  cliCommand: string;
  cliArgs: string[];
}

const LEGACY_PROVIDER_DEFAULTS: Record<ProviderName, ProviderSetupDefaults> = {
  anthropic: {
    model: "claude-opus-4-6",
    cliCommand: "claude",
    cliArgs: ["-p", "{prompt}", "--model", "{model}"]
  },
  openai: {
    model: "gpt-5.3-codex",
    cliCommand: "codex",
    cliArgs: ["exec", "-"]
  }
};

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
      cliArgs: [
        "-p",
        "{prompt}",
        "--model",
        "{model}",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        "{project_dir}"
      ]
    };
  }

  return {
    model: "gpt-5.3-codex",
    cliCommand: "codex",
    cliArgs: [
      "exec",
      "--sandbox",
      "workspace-write",
      "-a",
      "never",
      "--add-dir",
      "{project_dir}",
      "-"
    ]
  };
}

export function usesLegacyProviderCliDefaults(
  providerName: ProviderName,
  cliCommand: string,
  cliArgs: string[]
): boolean {
  const legacy = LEGACY_PROVIDER_DEFAULTS[providerName];
  return cliCommand === legacy.cliCommand && hasExactArgs(cliArgs, legacy.cliArgs);
}

function hasExactArgs(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getCanonicalProviderKeyEnvVar(providerName: ProviderName): string {
  return providerName === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}
