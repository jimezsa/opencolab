/**
 * Provider configuration primitives.
 * Maps provider identifiers to canonical defaults, secrets, and runtime env wiring.
 */
import type {
  ProviderAuthMode,
  ProviderConfig,
  ProviderName,
  ProviderReasoningEffort,
  ProviderRuntime,
} from "./types.js";

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
  migratableCliDefaults?: ProviderCliDefaults[];
  runtimeProvider?: string;
  resetEnvVars?: string[];
  buildRuntimeEnv: (
    apiKey: string | null,
    model: string,
    authMode: ProviderAuthMode,
  ) => Record<string, string>;
}

interface ProviderReasoningCapability {
  options: ProviderReasoningEffort[];
  defaultEffort: ProviderReasoningEffort;
}

// The prompt is intentionally NOT part of the argv: without a `{prompt}`
// token the runner pipes it through stdin, which has no size limit. Putting
// it in argv breaks once the conversation transcript grows past the OS
// command-line limit (32 KiB on Windows -> spawn ENAMETOOLONG, ~128 KiB per
// argument on Linux -> spawn E2BIG).
const CLAUDE_WORKSPACE_ARGS = [
  "-p",
  "--verbose",
  "--output-format",
  "stream-json",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
] as const;

const CLAUDE_LEGACY_SIMPLE_ARGS = [
  "-p",
  "{prompt}",
  "--model",
  "{model}",
] as const;
const CLAUDE_LEGACY_WORKSPACE_ARGS = [
  "-p",
  "{prompt}",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
] as const;
const CLAUDE_LEGACY_STREAM_JSON_ARGS = [
  "-p",
  "{prompt}",
  "--output-format",
  "stream-json",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
] as const;
const CLAUDE_LEGACY_ARGV_PROMPT_ARGS = [
  "-p",
  "--verbose",
  "--output-format",
  "stream-json",
  "--model",
  "{model}",
  "--permission-mode",
  "bypassPermissions",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
  "--",
  "{prompt}",
] as const;

const CODEX_WORKSPACE_ARGS = [
  "-a",
  "never",
  "exec",
  "--skip-git-repo-check",
  "--json",
  "--output-last-message",
  "{output_file}",
  "--sandbox",
  "danger-full-access",
  "--add-dir",
  "{project_dir}",
  "--add-dir",
  "{shared_skills_dir}",
  "-",
] as const;

// Prompt goes through stdin (see CLAUDE_WORKSPACE_ARGS note).
const GEMINI_WORKSPACE_ARGS = [
  "--output-format",
  "stream-json",
  "--model",
  "{model}",
  "--yolo",
] as const;
const GEMINI_LEGACY_ARGV_PROMPT_ARGS = [
  "--prompt",
  "{prompt}",
  "--output-format",
  "stream-json",
  "--model",
  "{model}",
  "--yolo",
] as const;

const PI_WORKSPACE_ARGS = [
  "--mode",
  "json",
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
  "{user_message}",
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
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;

const OPENAI_RUNTIME_RESET_ENV_VARS = ["OPENAI_API_KEY"] as const;
const GEMINI_RUNTIME_RESET_ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;
const XAI_RUNTIME_RESET_ENV_VARS = ["XAI_API_KEY"] as const;
const OPENROUTER_RUNTIME_RESET_ENV_VARS = ["OPENROUTER_API_KEY"] as const;
const KIMI_RUNTIME_RESET_ENV_VARS = ["KIMI_API_KEY"] as const;

function buildMigratableCliDefaults(
  model: string,
  cliCommand: string,
  argSets: ReadonlyArray<ReadonlyArray<string>>,
): ProviderCliDefaults[] {
  return argSets.map((cliArgs) => ({
    model,
    cliCommand,
    cliArgs: [...cliArgs],
  }));
}

const PROVIDER_REASONING_CAPABILITIES: Partial<
  Record<ProviderName, Record<string, ProviderReasoningCapability>>
> = {
  openai: {
    "gpt-5.6-sol": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "gpt-5.6-terra": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "gpt-5.6-luna": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "gpt-5.5": {
      options: ["low", "medium", "high", "xhigh"],
      defaultEffort: "high",
    },
  },
  anthropic: {
    "claude-opus-5": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "claude-opus-4-8": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "claude-opus-4-6": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "claude-sonnet-5": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    "claude-sonnet-4-5": {
      options: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
  },
  // pi clamps unsupported thinking levels silently instead of failing, so only
  // levels the model actually distinguishes are offered here. DeepSeek V4 maps
  // high -> "high" and xhigh -> "xhigh"; every other level lands on one of those.
  openrouter: {
    "deepseek/deepseek-v4-pro": {
      options: ["high", "xhigh"],
      defaultEffort: "high",
    },
    "deepseek/deepseek-v4-flash": {
      options: ["high", "xhigh"],
      defaultEffort: "high",
    },
  },
};

const PROVIDER_DEFINITIONS: Record<ProviderName, ProviderDefinition> = {
  anthropic: {
    runtime: "claude",
    model: "claude-opus-4-7",
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
      cliArgs: [...CLAUDE_LEGACY_SIMPLE_ARGS],
    },
    migratableCliDefaults: buildMigratableCliDefaults(
      "claude-opus-4-6",
      "claude",
      [
        CLAUDE_LEGACY_SIMPLE_ARGS,
        CLAUDE_LEGACY_WORKSPACE_ARGS,
        CLAUDE_LEGACY_STREAM_JSON_ARGS,
        CLAUDE_LEGACY_ARGV_PROMPT_ARGS,
      ],
    ),
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.ANTHROPIC_API_KEY = requireApiKey(apiKey, "ANTHROPIC_API_KEY");
      }
      return env;
    },
  },
  gemini: {
    runtime: "gemini",
    model: "gemini-3.5-flash",
    cliCommand: "gemini",
    cliArgs: [...GEMINI_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "GEMINI_API_KEY",
    supportedAuthModes: ["api_key", "oauth"],
    resetEnvVars: [...GEMINI_RUNTIME_RESET_ENV_VARS],
    migratableCliDefaults: buildMigratableCliDefaults("gemini-3.5-flash", "gemini", [
      GEMINI_LEGACY_ARGV_PROMPT_ARGS,
    ]),
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.GEMINI_API_KEY = requireApiKey(apiKey, "GEMINI_API_KEY");
      }
      return env;
    },
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
    migratableCliDefaults: buildMigratableCliDefaults(
      "MiniMax-M2.5",
      "claude",
      [
        CLAUDE_LEGACY_SIMPLE_ARGS,
        CLAUDE_LEGACY_WORKSPACE_ARGS,
        CLAUDE_LEGACY_STREAM_JSON_ARGS,
        CLAUDE_LEGACY_ARGV_PROMPT_ARGS,
      ],
    ),
    buildRuntimeEnv: (apiKey, model) => ({
      ANTHROPIC_AUTH_TOKEN: requireApiKey(apiKey, "MINIMAX_API_KEY"),
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    }),
  },
  openai: {
    runtime: "codex",
    model: "gpt-5.5",
    cliCommand: "codex",
    cliArgs: [...CODEX_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "OPENAI_API_KEY",
    supportedAuthModes: ["api_key", "oauth"],
    aliases: ["codex"],
    resetEnvVars: [...OPENAI_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey, _model, authMode) => {
      const env: Record<string, string> = {};
      if (authMode !== "oauth") {
        env.OPENAI_API_KEY = requireApiKey(apiKey, "OPENAI_API_KEY");
      }
      return env;
    },
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
      XAI_API_KEY: requireApiKey(apiKey, "XAI_API_KEY"),
    }),
  },
  openrouter: {
    runtime: "pi",
    model: "openai/gpt-5.5",
    cliCommand: "pi",
    cliArgs: [...PI_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    supportedAuthModes: ["api_key"],
    resetEnvVars: [...OPENROUTER_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey) => ({
      OPENROUTER_API_KEY: requireApiKey(apiKey, "OPENROUTER_API_KEY"),
    }),
  },
  kimi: {
    runtime: "pi",
    model: "k2p5",
    cliCommand: "pi",
    cliArgs: [...PI_WORKSPACE_ARGS],
    authMode: "api_key",
    apiKeyEnvVar: "KIMI_API_KEY",
    supportedAuthModes: ["api_key"],
    aliases: ["kimi-coding"],
    runtimeProvider: "kimi-coding",
    resetEnvVars: [...KIMI_RUNTIME_RESET_ENV_VARS],
    buildRuntimeEnv: (apiKey) => ({
      KIMI_API_KEY: requireApiKey(apiKey, "KIMI_API_KEY"),
    }),
  },
};

export function getSupportedProviderNames(): ProviderName[] {
  return Object.keys(PROVIDER_DEFINITIONS) as ProviderName[];
}

export function normalizeProviderName(value: string): ProviderName | null {
  const normalized = value.trim().toLowerCase();
  for (const providerName of getSupportedProviderNames()) {
    const definition = PROVIDER_DEFINITIONS[providerName];
    if (
      normalized === providerName ||
      definition.aliases?.includes(normalized)
    ) {
      return providerName;
    }
  }

  return null;
}

export function isProviderName(value: string): value is ProviderName {
  return Object.hasOwn(PROVIDER_DEFINITIONS, value);
}

export function getProviderSetupDefaults(
  providerName: ProviderName,
): ProviderSetupDefaults {
  const definition = PROVIDER_DEFINITIONS[providerName];
  return {
    runtime: definition.runtime,
    model: definition.model,
    cliCommand: definition.cliCommand,
    cliArgs: [...definition.cliArgs],
    authMode: definition.authMode,
  };
}

export function getProviderSupportedAuthModes(
  providerName: ProviderName,
): ProviderAuthMode[] {
  return [...PROVIDER_DEFINITIONS[providerName].supportedAuthModes];
}

export function getProviderRuntime(
  providerName: ProviderName,
): ProviderRuntime {
  return PROVIDER_DEFINITIONS[providerName].runtime;
}

export function getProviderRuntimeProviderName(
  providerName: ProviderName,
): string {
  return PROVIDER_DEFINITIONS[providerName].runtimeProvider ?? providerName;
}

function getProviderReasoningCapability(
  providerName: ProviderName,
  model: string,
): ProviderReasoningCapability | null {
  const providerCapabilities = PROVIDER_REASONING_CAPABILITIES[providerName];
  if (!providerCapabilities) {
    return null;
  }
  return providerCapabilities[model] ?? null;
}

export function getProviderReasoningEffortOptions(
  providerName: ProviderName,
  model: string,
): ProviderReasoningEffort[] {
  return [
    ...(getProviderReasoningCapability(providerName, model)?.options ?? []),
  ];
}

export function getProviderDefaultReasoningEffort(
  providerName: ProviderName,
  model: string,
): ProviderReasoningEffort | null {
  return (
    getProviderReasoningCapability(providerName, model)?.defaultEffort ?? null
  );
}

export function normalizeProviderReasoningEffort(
  providerName: ProviderName,
  model: string,
  value: string | null | undefined,
): ProviderReasoningEffort | null {
  const capability = getProviderReasoningCapability(providerName, model);
  if (!capability || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase() as ProviderReasoningEffort;
  return capability.options.includes(normalized) ? normalized : null;
}

export function resolveProviderReasoningEffort(
  providerName: ProviderName,
  model: string,
  candidate: string | null | undefined,
  fallback?: ProviderReasoningEffort | null,
): ProviderReasoningEffort | undefined {
  const capability = getProviderReasoningCapability(providerName, model);
  if (!capability) {
    return undefined;
  }

  const normalizedCandidate = normalizeProviderReasoningEffort(
    providerName,
    model,
    candidate,
  );
  if (normalizedCandidate) {
    return normalizedCandidate;
  }

  const normalizedFallback = normalizeProviderReasoningEffort(
    providerName,
    model,
    fallback,
  );
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return capability.defaultEffort;
}

export function providerSupportsAuthMode(
  providerName: ProviderName,
  authMode: ProviderAuthMode,
): boolean {
  return PROVIDER_DEFINITIONS[providerName].supportedAuthModes.includes(
    authMode,
  );
}

export function normalizeProviderAuthMode(
  value: string,
): ProviderAuthMode | null {
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
  fallback?: ProviderAuthMode,
): ProviderAuthMode {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const normalizedCandidate =
    typeof candidate === "string" && candidate.trim()
      ? normalizeProviderAuthMode(candidate)
      : null;
  if (
    normalizedCandidate &&
    definition.supportedAuthModes.includes(normalizedCandidate)
  ) {
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
  cliArgs: string[],
): boolean {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const candidates = [
    ...(definition.legacyCliDefaults ? [definition.legacyCliDefaults] : []),
    ...(definition.migratableCliDefaults ?? []),
  ];
  return candidates.some(
    (candidate) =>
      cliCommand === candidate.cliCommand &&
      hasExactArgs(cliArgs, candidate.cliArgs),
  );
}

function hasExactArgs(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function getCanonicalProviderKeyEnvVar(
  providerName: ProviderName,
): string {
  return PROVIDER_DEFINITIONS[providerName].apiKeyEnvVar;
}

export function getProviderOauthSetupHint(
  providerName: ProviderName,
  cliCommand: string,
): string {
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
  detail?: string,
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
  model: string,
): NodeJS.ProcessEnv {
  const definition = PROVIDER_DEFINITIONS[providerName];
  const resolvedAuthMode = resolveProviderAuthMode(
    providerName,
    authMode,
    definition.authMode,
  );
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  for (const key of definition.resetEnvVars ?? []) {
    delete env[key];
  }

  Object.assign(
    env,
    definition.buildRuntimeEnv(apiKey, model, resolvedAuthMode),
  );
  return env;
}

export function buildProviderInvocationArgs(
  provider: ProviderConfig,
): string[] {
  const args = [...provider.cliArgs];
  if (!provider.reasoningEffort) {
    return args;
  }
  if (provider.cliCommand !== PROVIDER_DEFINITIONS[provider.name].cliCommand) {
    return args;
  }

  if (
    provider.name === "openai" &&
    normalizeProviderReasoningEffort(
      provider.name,
      provider.model,
      provider.reasoningEffort,
    )
  ) {
    const execIndex = args.indexOf("exec");
    if (execIndex < 0) {
      return args;
    }
    return [
      ...args.slice(0, execIndex + 1),
      "-c",
      `model_reasoning_effort="${provider.reasoningEffort}"`,
      ...args.slice(execIndex + 1),
    ];
  }

  if (
    provider.name === "anthropic" &&
    normalizeProviderReasoningEffort(
      provider.name,
      provider.model,
      provider.reasoningEffort,
    )
  ) {
    const separatorIndex = args.indexOf("--");
    if (separatorIndex >= 0) {
      return [
        ...args.slice(0, separatorIndex),
        "--effort",
        provider.reasoningEffort,
        ...args.slice(separatorIndex),
      ];
    }
    return [...args, "--effort", provider.reasoningEffort];
  }

  if (
    provider.runtime === "pi" &&
    normalizeProviderReasoningEffort(
      provider.name,
      provider.model,
      provider.reasoningEffort,
    )
  ) {
    // The pi arg set ends with the positional user message, so the flag has to
    // go ahead of it and keep that token last.
    const userMessageIndex = args.findIndex((arg) =>
      arg.includes("{user_message}"),
    );
    if (userMessageIndex >= 0) {
      return [
        ...args.slice(0, userMessageIndex),
        "--thinking",
        provider.reasoningEffort,
        ...args.slice(userMessageIndex),
      ];
    }
    return [...args, "--thinking", provider.reasoningEffort];
  }

  return args;
}

function requireApiKey(value: string | null, keyName: string): string {
  if (!value) {
    throw new Error(`Missing required provider API key (${keyName}).`);
  }
  return value;
}
