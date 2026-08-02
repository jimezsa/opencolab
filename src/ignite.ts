/**
 * Interactive first-run onboarding flow.
 * Configures project/provider/Telegram state and persists secrets to .env.local.
 */
import {
  getProviderDefaultReasoningEffort,
  getProviderSetupDefaults,
  getProviderReasoningEffortOptions,
  getProviderSupportedAuthModes,
  getProviderOauthSetupHint,
  getSupportedProviderNames,
  normalizeProviderReasoningEffort,
  normalizeProviderAuthMode,
  resolveProviderAuthMode,
  resolveProviderReasoningEffort,
  normalizeProviderName,
} from "./provider.js";
import type { OpenColabRuntime } from "./runtime.js";
import {
  getProviderApiKeyEnvVar,
  resolveProviderApiKey,
  resolveRunpodApiKey,
  RUNPOD_API_KEY_ENV_VAR,
  resolveTelegramBotToken,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  writeSecretToLocalEnv,
} from "./secrets.js";
import type {
  ProviderAuthMode,
  ProviderName,
  ProviderReasoningEffort
} from "./types.js";
import type { TelegramHandshakeResult } from "./telegram-poller.js";

const ESC_INPUT = "\u001b";

class StepSkippedError extends Error {
  constructor() {
    super("step_skipped");
  }
}

interface SyncTelegramCommandsResult {
  ok: boolean;
  error?: string;
}

export interface IgniteIo {
  ask(prompt: string): Promise<string>;
  choose?(
    prompt: string,
    options: string[],
    defaultValue: string,
  ): Promise<string>;
  confirm?(prompt: string, defaultValue: boolean): Promise<string>;
  write(line: string): void;
}

const PROVIDER_MODEL_OPTIONS: Record<ProviderName, string[]> = {
  openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
  anthropic: ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5"],
  gemini: [
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
  minimax: ["MiniMax-M2.7", "MiniMax-M2.5"],
  xai: [
    "grok-4.20-beta-0309-reasoning",
    "grok-4",
    "grok-4-1-fast-reasoning",
    "grok-4-fast-reasoning",
    "grok-code-fast-1",
    "grok-4-fast-non-reasoning",
  ],
  openrouter: [
    "openai/gpt-5.5",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-sonnet-4.6",
    "google/gemini-2.5-pro",
    "moonshotai/kimi-k3",
    "moonshotai/kimi-k2.5",
    "x-ai/grok-code-fast-1",
  ],
  kimi: ["k2p5", "kimi-k2-thinking"],
};
const BUILT_IN_TOOLS_PROVIDER: ProviderName = "gemini";
const PAGEINDEX_GROUNDED_PROVIDER: ProviderName = "gemini";
const PROVIDER_API_KEY_SETUP_URLS: Record<ProviderName, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  minimax: "https://platform.minimax.io/user-center/basic-information",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/docs/api-reference/authentication",
  kimi: "https://platform.moonshot.ai/console/api-keys"
};
const RUNPOD_API_KEY_SETUP_URL = "https://www.runpod.io/console/user/settings";
const TELEGRAM_BOT_TOKEN_SETUP_URL = "https://t.me/BotFather";
const TELEGRAM_HANDSHAKE_TIMEOUT_MS = 3 * 60 * 1000;

export interface TelegramHandshakeRequest {
  timeoutMs?: number;
  onBotInfo?: (username: string | null) => void;
  onWaiting?: (elapsedSeconds: number) => void;
}

export interface IgniteDependencies {
  syncTelegramCommands: (
    chatId?: string | null,
  ) => Promise<SyncTelegramCommandsResult>;
  /**
   * Waits for the user to message the bot and returns the detected chat, or
   * null on timeout/conflict. When omitted, Telegram setup falls back to
   * manual chat-id entry plus the pairing-code flow.
   */
  waitForTelegramHandshake?: (
    request: TelegramHandshakeRequest,
  ) => Promise<TelegramHandshakeResult | null>;
}

export async function runIgnite(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  io.write("Onboarding");
  io.write("Enter = accept defaults. Esc = skip section.");
  io.write("");

  await runStep(
    io,
    "* Project create or select active project",
    async (stepIo) => selectProject(runtime, stepIo),
  );
  io.write("|");
  await runStep(io, "* Provider configure model and auth", async (stepIo) =>
    configureProvider(runtime, stepIo),
  );
  io.write("|");
  await runStep(
    io,
    "* Built-in tools configure shared skill keys",
    async (stepIo) => configureBuiltInTools(runtime, stepIo),
  );
  io.write("|");
  await runStep(io, "* Telegram configure chat and pairing", async (stepIo) =>
    configureTelegram(runtime, stepIo, deps),
  );
  io.write("|");
  await runStep(io, "* Runpod configure optional GPU server", async (stepIo) =>
    configureRunpod(runtime, stepIo),
  );

  const state = runtime.getState();
  const project = runtime.getActiveProject();
  const agent = runtime.getActiveAgent();
  io.write("");
  io.write("Onboarding complete.");
  io.write(`Active project: ${project.id} (${project.path})`);
  io.write(`Active agent: ${agent.id} (${agent.path})`);
  io.write(`Provider: ${formatProviderSummary(agent.provider)}`);
  io.write(`Telegram chat: ${state.telegram.chatId ?? "not configured"}`);
  io.write(`Telegram paired: ${state.telegram.paired ? "yes" : "no"}`);
  io.write(`GPU servers: ${Object.keys(project.executionTargets).length}`);
  io.write("Next: opencolab gateway start --port 4646");
}

async function runStep(
  io: IgniteIo,
  title: string,
  run: (stepIo: IgniteIo) => Promise<void>,
): Promise<void> {
  io.write(title);
  const choose = io.choose;
  const confirm = io.confirm;
  const stepIo: IgniteIo = {
    ask: async (prompt) => io.ask(`| ${prompt}`),
    choose: choose
      ? async (prompt, options, defaultValue) =>
          choose(`| ${prompt}`, options, defaultValue)
      : undefined,
    confirm: confirm
      ? async (prompt, defaultValue) => confirm(`| ${prompt}`, defaultValue)
      : undefined,
    write: (line) => io.write(`| ${line}`),
  };
  try {
    await run(stepIo);
  } catch (error) {
    if (error instanceof StepSkippedError) {
      io.write("| Step skipped.");
      return;
    }
    throw error;
  }
}

async function selectProject(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  const currentProject = runtime.getActiveProject();
  const knownProjects = new Set(
    runtime.listProjects().map((project) => project.id),
  );

  while (true) {
    const projectId = await askWithDefault(
      io,
      "Project id to use",
      currentProject.id,
    );
    try {
      if (knownProjects.has(projectId)) {
        runtime.useProject(projectId);
        io.write(`Using existing project: ${projectId}`);
      } else {
        runtime.createProject(projectId);
        io.write(`Created project: ${projectId}`);
      }
      return;
    } catch (error) {
      io.write(error instanceof Error ? error.message : String(error));
    }
  }
}

async function configureProvider(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  const project = runtime.getActiveProject();
  const agent = runtime.getActiveAgent();
  const currentProvider = agent.provider;
  const currentProviderDefaults = getProviderSetupDefaults(
    currentProvider.name,
  );
  const currentAuthMode = resolveProviderAuthMode(
    currentProvider.name,
    currentProvider.authMode,
    currentProviderDefaults.authMode,
  );
  const currentProviderEnvVar = getProviderApiKeyEnvVar(currentProvider.name);
  const hasCurrentProviderKey =
    resolveProviderApiKey(currentProvider.name) !== null;
  const hasCurrentProviderAuth =
    currentAuthMode === "oauth" || hasCurrentProviderKey;

  if (hasCurrentProviderAuth) {
    const keepCurrent = await askYesNo(
      io,
      `Provider already configured (${formatProviderSummary({
        ...currentProvider,
        authMode: currentAuthMode
      })}). Keep current setup?`,
      true,
    );
    if (keepCurrent) {
      io.write(
        `Provider unchanged for agent '${agent.id}' in project '${project.id}': ${formatProviderSummary({
          ...currentProvider,
          authMode: currentAuthMode
        })}.`,
      );
      return;
    }
  } else if (currentAuthMode === "api_key") {
    io.write(`Provider key not found in environment: ${currentProviderEnvVar}`);
  }

  const providerName = await askProviderName(io, currentProvider.name);
  const providerDefaults = getProviderSetupDefaults(providerName);
  const useCurrentProviderDefaults = providerName === currentProvider.name;
  const defaultAuthMode = useCurrentProviderDefaults
    ? resolveProviderAuthMode(
        providerName,
        currentProvider.authMode,
        providerDefaults.authMode,
      )
    : providerDefaults.authMode;

  const defaultModel = useCurrentProviderDefaults
    ? currentProvider.model
    : providerDefaults.model;
  const modelOptions = withFallbackOption(
    PROVIDER_MODEL_OPTIONS[providerName],
    defaultModel,
  );
  const providerApiKeyEnvVar = getProviderApiKeyEnvVar(providerName);
  const authMode = await askProviderAuthMode(io, providerName, defaultAuthMode);

  const model = await askFromOptions(io, "Model", modelOptions, defaultModel);
  const defaultReasoningEffort =
    useCurrentProviderDefaults && model === currentProvider.model
      ? resolveProviderReasoningEffort(
          providerName,
          model,
          currentProvider.reasoningEffort,
          currentProvider.reasoningEffort,
        )
      : getProviderDefaultReasoningEffort(providerName, model);
  const reasoningEffort = await askProviderReasoningEffort(
    io,
    providerName,
    model,
    defaultReasoningEffort,
  );
  if (authMode === "api_key") {
    const existingProviderKey = resolveProviderApiKey(providerName);
    let shouldWriteProviderKey = true;

    if (existingProviderKey) {
      shouldWriteProviderKey = !(await askYesNo(
        io,
        `${providerApiKeyEnvVar} already has a value. Keep it?`,
        true,
      ));
    }

    if (shouldWriteProviderKey) {
      writeApiKeySetupLink(io, providerApiKeyEnvVar, providerName);
      const providerApiKey = await askRequiredWithOptionalDefault(
        io,
        `${providerApiKeyEnvVar} value`,
      );
      writeSecretToLocalEnv(
        runtime.config.rootDir,
        providerApiKeyEnvVar,
        providerApiKey,
      );
      io.write(`Saved ${providerApiKeyEnvVar} in .env.local.`);
    }
  } else {
    io.write(
      `Using ${providerName} OAuth auth mode. ${getProviderOauthSetupHint(providerName, providerDefaults.cliCommand)}`,
    );
  }

  runtime.setupModel({
    agentId: agent.id,
    providerName,
    model,
    authMode,
    reasoningEffort,
  });

  io.write(
    `Provider configured for agent '${agent.id}' in project '${project.id}': ${formatProviderSummary(runtime.getActiveAgent().provider)}, runtime ${runtime.getActiveAgent().provider.runtime}.`,
  );
}

async function configureTelegram(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  if (typeof deps.waitForTelegramHandshake === "function") {
    await configureTelegramHandshake(runtime, io, deps);
    return;
  }

  await configureTelegramManual(runtime, io, deps);
}

async function configureTelegramHandshake(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  const telegram = runtime.getState().telegram;
  const hasToken = resolveTelegramBotToken() !== null;
  const fullyConfigured = Boolean(telegram.chatId) && hasToken && telegram.paired;

  const shouldConfigure = await askYesNo(
    io,
    fullyConfigured
      ? "Telegram already paired. Reconfigure?"
      : "Configure Telegram now?",
    !fullyConfigured,
  );

  if (!shouldConfigure) {
    io.write("Telegram setup skipped.");
    return;
  }

  await configureTelegramToken(runtime, io, hasToken);
  await pairTelegramViaHandshake(runtime, io, deps);
}

async function pairTelegramViaHandshake(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  const waitForHandshake = deps.waitForTelegramHandshake;
  if (!waitForHandshake) {
    await promptManualChatId(runtime, io, deps);
    await pairTelegramWithCode(runtime, io, deps);
    return;
  }

  while (true) {
    io.write(
      'Finish pairing from Telegram: open your bot and send it any message (for example "hello").',
    );

    const result = await waitForHandshake({
      timeoutMs: TELEGRAM_HANDSHAKE_TIMEOUT_MS,
      onBotInfo: (username) => {
        if (username) {
          io.write(`Your bot: https://t.me/${username} (@${username})`);
        }
      },
      onWaiting: (elapsedSeconds) => {
        io.write(`Waiting for your Telegram message… (${elapsedSeconds}s elapsed)`);
      },
    });

    if (result) {
      runtime.markTelegramPaired(result.chatId);
      io.write(`Telegram paired with ${result.sender} (chat ${result.chatId}).`);
      await syncTelegramCommandsAndReport(deps, io, result.chatId);
      return;
    }

    io.write("No Telegram message received before the timeout.");
    const retry = await askYesNo(io, "Try the Telegram handshake again?", true);
    if (retry) {
      continue;
    }

    const manual = await askYesNo(
      io,
      "Enter the Telegram chat id manually instead?",
      false,
    );
    if (manual) {
      await promptManualChatId(runtime, io, deps);
      await pairTelegramWithCode(runtime, io, deps);
      return;
    }

    io.write(
      "Telegram pairing skipped. Run 'opencolab setup telegram pair start' when ready.",
    );
    return;
  }
}

async function configureTelegramManual(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  const telegram = runtime.getState().telegram;
  const hasChat = Boolean(telegram.chatId);
  const hasToken = resolveTelegramBotToken() !== null;
  const fullyConfigured = hasChat && hasToken;

  const shouldConfigure = await askYesNo(
    io,
    fullyConfigured
      ? "Telegram already configured. Update settings?"
      : "Configure Telegram now?",
    !fullyConfigured,
  );

  if (shouldConfigure) {
    await configureTelegramToken(runtime, io, hasToken);
    await promptManualChatId(runtime, io, deps);
  } else {
    io.write("Telegram setup skipped.");
  }

  await pairTelegramWithCode(runtime, io, deps);
}

async function configureTelegramToken(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  hasToken: boolean,
): Promise<void> {
  const keepExistingToken =
    hasToken &&
    (await askYesNo(
      io,
      `${TELEGRAM_BOT_TOKEN_ENV_VAR} already has a value. Keep it?`,
      true,
    ));
  if (keepExistingToken) {
    return;
  }

  writeTelegramBotTokenSetupHelp(io);
  const botToken = await askRequiredWithOptionalDefault(
    io,
    `${TELEGRAM_BOT_TOKEN_ENV_VAR} value`,
  );
  writeSecretToLocalEnv(
    runtime.config.rootDir,
    TELEGRAM_BOT_TOKEN_ENV_VAR,
    botToken,
  );
  io.write(`Saved ${TELEGRAM_BOT_TOKEN_ENV_VAR} in .env.local.`);
}

async function promptManualChatId(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  const chatId = await askRequiredWithOptionalDefault(
    io,
    "Telegram chat id",
    runtime.getState().telegram.chatId ?? undefined,
  );

  runtime.setupTelegram({
    chatId,
  });
  io.write(`Telegram configured for chat: ${chatId}`);

  await syncTelegramCommandsAndReport(
    deps,
    io,
    runtime.getState().telegram.chatId,
  );
}

async function syncTelegramCommandsAndReport(
  deps: IgniteDependencies,
  io: IgniteIo,
  chatId?: string | null,
): Promise<void> {
  const syncResult = await deps.syncTelegramCommands(chatId);
  if (syncResult.ok) {
    io.write("Telegram bot commands synced.");
  } else {
    io.write(
      `Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`,
    );
  }
}

async function pairTelegramWithCode(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies,
): Promise<void> {
  const current = runtime.getState().telegram;
  if (!current.chatId) {
    io.write("Pairing skipped because Telegram chat is not configured.");
    return;
  }

  if (current.paired) {
    io.write("Telegram pairing already completed.");
    return;
  }

  const shouldPair = await askYesNo(io, "Start Telegram pairing now?", true);
  if (!shouldPair) {
    io.write(
      "Pairing skipped. Run 'opencolab setup telegram pair start' when ready.",
    );
    return;
  }

  try {
    const pairing = await runtime.startPairing();
    io.write(`Pairing code sent to Telegram (expires ${pairing.expiresAt}).`);
    const code = await askOptional(
      io,
      "Enter pairing code (leave blank to skip)",
    );
    if (!code) {
      io.write("Pairing completion skipped.");
      return;
    }

    const completed = runtime.completePairing(code);
    io.write(`Telegram pairing completed at ${completed.pairedAt}.`);
  } catch (error) {
    io.write(error instanceof Error ? error.message : String(error));
    io.write("Run 'opencolab setup telegram pair start' to retry pairing.");
  }
}

async function configureBuiltInTools(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  await configureGeminiBuiltInTools(runtime, io);
  await configurePageIndexGrounded(runtime, io);
}

async function configureRunpod(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  const project = runtime.getActiveProject();
  const existingApiKey = resolveRunpodApiKey();
  const existingTargets = runtime.listExecutionTargets();
  const shouldConfigure = await askYesNo(
    io,
    existingApiKey || existingTargets.length > 0
      ? "Runpod already has some setup. Update it?"
      : "Configure optional Runpod GPU execution now?",
    false,
  );

  if (!shouldConfigure) {
    io.write("Runpod setup skipped.");
    return;
  }

  if (existingApiKey) {
    const keepExisting = await askYesNo(
      io,
      `${RUNPOD_API_KEY_ENV_VAR} already has a value. Keep it?`,
      true,
    );
    if (!keepExisting) {
      writeRunpodApiKeySetupLink(io);
      const apiKey = await askRequiredWithOptionalDefault(io, `${RUNPOD_API_KEY_ENV_VAR} value`);
      writeSecretToLocalEnv(runtime.config.rootDir, RUNPOD_API_KEY_ENV_VAR, apiKey);
      io.write(`Saved ${RUNPOD_API_KEY_ENV_VAR} in .env.local.`);
    }
  } else {
    const shouldWriteKey = await askYesNo(
      io,
      `Add ${RUNPOD_API_KEY_ENV_VAR} now so Runpod validation and jobs can run?`,
      true,
    );
    if (shouldWriteKey) {
      writeRunpodApiKeySetupLink(io);
      const apiKey = await askRequiredWithOptionalDefault(io, `${RUNPOD_API_KEY_ENV_VAR} value`);
      writeSecretToLocalEnv(runtime.config.rootDir, RUNPOD_API_KEY_ENV_VAR, apiKey);
      io.write(`Saved ${RUNPOD_API_KEY_ENV_VAR} in .env.local.`);
    } else {
      io.write(`Runpod API key skipped. Set ${RUNPOD_API_KEY_ENV_VAR} later to enable GPU jobs.`);
    }
  }

  const shouldCreateServer = await askYesNo(
    io,
    existingTargets.length > 0
      ? "Create or update a default Runpod GPU server for this project?"
      : "Create the first default Runpod GPU server for this project?",
    true,
  );
  if (!shouldCreateServer) {
    io.write("GPU server creation skipped.");
    return;
  }

  const defaultServerId = existingTargets[0]?.id ?? "runpod-a100";
  const serverId = await askWithDefault(io, "GPU server id", defaultServerId);
  runtime.setupExecutionTarget({
    id: serverId,
    datacenterId: "US-KS-2",
    gpuType: "NVIDIA A100 80GB PCIe",
    gpuCount: 1,
    volumeName: `${project.id}-${serverId}`,
    volumeSizeGb: 200,
    workspaceRoot: "/workspace",
    bootstrapProfile: "pytorch-cu12",
    maxRuntimeMinutes: 360,
    autoStopPolicy: "keep_warm"
  });
  io.write(`Configured Runpod GPU server '${serverId}' with the curated A100 preset.`);

  const shouldTest = await askYesNo(
    io,
    "Run lightweight GPU server validation now?",
    false,
  );
  if (!shouldTest) {
    io.write("GPU server validation skipped.");
    return;
  }

  try {
    const result = await runtime.testExecutionTarget(serverId);
    io.write(`Validation result for '${serverId}': ${result.ok ? "ready" : "warnings"}.`);
    for (const detail of result.details) {
      io.write(detail);
    }
    for (const warning of result.warnings) {
      io.write(`Warning: ${warning}`);
    }
  } catch (error) {
    io.write(error instanceof Error ? error.message : String(error));
    io.write("Run 'opencolab gpu server test --server-id <id>' after fixing the prerequisites.");
  }
}

async function configureGeminiBuiltInTools(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  const builtInToolsEnvVar = getProviderApiKeyEnvVar(BUILT_IN_TOOLS_PROVIDER);
  const existingBuiltInToolsKey = resolveProviderApiKey(BUILT_IN_TOOLS_PROVIDER);
  const activeProvider = runtime.getActiveAgent().provider;
  const activeProviderDefaults = getProviderSetupDefaults(activeProvider.name);
  const activeProviderAuthMode = resolveProviderAuthMode(
    activeProvider.name,
    activeProvider.authMode,
    activeProviderDefaults.authMode,
  );

  if (
    activeProvider.name === BUILT_IN_TOOLS_PROVIDER &&
    activeProviderAuthMode === "api_key" &&
    existingBuiltInToolsKey
  ) {
    io.write(
      `Built-in shared tools use ${builtInToolsEnvVar}. Already configured via the active Gemini provider setup.`,
    );
    return;
  }

  if (existingBuiltInToolsKey) {
    const keepExisting = await askYesNo(
      io,
      `${builtInToolsEnvVar} already has a value for Gemini-based built-in shared tools. Keep it?`,
      true,
    );
    if (keepExisting) {
      io.write(
        `Built-in shared tools will use the existing ${builtInToolsEnvVar}.`,
      );
      return;
    }
  } else {
    const shouldConfigure = await askYesNo(
      io,
      `Add ${builtInToolsEnvVar} now so Gemini-based built-in shared tools work?`,
      true,
    );
    if (!shouldConfigure) {
      io.write(
        `Built-in shared tools skipped. Set ${builtInToolsEnvVar} later to enable Gemini-based shared tools.`,
      );
      return;
    }
  }

  writeApiKeySetupLink(io, builtInToolsEnvVar, BUILT_IN_TOOLS_PROVIDER);
  const builtInToolsApiKey = await askRequiredWithOptionalDefault(
    io,
    `${builtInToolsEnvVar} value`,
  );
  writeSecretToLocalEnv(
    runtime.config.rootDir,
    builtInToolsEnvVar,
    builtInToolsApiKey,
  );
  io.write(`Saved ${builtInToolsEnvVar} in .env.local for shared tools.`);
}

async function configurePageIndexGrounded(
  runtime: OpenColabRuntime,
  io: IgniteIo,
): Promise<void> {
  const pageIndexEnvVar = getProviderApiKeyEnvVar(PAGEINDEX_GROUNDED_PROVIDER);
  const existingPageIndexKey = resolveProviderApiKey(PAGEINDEX_GROUNDED_PROVIDER);
  const activeProvider = runtime.getActiveAgent().provider;
  const activeProviderDefaults = getProviderSetupDefaults(activeProvider.name);
  const activeProviderAuthMode = resolveProviderAuthMode(
    activeProvider.name,
    activeProvider.authMode,
    activeProviderDefaults.authMode,
  );

  if (
    activeProvider.name === PAGEINDEX_GROUNDED_PROVIDER &&
    activeProviderAuthMode === "api_key" &&
    existingPageIndexKey
  ) {
    io.write(
      `pageindex-grounded can use ${pageIndexEnvVar}. Already configured via the active Gemini provider setup.`,
    );
    return;
  }

  if (existingPageIndexKey) {
    io.write(
      `pageindex-grounded can use the existing ${pageIndexEnvVar} for the local PageIndex runner.`,
    );
    return;
  }

  const shouldConfigure = await askYesNo(
    io,
    `Add ${pageIndexEnvVar} now so pageindex-grounded can use Gemini with the local PageIndex runner when tools/PageIndex is available?`,
    true,
  );
  if (!shouldConfigure) {
    io.write(
      `pageindex-grounded key setup skipped. Set ${pageIndexEnvVar} later if you want the local PageIndex runner.`,
    );
    return;
  }

  writeApiKeySetupLink(io, pageIndexEnvVar, PAGEINDEX_GROUNDED_PROVIDER);
  const pageIndexApiKey = await askRequiredWithOptionalDefault(
    io,
    `${pageIndexEnvVar} value`,
  );
  writeSecretToLocalEnv(runtime.config.rootDir, pageIndexEnvVar, pageIndexApiKey);
  io.write(`Saved ${pageIndexEnvVar} in .env.local for pageindex-grounded.`);
}

async function askProviderName(
  io: IgniteIo,
  fallback: ProviderName,
): Promise<ProviderName> {
  const options = getSupportedProviderNames();
  const supported = options.map((provider) => `'${provider}'`).join(", ");
  while (true) {
    const answer = (
      await askFromOptions(io, "Provider", options, fallback)
    ).toLowerCase();
    const normalized = normalizeProviderName(answer);
    if (normalized) {
      return normalized;
    }

    io.write(`Invalid provider. Use ${supported}.`);
  }
}

async function askProviderAuthMode(
  io: IgniteIo,
  providerName: ProviderName,
  fallback: ProviderAuthMode,
): Promise<ProviderAuthMode> {
  const supportedAuthModes = getProviderSupportedAuthModes(providerName);
  if (supportedAuthModes.length <= 1) {
    return supportedAuthModes[0] ?? "api_key";
  }

  const options = supportedAuthModes.map(formatProviderAuthMode);
  const defaultOption = formatProviderAuthMode(fallback);

  while (true) {
    const answer = await askFromOptions(
      io,
      "Auth mode",
      options,
      defaultOption,
    );
    const normalized = normalizeProviderAuthMode(answer);
    if (normalized && supportedAuthModes.includes(normalized)) {
      return normalized;
    }
    io.write(`Invalid auth mode. Use ${options.join(", ")}.`);
  }
}

async function askProviderReasoningEffort(
  io: IgniteIo,
  providerName: ProviderName,
  model: string,
  fallback?: ProviderReasoningEffort | null,
): Promise<ProviderReasoningEffort | undefined> {
  const options = getProviderReasoningEffortOptions(providerName, model);
  if (options.length === 0) {
    return undefined;
  }

  const defaultOption =
    resolveProviderReasoningEffort(providerName, model, fallback, fallback) ??
    options[0];

  while (true) {
    const answer = await askFromOptions(
      io,
      "Reasoning effort",
      options,
      defaultOption,
    );
    const normalized = normalizeProviderReasoningEffort(
      providerName,
      model,
      answer,
    );
    if (normalized) {
      return normalized;
    }

    io.write(`Invalid reasoning effort. Use ${options.join(", ")}.`);
  }
}

async function askFromOptions(
  io: IgniteIo,
  label: string,
  options: string[],
  defaultValue: string,
): Promise<string> {
  if (io.choose) {
    const selected = await io.choose(`${label}:`, options, defaultValue);
    throwIfEsc(selected);
    return selected;
  }

  return askWithDefault(io, `${label} (${options.join("|")})`, defaultValue);
}

async function askWithDefault(
  io: IgniteIo,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await io.ask(`${label} [${defaultValue}]: `);
  throwIfEsc(answer);
  const trimmed = answer.trim();
  if (trimmed) {
    return trimmed;
  }
  return defaultValue;
}

async function askRequiredWithOptionalDefault(
  io: IgniteIo,
  label: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await io.ask(`${label}${suffix}: `);
    throwIfEsc(answer);
    const trimmed = answer.trim();
    if (trimmed) {
      return trimmed;
    }

    if (defaultValue) {
      return defaultValue;
    }

    io.write(`${label} is required.`);
  }
}

async function askOptional(
  io: IgniteIo,
  label: string,
): Promise<string | null> {
  const answer = await io.ask(`${label}: `);
  throwIfEsc(answer);
  const trimmed = answer.trim();
  return trimmed ? trimmed : null;
}

async function askYesNo(
  io: IgniteIo,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const fallback = defaultValue ? "Y/n" : "y/N";
  const prompt = `${label} [${fallback}]: `;

  // Prefer a single-keypress confirmation so answering y/n advances the flow
  // immediately, matching the interactive chooser prompts. This also prevents a
  // pasted value (e.g. a bot token entered too early) from being appended to the
  // answer and rejected as invalid.
  if (io.confirm) {
    const raw = await io.confirm(prompt, defaultValue);
    throwIfEsc(raw);
    return raw.trim().toLowerCase() !== "n";
  }

  const raw = await io.ask(prompt);
  throwIfEsc(raw);
  const answer = raw.trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  if (answer === "y" || answer === "yes") {
    return true;
  }

  if (answer === "n" || answer === "no") {
    return false;
  }

  io.write("Please answer 'y' or 'n'.");
  return askYesNo(io, label, defaultValue);
}

function withFallbackOption(options: string[], value: string): string[] {
  if (options.includes(value)) {
    return options;
  }

  return [value, ...options];
}

function formatProviderAuthMode(value: ProviderAuthMode): string {
  return value.replaceAll("_", "-");
}

function formatProviderSummary(provider: {
  name: ProviderName;
  model: string;
  authMode: ProviderAuthMode;
  reasoningEffort?: ProviderReasoningEffort;
}): string {
  const details = [provider.model, formatProviderAuthMode(provider.authMode)];
  if (provider.reasoningEffort) {
    details.push(`reasoning ${provider.reasoningEffort}`);
  }
  return `${provider.name} (${details.join(", ")})`;
}

function writeApiKeySetupLink(
  io: IgniteIo,
  envVar: string,
  providerName: ProviderName,
): void {
  io.write(`Set ${envVar} here: ${PROVIDER_API_KEY_SETUP_URLS[providerName]}`);
}

function writeRunpodApiKeySetupLink(io: IgniteIo): void {
  io.write(`Set ${RUNPOD_API_KEY_ENV_VAR} here: ${RUNPOD_API_KEY_SETUP_URL}`);
}

function writeTelegramBotTokenSetupHelp(io: IgniteIo): void {
  io.write(
    `Create a Telegram bot token with BotFather: open ${TELEGRAM_BOT_TOKEN_SETUP_URL} and run /newbot.`,
  );
}

function throwIfEsc(answer: string): void {
  if (answer === ESC_INPUT) {
    throw new StepSkippedError();
  }
}
