/**
 * Provider configuration primitives.
 * Maps provider identifiers to canonical defaults, secrets, and runtime env wiring.
 */
import type { ProviderAuthMode, ProviderName, ProviderRuntime } from "./types.js";

interface ProviderCliDefaults {
  model: string;
  cliCommand: string;
  cliArgs: string[];
}

export interface ProviderSetupDefaults extends ProviderCliDefaults {
  runtime: ProviderRuntime;
  authMode: ProviderAuthMode;
}

interface ProviderDefinition extends ProviderSetupDefaults {
  apiKeyEnvVar: string;
  supportedAuthModes: ProviderAuthMode[];
  aliases?: string[];
  legacyCliDefaults?: ProviderCliDefaults;
  resetEnvVars?: string[];
  buildRuntimeEnv: (
    apiKey: string | null,
    model: string,
    authMode: ProviderAuthMode
  ) => Record<string, string>;
}

const CLAUDE_WORKSPACE_ARGS = [
  "-p",
  "{prompt}",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}"
] as const;

const CODEX_WORKSPACE_ARGS = [
  "exec",
  "--full-auto",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
  "-"
] as const;

const GEMINI_WORKSPACE_ARGS = [
  "--prompt",
  "{prompt}",
  "--model",
  "{model}",
  "--yolo"
] as const;

const PI_WORKSPACE_ARGS = [
  "--print",
  "--provider",
  "{runtime_provider}",
  "--model",
  "{model}",
  "--append-system-prompt",
  "{system_prompt}",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--tools",
  "read,bash,edit,write,grep,find,ls",
  "{user_message}"
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

const OPENAI_RUNTIME_RESET_ENV_VARS = ["OPENAI_API_KEY"] as const;
const GEMINI_RUNTIME_RESET_ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS"
] as const;
const XAI_RUNTIME_RESET_ENV_VARS = ["XAI_API_KEY"] as const;

const PROVIDER_DEFINITIONS: Record<ProviderName, ProviderDefinition> = {
  anthropic: {
    runtime: "claude",
    model: "claude-opus-4-6",
    cliCommand: "claude",
    cliArgs: [...CLAUDE_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    supportedAuthModes: ["api_key", "oauth"],
    aliases: ["claude_code"],
    resetEnvVars: [...CLAUDE_RUNTIME_RESET_ENV_VARS],
    legacyCliDefaults: {
      model: "claude-opus-4-6",
      cliCommand: "claude",
      cliArgs: ["-p", "{prompt}", "--model", "{model}"]
    },
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.ANTHROPIC_API_KEY = requireApiKey(apiKey, "ANTHROPIC_API_KEY");
      }
      return env;
    }
  },
  gemini: {
    runtime: "gemini",
    model: "gemini-2.5-pro",
    cliCommand: "gemini",
    cliArgs: [...GEMINI_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "GEMINI_API_KEY",
    supportedAuthModes: ["api_key", "oauth"],
    resetEnvVars: [...GEMINI_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.GEMINI_API_KEY = requireApiKey(apiKey, "GEMINI_API_KEY");
      }
      return env;
    }
  },
  minimax: {
    runtime: "claude",
    model: "MiniMax-M2.5",
    cliCommand: "claude",
    cliArgs: [...CLAUDE_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "MINIMAX_API_KEY",
    supportedAuthModes: ["api_key"],
    resetEnvVars: [...CLAUDE_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey, model) => ({
      ANTHROPIC_AUTH_TOKEN: requireApiKey(apiKey, "MINIMAX_API_KEY"),
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
    runtime: "codex",
    model: "gpt-5.3-codex",
    cliCommand: "codex",
    cliArgs: [...CODEX_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "OPENAI_API_KEY",
    supportedAuthModes: ["api_key", "oauth"],
    aliases: ["codex"],
    resetEnvVars: [...OPENAI_RUNTIME_RESET_ENV_VARS],
    legacyCliDefaults: {
      model: "gpt-5.3-codex",
      cliCommand: "codex",
      cliArgs: ["exec", "-"]
    },
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.OPENAI_API_KEY = requireApiKey(apiKey, "OPENAI_API_KEY");
      }
      return env;
    }
  },
  xai: {
    runtime: "pi",
    model: "grok-4-fast-non-reasoning",
    cliCommand: "pi",
    cliArgs: [...PI_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "XAI_API_KEY",
    supportedAuthModes: ["api_key"],
    resetEnvVars: [...XAI_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey) => ({
      XAI_API_KEY: requireApiKey(apiKey, "XAI_API_KEY")
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
    runtime: definition.runtime,
    model: definition.model,
    cliCommand: definition.cliCommand,
    cliArgs: [...definition.cliArgs],
    authMode: definition.authMode
  };
}

export function getProviderSupportedAuthModes(providerName: ProviderName): ProviderAuthMode[] {
  return [...PROVIDER_DEFINITIONS[providerName].supportedAuthModes];
}

export function getProviderRuntime(providerName: ProviderName): ProviderRuntime {
  return PROVIDER_DEFINITIONS[providerName].runtime;
}

export function providerSupportsAuthMode(providerName: ProviderName, authMode: ProviderAuthMode): boolean {
  return PROVIDER_DEFINITIONS[providerName].supportedAuthModes.includes(authMode);
}

export function normalizeProviderAuthMode(value: string): ProviderAuthMode | null {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "api_key" || normalized === "apikey") {
    return "api_key";
  }
  if (normalized === "oauth") {
    return "oauth";
  }
  return null;
}

export function resolveProviderAuthMode(
  providerName: ProviderName,
  candidate: string | null | undefined,
  fallback?: ProviderAuthMode
): ProviderAuthMode {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const normalizedCandidate =
    typeof candidate === "string" && candidate.trim() ? normalizeProviderAuthMode(candidate) : null;
  if (normalizedCandidate && definition.supportedAuthModes.includes(normalizedCandidate)) {
    return normalizedCandidate;
  }

  if (fallback && definition.supportedAuthModes.includes(fallback)) {
    return fallback;
  }

  if (definition.supportedAuthModes.includes(definition.authMode)) {
    return definition.authMode;
  }

  return definition.supportedAuthModes[0] ?? "api_key";
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

export function getProviderOauthSetupHint(providerName: ProviderName, cliCommand: string): string {
  if (providerName === "openai") {
    return `Run '${cliCommand} login' if needed.`;
  }
  if (providerName === "anthropic") {
    return `Run '${cliCommand} auth login' if needed.`;
  }
  if (providerName === "gemini") {
    return `Run '${cliCommand}' and choose Login with Google if needed.`;
  }
  return `Run '${cliCommand}' to complete authentication if needed.`;
}

export function getProviderOauthMissingSessionMessage(
  providerName: ProviderName,
  cliCommand: string,
  detail?: string
): string {
  const base =
    providerName === "openai"
      ? `OpenAI OAuth login required. Run '${cliCommand} login' and retry.`
      : providerName === "anthropic"
        ? `Anthropic OAuth login required. Run '${cliCommand} auth login' and retry.`
        : `Gemini OAuth login required. Run '${cliCommand}' and choose Login with Google, then retry.`;
  return detail ? `${base} (${detail})` : base;
}

export function buildProviderRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  providerName: ProviderName,
  authMode: ProviderAuthMode,
  apiKey: string | null,
  model: string
): NodeJS.ProcessEnv {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const resolvedAuthMode = resolveProviderAuthMode(providerName, authMode, definition.authMode);
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  for (const key of definition.resetEnvVars ?? []) {
    delete env[key];
  }

  Object.assign(env, definition.buildRuntimeEnv(apiKey, model, resolvedAuthMode));
  return env;
}

function requireApiKey(value: string | null, keyName: string): string {
  if (!value) {
    throw new Error(`Missing required provider API key (${keyName}).`);
  }
  return value;
}
