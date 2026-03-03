import { getProviderSetupDefaults, normalizeProviderName } from "./provider.js";
import type { OpenColabRuntime } from "./runtime.js";
import type { ProviderName } from "./types.js";

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
  choose?(prompt: string, options: string[], defaultValue: string): Promise<string>;
  write(line: string): void;
}

const PROVIDER_MODEL_OPTIONS: Record<ProviderName, string[]> = {
  openai: ["gpt-5.3-codex", "gpt-5-codex", "gpt-5"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-5"]
};

export interface IgniteDependencies {
  syncTelegramCommands: (
    botTokenReference: string,
    chatId?: string | null
  ) => Promise<SyncTelegramCommandsResult>;
}

export async function runIgnite(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies
): Promise<void> {
  io.write("Onboarding");
  io.write("Enter = accept defaults. Esc = skip section.");
  io.write("");

  await runStep(io, "* Project create or select active project", async (stepIo) =>
    selectProject(runtime, stepIo)
  );
  io.write("|");
  await runStep(io, "* Provider configure model and runtime", async (stepIo) =>
    configureProvider(runtime, stepIo)
  );
  io.write("|");
  await runStep(io, "* Telegram configure chat and pairing", async (stepIo) =>
    configureTelegram(runtime, stepIo, deps)
  );
  io.write("|");
  await runStep(io, "* Additional agent optional extra agent setup", async (stepIo) =>
    configureAdditionalAgent(runtime, stepIo)
  );

  const state = runtime.getState();
  const project = runtime.getActiveProject();
  const agent = runtime.getActiveAgent();
  io.write("");
  io.write("Onboarding complete.");
  io.write(`Active project: ${project.id} (${project.path})`);
  io.write(`Active agent: ${agent.id} (${agent.path})`);
  io.write(`Provider: ${project.provider.name} (${project.provider.model})`);
  io.write(`Telegram chat: ${state.telegram.chatId ?? "not configured"}`);
  io.write(`Telegram paired: ${state.telegram.paired ? "yes" : "no"}`);
  io.write("Next: opencolab gateway start --port 4646");
}

async function runStep(
  io: IgniteIo,
  title: string,
  run: (stepIo: IgniteIo) => Promise<void>
): Promise<void> {
  io.write(title);
  const choose = io.choose;
  const stepIo: IgniteIo = {
    ask: async (prompt) => io.ask(`| ${prompt}`),
    choose: choose
      ? async (prompt, options, defaultValue) =>
          choose(`| ${prompt}`, options, defaultValue)
      : undefined,
    write: (line) => io.write(`| ${line}`)
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

async function selectProject(runtime: OpenColabRuntime, io: IgniteIo): Promise<void> {
  const currentProject = runtime.getActiveProject();
  const knownProjects = new Set(runtime.listProjects().map((project) => project.id));

  while (true) {
    const projectId = await askWithDefault(io, "Project id to use", currentProject.id);
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

async function configureProvider(runtime: OpenColabRuntime, io: IgniteIo): Promise<void> {
  const project = runtime.getActiveProject();
  const currentProvider = project.provider;
  const providerName = await askProviderName(io, currentProvider.name);
  const providerDefaults = getProviderSetupDefaults(providerName);
  const useCurrentProviderDefaults = providerName === currentProvider.name;

  const defaultModel = useCurrentProviderDefaults ? currentProvider.model : providerDefaults.model;
  const defaultApiKeyEnvVar = useCurrentProviderDefaults
    ? currentProvider.apiKeyEnvVar
    : providerDefaults.apiKeyEnvVar;
  const defaultCliCommand = useCurrentProviderDefaults
    ? currentProvider.cliCommand
    : providerDefaults.cliCommand;
  const defaultCliArgs = useCurrentProviderDefaults ? currentProvider.cliArgs : providerDefaults.cliArgs;
  const modelOptions = withFallbackOption(PROVIDER_MODEL_OPTIONS[providerName], defaultModel);

  const model = await askFromOptions(io, "Model", modelOptions, defaultModel);
  const apiKeyEnvVar = await askWithDefault(io, "API key env var", defaultApiKeyEnvVar);
  const cliCommand = await askWithDefault(io, "CLI command", defaultCliCommand);
  const cliArgsInput = await askWithDefault(io, "CLI args (comma-separated)", defaultCliArgs.join(","));
  const cliArgs = parseCsvInput(cliArgsInput, defaultCliArgs);

  runtime.setupModel({
    providerName,
    model,
    apiKeyEnvVar,
    cliCommand,
    cliArgs
  });

  io.write(`Provider configured for project '${project.id}': ${providerName}`);
}

async function configureTelegram(
  runtime: OpenColabRuntime,
  io: IgniteIo,
  deps: IgniteDependencies
): Promise<void> {
  const telegram = runtime.getState().telegram;
  const hasChat = Boolean(telegram.chatId);

  const shouldConfigure = await askYesNo(
    io,
    hasChat ? "Update Telegram settings?" : "Configure Telegram now?",
    !hasChat
  );

  if (shouldConfigure) {
    const botTokenEnvVar = await askWithDefault(io, "Telegram bot token env var", telegram.botTokenEnvVar);
    const chatId = await askRequiredWithOptionalDefault(
      io,
      "Telegram chat id",
      telegram.chatId ?? undefined
    );

    runtime.setupTelegram({
      botTokenEnvVar,
      chatId
    });
    io.write(`Telegram configured for chat: ${chatId}`);

    const syncResult = await deps.syncTelegramCommands(
      runtime.getState().telegram.botTokenEnvVar,
      runtime.getState().telegram.chatId
    );
    if (syncResult.ok) {
      io.write("Telegram bot commands synced.");
    } else {
      io.write(`Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`);
    }
  } else {
    io.write("Telegram setup skipped.");
  }

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
    io.write("Pairing skipped. Run 'opencolab setup telegram pair start' when ready.");
    return;
  }

  try {
    const pairing = await runtime.startPairing();
    io.write(`Pairing code sent to Telegram (expires ${pairing.expiresAt}).`);
    const code = await askOptional(io, "Enter pairing code (leave blank to skip)");
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

async function configureAdditionalAgent(runtime: OpenColabRuntime, io: IgniteIo): Promise<void> {
  const shouldCreateAgent = await askYesNo(io, "Create an additional agent now?", false);
  if (!shouldCreateAgent) {
    io.write("Additional agent setup skipped.");
    return;
  }

  while (true) {
    const agentId = await askRequiredWithOptionalDefault(io, "Agent id");
    const agentPath = await askOptional(io, "Agent path override (leave blank for default)");

    try {
      runtime.configureAgent(agentId, agentPath ?? undefined);
      const activeAgent = runtime.getActiveAgent();
      io.write(`Agent configured: ${activeAgent.id} (${activeAgent.path})`);
      return;
    } catch (error) {
      io.write(error instanceof Error ? error.message : String(error));
    }
  }
}

async function askProviderName(io: IgniteIo, fallback: ProviderName): Promise<ProviderName> {
  const options: ProviderName[] = ["openai", "anthropic"];
  while (true) {
    const answer = (await askFromOptions(io, "Provider", options, fallback)).toLowerCase();
    const normalized = normalizeProviderName(answer);
    if (normalized) {
      return normalized;
    }

    io.write("Invalid provider. Use 'openai' or 'anthropic'.");
  }
}

async function askFromOptions(
  io: IgniteIo,
  label: string,
  options: string[],
  defaultValue: string
): Promise<string> {
  if (io.choose) {
    const selected = await io.choose(`${label}:`, options, defaultValue);
    throwIfEsc(selected);
    return selected;
  }

  return askWithDefault(io, `${label} (${options.join("|")})`, defaultValue);
}

async function askWithDefault(io: IgniteIo, label: string, defaultValue: string): Promise<string> {
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
  defaultValue?: string
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

async function askOptional(io: IgniteIo, label: string): Promise<string | null> {
  const answer = await io.ask(`${label}: `);
  throwIfEsc(answer);
  const trimmed = answer.trim();
  return trimmed ? trimmed : null;
}

async function askYesNo(io: IgniteIo, label: string, defaultValue: boolean): Promise<boolean> {
  const fallback = defaultValue ? "Y/n" : "y/N";
  const raw = await io.ask(`${label} [${fallback}]: `);
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

function parseCsvInput(value: string, fallback: string[]): string[] {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    return [...fallback];
  }

  return parsed;
}

function withFallbackOption(options: string[], value: string): string[] {
  if (options.includes(value)) {
    return options;
  }

  return [value, ...options];
}

function throwIfEsc(answer: string): void {
  if (answer === ESC_INPUT) {
    throw new StepSkippedError();
  }
}
