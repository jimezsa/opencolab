#!/usr/bin/env node
/**
 * OpenColab CLI entrypoint.
 * Parses commands, runs onboarding/setup flows, and starts gateway services.
 */
import { emitKeypressEvents } from "node:readline";
import { startHttpServer } from "./http.js";
import { runIgnite } from "./ignite.js";
import { DEFAULT_AGENT_ID } from "./project-config.js";
import { getProviderSetupDefaults, normalizeProviderName } from "./provider.js";
import { createRuntime } from "./runtime.js";
import {
  getProviderApiKeyEnvVar,
  resolveProviderApiKey,
  resolveTelegramBotToken,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  writeSecretToLocalEnv
} from "./secrets.js";
import type { OpenColabState, ProviderName } from "./types.js";

const PROJECT_PET = "🐙";
const ESC_INPUT = "\u001b";
const ANSI_BOLD = "\u001b[1m";
const ANSI_ORANGE = "\u001b[38;5;208m";
const ANSI_WHITE = "\u001b[97m";
const ANSI_SOFT_WHITE = "\u001b[38;5;240m";
const ANSI_RESET = "\u001b[0m";
const HELP_DESCRIPTION_COLUMN = 20;

interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

interface TelegramMenuCommand {
  command: string;
  description: string;
}

interface TelegramApiResult {
  ok?: boolean;
  description?: string;
}

type TelegramCommandScope =
  | { type: "default" }
  | { type: "all_private_chats" }
  | { type: "all_group_chats" }
  | { type: "chat"; chat_id: string };

const TELEGRAM_MENU_COMMANDS: TelegramMenuCommand[] = [
  { command: "project_list", description: "List projects" },
  {
    command: "project_create",
    description: "Create project: /project_create <id>",
  },
  { command: "project_use", description: "Use project: /project_use <id>" },
  { command: "agent_list", description: "List agents" },
  { command: "agent_create", description: "Create agent: /agent_create <id>" },
  { command: "agent_use", description: "Use agent: /agent_use <id>" },
  { command: "session_reset", description: "Reset active session" },
  { command: "project", description: "Project command help" },
  { command: "agent", description: "Agent command help" },
  { command: "session", description: "Session command help" },
];

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";
}

function accent(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI_ORANGE}${value}${ANSI_RESET}`;
}

function white(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI_WHITE}${value}${ANSI_RESET}`;
}

function softWhite(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI_SOFT_WHITE}${value}${ANSI_RESET}`;
}

function bold(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI_BOLD}${value}${ANSI_RESET}`;
}

function boldWhite(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI_BOLD}${ANSI_WHITE}${value}${ANSI_RESET}`;
}

function helpCommand(command: string, description: string): string {
  const paddedCommand =
    command.length >= HELP_DESCRIPTION_COLUMN
      ? `${command} `
      : command.padEnd(HELP_DESCRIPTION_COLUMN, " ");
  return `  ${accent(paddedCommand)}${white(description)}`;
}

function helpFlag(flag: string, description: string): string {
  const paddedFlag =
    flag.length >= HELP_DESCRIPTION_COLUMN
      ? `${flag} `
      : flag.padEnd(HELP_DESCRIPTION_COLUMN, " ");
  return `  ${accent(paddedFlag)}${white(description)}`;
}

function helpExample(command: string, description: string): string[] {
  return [`  ${accent(command)}`, `   ${white(description)}`];
}

function styleCliText(value: string): string {
  const withCommands = value.replace(
    /\bopencolab(?:\s+[a-z0-9_./<>\-|]+)+/gi,
    (match) => accent(match),
  );
  const withFlags = withCommands
    .replace(/--[a-z0-9-]+/gi, (match) => accent(match))
    .replace(/^(\s*)\|\s(.+)$/, (_match, lead: string, rest: string) => {
      return `${lead}${softWhite("|")} ${softWhite(rest)}`;
    })
    .replace(/^(\s*)\|\s*$/, (_match, lead: string) => `${lead}${softWhite("|")}`)
    .replace(/^(\s*)\*\s(.+)$/, (_match, lead: string, rest: string) => {
      const [firstWord, ...tail] = rest.trim().split(/\s+/);
      const tailText = tail.join(" ");
      const first = firstWord ? boldWhite(firstWord) : "";
      const remainder = tailText ? ` ${softWhite(tailText)}` : "";
      return `${lead}${accent("*")} ${first}${remainder}`;
    });
  return withFlags;
}

async function askInteractive(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive onboarding requires a TTY terminal.");
  }

  return new Promise((resolve) => {
    let value = "";

    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
    };

    const onKeypress = (chunk: string, key: Keypress): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("^C\n");
        process.kill(process.pid, "SIGINT");
        return;
      }

      if (key.name === "escape") {
        cleanup();
        process.stdout.write("\n");
        resolve(ESC_INPUT);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }

      if (key.ctrl || key.meta || !chunk) {
        return;
      }

      value += chunk;
      process.stdout.write(chunk);
    };

    process.stdout.write(styleCliText(prompt));
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
  });
}

async function chooseInteractive(
  prompt: string,
  options: string[],
  defaultValue: string,
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive onboarding requires a TTY terminal.");
  }

  const normalizedOptions =
    options.length > 0 ? options : [defaultValue];
  const selectedDefaultIndex = normalizedOptions.indexOf(defaultValue);

  return new Promise((resolve) => {
    let selectedIndex =
      selectedDefaultIndex >= 0 ? selectedDefaultIndex : 0;
    let renderedLines = 0;

    const clearRender = (): void => {
      if (renderedLines <= 0) {
        return;
      }

      if (renderedLines > 1) {
        process.stdout.write(`\u001b[${renderedLines - 1}A`);
      }
      for (let index = 0; index < renderedLines; index += 1) {
        process.stdout.write("\u001b[2K\r");
        if (index < renderedLines - 1) {
          process.stdout.write("\u001b[1B");
        }
      }
      if (renderedLines > 1) {
        process.stdout.write(`\u001b[${renderedLines - 1}A`);
      }
      renderedLines = 0;
    };

    const render = (): void => {
      clearRender();
      const lines = [
        styleCliText(prompt),
        ...normalizedOptions.map((option, index) => {
          const text = `${index === selectedIndex ? ">" : " "} ${option}`;
          return index === selectedIndex ? white(text) : softWhite(text);
        }),
      ];

      lines.forEach((line, index) => {
        process.stdout.write(`${line}${index < lines.length - 1 ? "\n" : ""}`);
      });
      renderedLines = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      clearRender();
    };

    const onKeypress = (chunk: string, key: Keypress): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("^C\n");
        process.kill(process.pid, "SIGINT");
        return;
      }

      if (key.name === "escape") {
        cleanup();
        process.stdout.write("\n");
        resolve(ESC_INPUT);
        return;
      }

      if (key.name === "up") {
        selectedIndex =
          selectedIndex <= 0 ? normalizedOptions.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex =
          selectedIndex >= normalizedOptions.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const selected = normalizedOptions[selectedIndex] ?? defaultValue;
        cleanup();
        process.stdout.write(`${styleCliText(prompt)} ${white(selected)}\n`);
        resolve(selected);
        return;
      }

      if (key.ctrl || key.meta || !chunk) {
        return;
      }
    };

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
    render();
  });
}

function parseFlags(args: string[]): {
  values: Record<string, string>;
  positionals: string[];
} {
  const values: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      values[key] = "true";
      continue;
    }

    values[key] = next;
    index += 1;
  }

  return { values, positionals };
}

function formatHelp(lines: string[]): string {
  return lines.join("\n");
}

function usageMain(): string {
  return formatHelp([
    accent(bold(`${PROJECT_PET} OpenColab`)) + " multi-agent research lab",
    "",
    "Options:",
    helpCommand(
      "<command> --help",
      "Show detailed options for a command or subcommand",
    ),
    helpCommand("<command> <subcommand> --help", ""),
    "",
    "Usage:",
    `  ${accent("opencolab <command> [args]")}`,
    "",
    "Top-level commands:",
    helpCommand("ignite", "Interactive first-run setup"),
    helpCommand("setup", "Configure model/provider/telegram"),
    helpCommand("project", "Manage/create projects"),
    helpCommand("agent", "Manage/create agents"),
    helpCommand("gateway start", "Run local gateway server"),
    "",
    "Examples:",
    ...helpExample("opencolab setup --help", "Show setup command help"),
    ...helpExample("opencolab setup model --help", "Show setup model flags"),
    ...helpExample(
      "opencolab gateway start --help",
      "Show gateway start flags",
    ),
  ]);
}

function usageGateway(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gateway start [--port 4646] [--telegram-polling true|false]",
      "Start gateway server",
    ),
    "",
    "Flags:",
    helpFlag("--port <number>", "Gateway port (default: 4646)"),
    helpFlag("--telegram-polling true|false", "Enable or disable polling mode"),
  ]);
}

function usageIgnite(): string {
  return formatHelp([
    "Usage:",
    helpCommand("opencolab ignite", "Run interactive onboarding"),
    "",
    "Notes:",
    "  - Interactive setup for project/provider/telegram/agent.",
    "  - Press Esc to skip the current step.",
  ]);
}

function usageSetup(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup model [flags]",
      "Configure provider, model, and API key",
    ),
    helpCommand(
      "opencolab setup telegram [flags]",
      "Configure Telegram bot token/chat",
    ),
    helpCommand(
      "opencolab setup telegram commands sync [flags]",
      "Sync Telegram slash commands",
    ),
    helpCommand(
      "opencolab setup telegram pair start",
      "Start Telegram pairing",
    ),
    helpCommand(
      "opencolab setup telegram pair complete --code <pairing_code>",
      "Complete Telegram pairing",
    ),
    "",
    "Try:",
    helpCommand("setup model --help", "Show model setup flags"),
    helpCommand("setup telegram --help", "Show telegram setup flags"),
    helpCommand("setup telegram commands sync --help", "Show sync flags"),
    helpCommand("setup telegram pair --help", "Show pairing command help"),
  ]);
}

function usageSetupModel(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup model [--provider openai|anthropic] [--model <model>] [--api-key <value>]",
      "Configure active project runtime",
    ),
    "",
    "Flags:",
    helpFlag("--provider openai|anthropic", "Provider identifier"),
    helpFlag("--model <model>", "Provider model name"),
    helpFlag("--api-key <value>", "Provider API key value (saved to .env.local)"),
  ]);
}

function usageSetupTelegram(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup telegram --bot-token <value> --chat-id <id>",
      "Configure Telegram integration",
    ),
    "",
    "Flags:",
    helpFlag("--bot-token <value>", "Telegram bot token value (saved to .env.local)"),
    helpFlag("--chat-id <id>", "Authorized Telegram chat id"),
  ]);
}

function usageSetupTelegramCommandsSync(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup telegram commands sync [--chat-id <id>]",
      "Sync Telegram slash command menu",
    ),
    "",
    "Flags:",
    helpFlag("--chat-id <id>", "Specific chat for menu button setup"),
  ]);
}

function usageSetupTelegramPair(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup telegram pair start",
      "Send pairing code to Telegram",
    ),
    helpCommand(
      "opencolab setup telegram pair complete --code <pairing_code>",
      "Complete pairing with code",
    ),
    "",
    "Flags:",
    helpFlag("--code <pairing_code>", "Required for 'complete'"),
  ]);
}

function usageProject(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab project create --project-id <id>",
      "Create and select a project",
    ),
    helpCommand(
      "opencolab project use --project-id <id>",
      "Switch active project",
    ),
    helpCommand("opencolab project list", "List all projects"),
    helpCommand("opencolab project show", "Print active project JSON"),
  ]);
}

function usageAgent(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab agent create --agent-id <id> [--path projects/<project_id>/subagents/<agent_id>]",
      "Create/update and select an agent",
    ),
    helpCommand("opencolab agent use --agent-id <id>", "Switch active agent"),
    helpCommand("opencolab agent list", "List project agents"),
    helpCommand("opencolab agent show", "Print active agent JSON"),
  ]);
}

function resolveHelp(argv: string[]): string | null {
  const [command, subcommand, action] = argv;
  const wantsHelp =
    argv.length === 0 ||
    command === "help" ||
    argv.includes("--help") ||
    argv.includes("-h");

  if (!wantsHelp) {
    return null;
  }

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    return usageMain();
  }

  if (command === "ignite" || command === "onboard") {
    return usageIgnite();
  }

  if (command === "gateway" || command === "getway" || command === "web") {
    return usageGateway();
  }

  if (command === "setup") {
    if (subcommand === "model") {
      return usageSetupModel();
    }
    if (subcommand === "telegram") {
      if (action === "commands") {
        return usageSetupTelegramCommandsSync();
      }
      if (action === "pair") {
        return usageSetupTelegramPair();
      }
      return usageSetupTelegram();
    }
    return usageSetup();
  }

  if (command === "project") {
    return usageProject();
  }

  if (command === "agent") {
    return usageAgent();
  }

  return usageMain();
}

function parseProviderName(value: string | undefined): ProviderName {
  const parsed = normalizeProviderName(value ?? "openai");
  if (!parsed) {
    throw new Error(
      `Unsupported provider: ${value}. Use openai or anthropic.`,
    );
  }
  return parsed;
}

async function syncTelegramBotCommands(
  chatId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const token = resolveTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      error: `missing Telegram bot token (${TELEGRAM_BOT_TOKEN_ENV_VAR})`,
    };
  }

  try {
    const scopes: TelegramCommandScope[] = [
      { type: "default" },
      { type: "all_private_chats" },
      { type: "all_group_chats" },
      ...(chatId ? [{ type: "chat", chat_id: chatId } as const] : []),
    ];

    for (const scope of scopes) {
      const scopePayload =
        scope.type === "default"
          ? {}
          : scope.type === "chat"
            ? { scope: { type: "chat", chat_id: scope.chat_id } }
            : { scope: { type: scope.type } };

      const response = await fetch(
        `https://api.telegram.org/bot${token}/setMyCommands`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commands: TELEGRAM_MENU_COMMANDS,
            ...scopePayload,
          }),
        },
      );

      if (!response.ok) {
        const message = await response.text();
        return {
          ok: false,
          error: `[scope:${scope.type}] ${message || `telegram api status ${String(response.status)}`}`,
        };
      }

      const body = (await response.json()) as TelegramApiResult;
      if (body.ok !== true) {
        return {
          ok: false,
          error: `[scope:${scope.type}] ${body.description ?? "telegram returned ok=false"}`,
        };
      }
    }

    const menuTargets: Array<{
      label: string;
      payload: Record<string, unknown>;
    }> = [
      {
        label: "default",
        payload: {
          menu_button: { type: "commands" },
        },
      },
      ...(chatId
        ? [
            {
              label: "chat",
              payload: {
                chat_id: chatId,
                menu_button: { type: "commands" },
              },
            },
          ]
        : []),
    ];

    for (const target of menuTargets) {
      const menuResponse = await fetch(
        `https://api.telegram.org/bot${token}/setChatMenuButton`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(target.payload),
        },
      );

      if (!menuResponse.ok) {
        const message = await menuResponse.text();
        return {
          ok: false,
          error: `[menu:${target.label}] ${message || `telegram api status ${String(menuResponse.status)}`}`,
        };
      }

      const menuBody = (await menuResponse.json()) as TelegramApiResult;
      if (menuBody.ok !== true) {
        return {
          ok: false,
          error: `[menu:${target.label}] ${menuBody.description ?? "telegram returned ok=false"}`,
        };
      }
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function autoSyncTelegramCommandsIfConfigured(
  state: OpenColabState,
): Promise<{ attempted: boolean; ok: boolean; error?: string }> {
  if (!state.telegram.chatId) {
    return { attempted: false, ok: true };
  }

  const result = await syncTelegramBotCommands(state.telegram.chatId);
  return {
    attempted: true,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const [command, subcommand, action, ...rest] = argv;

  const help = resolveHelp(argv);
  if (help) {
    console.log(help);
    return;
  }

  if (
    (command === "gateway" || command === "getway" || command === "web") &&
    subcommand === "start"
  ) {
    const runtime = createRuntime();
    runtime.init();
    const autoSync = await autoSyncTelegramCommandsIfConfigured(
      runtime.getState(),
    );
    if (autoSync.attempted) {
      if (autoSync.ok) {
        console.log("Telegram bot commands synced.");
      } else {
        console.log(
          `Warning: could not sync Telegram commands (${autoSync.error ?? "unknown error"}).`,
        );
      }
    }

    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const port = Number(values.port ?? "4646");
    const telegramPolling =
      values["telegram-polling"] !== "false" &&
      values["telegram-polling"] !== "0";
    startHttpServer(port, process.cwd(), { telegramPolling });
    return;
  }

  const runtime = createRuntime();
  runtime.init();

  if (command === "init") {
    throw new Error(
      styleCliText("The 'init' command was removed. Use 'opencolab ignite'."),
    );
  }

  if (command === "ignite" || command === "onboard") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Interactive onboarding requires a TTY terminal.");
    }

    try {
      await runIgnite(
        runtime,
        {
          ask: async (prompt) => askInteractive(prompt),
          choose: async (prompt, options, defaultValue) =>
            chooseInteractive(prompt, options, defaultValue),
          write: (line) => {
            console.log(styleCliText(line));
          },
        },
        {
          syncTelegramCommands: syncTelegramBotCommands,
        },
      );
    } finally {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    }
    return;
  }

  if (command === "setup" && subcommand === "model") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const providerName = parseProviderName(values.provider);
    const providerDefaults = getProviderSetupDefaults(providerName);
    const keyEnvVar = getProviderApiKeyEnvVar(providerName);
    const apiKey = values["api-key"]?.trim() ?? "";
    if (apiKey) {
      writeSecretToLocalEnv(runtime.config.rootDir, keyEnvVar, apiKey);
    } else if (!resolveProviderApiKey(providerName)) {
      throw new Error(
        `Missing provider API key. Set ${keyEnvVar} in .env.local or pass ${accent("--api-key")} to save it automatically.`,
      );
    }

    runtime.setupModel({
      providerName,
      model: values.model ?? providerDefaults.model,
    });

    const project = runtime.getActiveProject();
    console.log(`Project: ${project.id}`);
    console.log(`Provider configured: ${project.provider.name}`);
    console.log(`Model: ${project.provider.model}`);
    console.log(`API key env var: ${keyEnvVar}`);
    console.log(
      `CLI: ${project.provider.cliCommand} ${project.provider.cliArgs.join(" ")}`,
    );
    return;
  }

  if (
    command === "setup" &&
    subcommand === "telegram" &&
    action === "commands"
  ) {
    const syncAction = rest[0];
    if (syncAction !== "sync") {
      throw new Error("Unknown telegram commands command. Use 'sync'.");
    }

    const { values } = parseFlags(rest.slice(1));
    const chatId = values["chat-id"] ?? runtime.getState().telegram.chatId;
    const syncResult = await syncTelegramBotCommands(chatId);
    if (!syncResult.ok) {
      throw new Error(
        `Could not sync Telegram commands: ${syncResult.error ?? "unknown error"}`,
      );
    }

    console.log("Telegram bot commands synced.");
    return;
  }

  if (
    command === "setup" &&
    subcommand === "telegram" &&
    action !== "pair" &&
    action !== "commands"
  ) {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const chatId = values["chat-id"];
    const botToken = values["bot-token"]?.trim() ?? "";

    if (!chatId) {
      throw new Error(`${accent("--chat-id")} is required`);
    }
    if (botToken) {
      writeSecretToLocalEnv(
        runtime.config.rootDir,
        TELEGRAM_BOT_TOKEN_ENV_VAR,
        botToken,
      );
    } else if (!resolveTelegramBotToken()) {
      throw new Error(
        `Missing Telegram bot token. Set ${TELEGRAM_BOT_TOKEN_ENV_VAR} in .env.local or pass ${accent("--bot-token")} to save it automatically.`,
      );
    }

    runtime.setupTelegram({
      chatId,
    });

    const state = runtime.getState();
    console.log("Telegram configured.");
    console.log(`Chat ID: ${state.telegram.chatId}`);
    console.log(`Bot token env var: ${TELEGRAM_BOT_TOKEN_ENV_VAR}`);
    const syncResult = await syncTelegramBotCommands(state.telegram.chatId);
    if (syncResult.ok) {
      console.log("Telegram bot commands synced.");
    } else {
      console.log(
        `Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`,
      );
      console.log(
        styleCliText(
          "Run 'opencolab setup telegram commands sync' after fixing token access.",
        ),
      );
    }
    console.log(
      styleCliText(
        "Run 'opencolab setup telegram pair start' to begin pairing.",
      ),
    );
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action === "pair") {
    const pairAction = rest[0];

    if (pairAction === "start") {
      const result = await runtime.startPairing();
      console.log(
        `Pairing code sent to Telegram (expires ${result.expiresAt}).`,
      );
      console.log(
        styleCliText(
          `Enter in CLI: opencolab setup telegram pair complete --code ${result.code}`,
        ),
      );
      return;
    }

    if (pairAction === "complete") {
      const { values } = parseFlags(rest.slice(1));
      const code = values.code;
      if (!code) {
        throw new Error(`${accent("--code")} is required`);
      }

      const result = runtime.completePairing(code);
      console.log(`Telegram pairing completed at ${result.pairedAt}`);
      const state = runtime.getState();
      const syncResult = await syncTelegramBotCommands(state.telegram.chatId);
      if (syncResult.ok) {
        console.log("Telegram bot commands synced.");
      } else {
        console.log(
          `Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`,
        );
      }
      return;
    }

    throw new Error(
      styleCliText(
        "Unknown pairing command. Use 'start' or 'complete --code <value>'.",
      ),
    );
  }

  if (command === "project") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));

    if (subcommand === "create" || subcommand === "init") {
      const projectId = values["project-id"];
      if (!projectId) {
        throw new Error(`${accent("--project-id")} is required`);
      }

      runtime.createProject(projectId);
      const project = runtime.getActiveProject();
      const agent = runtime.getActiveAgent();
      console.log(`Project created and selected: ${project.id}`);
      console.log(`Path: ${project.path}`);
      console.log(`Default agent: ${agent.id} (${agent.path})`);
      return;
    }

    if (subcommand === "use") {
      const projectId = values["project-id"];
      if (!projectId) {
        throw new Error(`${accent("--project-id")} is required`);
      }

      runtime.useProject(projectId);
      const project = runtime.getActiveProject();
      const agent = runtime.getActiveAgent();
      console.log(`Active project: ${project.id}`);
      console.log(`Active agent: ${agent.id}`);
      return;
    }

    if (subcommand === "list") {
      const state = runtime.getState();
      const projects = runtime.listProjects();
      for (const project of projects) {
        const marker = project.id === state.activeProjectId ? "*" : "-";
        console.log(
          `${marker} ${project.id} (active agent: ${project.activeAgentId})`,
        );
      }
      return;
    }

    if (subcommand === "show") {
      console.log(JSON.stringify(runtime.getActiveProject(), null, 2));
      return;
    }
  }

  if (command === "agent") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));

    if (subcommand === "create" || subcommand === "init") {
      const project = runtime.getActiveProject();
      const agentId = values["agent-id"] ?? DEFAULT_AGENT_ID;
      const agentPath = values.path;
      runtime.configureAgent(agentId, agentPath);

      const agent = runtime.getActiveAgent();
      console.log(`Project: ${project.id}`);
      console.log(`Agent configured: ${agent.id}`);
      console.log(`Agent path: ${agent.path}`);
      return;
    }

    if (subcommand === "use") {
      const agentId = values["agent-id"];
      if (!agentId) {
        throw new Error(`${accent("--agent-id")} is required`);
      }

      runtime.useAgent(agentId);
      const project = runtime.getActiveProject();
      const agent = runtime.getActiveAgent();
      console.log(`Project: ${project.id}`);
      console.log(`Active agent: ${agent.id}`);
      return;
    }

    if (subcommand === "list") {
      const project = runtime.getActiveProject();
      const agents = runtime.listAgents();
      for (const agent of agents) {
        const marker = agent.id === project.activeAgentId ? "*" : "-";
        console.log(`${marker} ${agent.id} (${agent.path})`);
      }
      return;
    }

    if (subcommand === "show") {
      console.log(JSON.stringify(runtime.getActiveAgent(), null, 2));
      return;
    }
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
