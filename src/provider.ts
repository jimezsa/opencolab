/**
 * Provider configuration primitives.
 * Maps provider identifiers to canonical defaults, secrets, and runtime env wiring.
 */
import type { ProviderName } from "./types.js";

export interface ProviderSetupDefaults {
  model: string;
  cliCommand: string;
  cliArgs: string[];
}

interface ProviderDefinition extends ProviderSetupDefaults {
  apiKeyEnvVar: string;
  aliases?: string[];
  legacyCliDefaults?: ProviderSetupDefaults;
  resetEnvVars?: string[];
  buildRuntimeEnv: (apiKey: string, model: string) => Record<string, string>;
}

const CLAUDE_WORKSPACE_ARGS = [
  "-p",
  "{prompt}",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}"
] as const;

const CODEX_WORKSPACE_ARGS = [
  "exec",
  "--sandbox",
  "workspace-write",
  "-a",
  "never",
  "--add-dir",
  "{project_dir}",
  "-"
] as const;

const CLAUDE_RUNTIME_RESET_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
] as const;

const PROVIDER_DEFINITIONS: Record<ProviderName, ProviderDefinition> = {
  anthropic: {
    model: "claude-opus-4-6",
    cliCommand: "claude",
    cliArgs: [...CLAUDE_WORKSPACE_ARGS],
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    aliases: ["claude_code"],
    resetEnvVars: [...CLAUDE_RUNTIME_RESET_ENV_VARS],
    legacyCliDefaults: {
      model: "claude-opus-4-6",
      cliCommand: "claude",
      cliArgs: ["-p", "{prompt}", "--model", "{model}"]
    },
    buildRuntimeEnv: (apiKey) => ({
      ANTHROPIC_API_KEY: apiKey
    })
  },
  minimax: {
    model: "MiniMax-M2.5",
    cliCommand: "claude",
    cliArgs: [...CLAUDE_WORKSPACE_ARGS],
    apiKeyEnvVar: "MINIMAX_API_KEY",
    resetEnvVars: [...CLAUDE_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey, model) => ({
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
    })
  },
  openai: {
    model: "gpt-5.3-codex",
    cliCommand: "codex",
    cliArgs: [...CODEX_WORKSPACE_ARGS],
    apiKeyEnvVar: "OPENAI_API_KEY",
    aliases: ["codex"],
    legacyCliDefaults: {
      model: "gpt-5.3-codex",
      cliCommand: "codex",
      cliArgs: ["exec", "-"]
    },
    buildRuntimeEnv: (apiKey) => ({
      OPENAI_API_KEY: apiKey
    })
  }
};

export function getSupportedProviderNames(): ProviderName[] {
  return Object.keys(PROVIDER_DEFINITIONS) as ProviderName[];
}

export function normalizeProviderName(value: string): ProviderName | null {
  const normalized = value.trim().toLowerCase();
  for (const providerName of getSupportedProviderNames()) {
    const definition = PROVIDER_DEFINITIONS[providerName];
    if (normalized === providerName || definition.aliases?.includes(normalized)) {
      return providerName;
    }
  }

  return null;
}

export function isProviderName(value: string): value is ProviderName {
  return Object.hasOwn(PROVIDER_DEFINITIONS, value);
}

export function getProviderSetupDefaults(providerName: ProviderName): ProviderSetupDefaults {
  const definition = PROVIDER_DEFINITIONS[providerName];
  return {
    model: definition.model,
    cliCommand: definition.cliCommand,
    cliArgs: [...definition.cliArgs]
  };
}

export function usesLegacyProviderCliDefaults(
  providerName: ProviderName,
  cliCommand: string,
  cliArgs: string[]
): boolean {
  const legacy = PROVIDER_DEFINITIONS[providerName].legacyCliDefaults;
  if (!legacy) {
    return false;
  }
  return cliCommand === legacy.cliCommand && hasExactArgs(cliArgs, legacy.cliArgs);
}

function hasExactArgs(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getCanonicalProviderKeyEnvVar(providerName: ProviderName): string {
  return PROVIDER_DEFINITIONS[providerName].apiKeyEnvVar;
}

export function buildProviderRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  providerName: ProviderName,
  apiKey: string,
  model: string
): NodeJS.ProcessEnv {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  for (const key of definition.resetEnvVars ?? []) {
    delete env[key];
  }

  Object.assign(env, definition.buildRuntimeEnv(apiKey, model));
  return env;
}
