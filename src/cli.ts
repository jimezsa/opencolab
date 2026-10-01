#!/usr/bin/env node
/**
 * OpenColab CLI entrypoint.
 * Parses commands, runs onboarding/setup flows, and starts gateway services.
 */
import fs from "node:fs";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import {
  getGatewayBackgroundLogCommand,
  getGatewayBackgroundServiceStatus,
  readGatewayServiceRuntimeConfig,
  restartGatewayBackgroundService,
  startGatewayBackgroundService,
  stopGatewayBackgroundService,
} from "./gateway-service.js";
import { startHttpServer } from "./http.js";
import { runIgnite } from "./ignite.js";
import {
  fetchTelegramBotIdentity,
  fetchTelegramBotUsername,
  waitForTelegramHandshake,
  type TelegramHandshakeResult,
} from "./telegram-poller.js";
import {
  resolveCurrentOpenColabInstall,
  readManagedInstallManifest,
  resolveManagedInstallCliScriptPath,
  resolveRuntimeRootDir,
} from "./install.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TELEGRAM_BOT_ID,
} from "./project-config.js";
import {
  getProviderDefaultReasoningEffort,
  getProviderReasoningEffortOptions,
  getProviderSetupDefaults,
  getProviderSupportedAuthModes,
  getProviderOauthSetupHint,
  getSupportedProviderNames,
  normalizeProviderReasoningEffort,
  normalizeProviderAuthMode,
  normalizeProviderName,
  resolveProviderReasoningEffort,
  resolveProviderAuthMode,
} from "./provider.js";
import {
  createRuntime,
  type OpenColabRuntime,
  type TelegramBotSummary,
} from "./runtime.js";
import {
  getProviderApiKeyEnvVar,
  resolveEnvVar,
  resolveProviderApiKey,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  writeSecretToLocalEnv,
} from "./secrets.js";
import { parseManualSshCommand } from "./manual-ssh.js";
import type {
  OpenColabState,
  ProviderAuthMode,
  ProviderName,
  ProviderReasoningEffort,
} from "./types.js";
import { upgradeOpenColab } from "./upgrade.js";

const PROJECT_PET = "🐙";
const ESC_INPUT = "\u001b";
const ANSI_BOLD = "\u001b[1m";
const ANSI_ORANGE = "\u001b[38;5;208m";
const ANSI_WHITE = "\u001b[97m";
const ANSI_SOFT_WHITE = "\u001b[38;5;240m";
const ANSI_RESET = "\u001b[0m";
const HELP_DESCRIPTION_COLUMN = 20;
const CLI_VERSION = resolveCliVersion();

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

const TELEGRAM_MENU_COMMANDS_PINNED: TelegramMenuCommand[] = [
  { command: "agents", description: "Pick who answers in this chat" },
  { command: "whoami", description: "Show this chat's project and agent" },
  { command: "projects", description: "Show this chat's project binding" },
  { command: "session_reset", description: "Reset this agent's session" },
  { command: "stop", description: "Stop active task" },
];

const TELEGRAM_MENU_COMMANDS_FLOATING: TelegramMenuCommand[] = [
  { command: "projects", description: "Pick active project" },
  { command: "agents", description: "Pick active agent" },
  { command: "whoami", description: "Show active project and agent" },
  { command: "session_reset", description: "Reset active session" },
  { command: "stop", description: "Stop active task" },
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
    .replace(
      /^(\s*)\|\s*$/,
      (_match, lead: string) => `${lead}${softWhite("|")}`,
    )
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
      process.stdin.pause();
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

  const normalizedOptions = options.length > 0 ? options : [defaultValue];
  const selectedDefaultIndex = normalizedOptions.indexOf(defaultValue);

  return new Promise((resolve) => {
    let selectedIndex = selectedDefaultIndex >= 0 ? selectedDefaultIndex : 0;
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
      process.stdin.pause();
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

async function confirmInteractive(
  prompt: string,
  defaultValue: boolean,
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive onboarding requires a TTY terminal.");
  }

  return new Promise((resolve) => {
    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const finish = (answer: "y" | "n"): void => {
      cleanup();
      process.stdout.write(`${answer}\n`);
      resolve(answer);
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
        finish(defaultValue ? "y" : "n");
        return;
      }

      const answer = chunk?.toLowerCase();
      if (answer === "y") {
        finish("y");
        return;
      }
      if (answer === "n") {
        finish("n");
        return;
      }

      // Ignore any other key (including pasted text) so a single deliberate
      // y/n/Enter keypress is required to advance.
    };

    process.stdout.write(styleCliText(prompt));
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
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

function resolveCliVersion(): string {
  try {
    const runtimeRootDir = resolveRuntimeRootDir();
    const install = resolveCurrentOpenColabInstall({
      entryScriptPath: process.argv[1],
      cwd: runtimeRootDir,
    });
    const packageJsonPath = path.join(install.rootDir, "package.json");
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function usageMain(): string {
  return formatHelp([
    accent(bold(`${PROJECT_PET} OpenColab v${CLI_VERSION}`)),
    white("multi-agent research lab"),
    "",
    "Options:",
    helpCommand("--version", "Show the installed CLI version"),
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
    helpCommand("version", "Print the installed CLI version"),
    helpCommand("ignite", "Interactive first-run setup"),
    helpCommand(
      "upgrade",
      "Upgrade OpenColab or show package upgrade guidance",
    ),
    helpCommand("setup", "Configure model/provider/api-key/telegram"),
    helpCommand("telegram", "Bind one Telegram bot per project"),
    helpCommand("project", "Manage/create projects"),
    helpCommand("agent", "Manage/create agents"),
    helpCommand("gpu", "Manage remote GPU servers and jobs"),
    helpCommand("workflow", "Author and run project workflows"),
    helpCommand("gateway", "Manage local gateway service"),
    "",
    "Examples:",
    ...helpExample("opencolab setup --help", "Show setup command help"),
    ...helpExample("opencolab upgrade --help", "Show upgrade command help"),
    ...helpExample("opencolab setup model --help", "Show setup model flags"),
    ...helpExample("opencolab telegram bot --help", "Show telegram bot commands"),
    ...helpExample(
      "opencolab gateway start --help",
      "Show gateway start flags",
    ),
  ]);
}

function resolveVersionOutput(argv: string[]): string | null {
  const [command] = argv;
  if (
    command === "version" ||
    argv.includes("--version") ||
    argv.includes("-v")
  ) {
    return `opencolab ${CLI_VERSION}`;
  }
  return null;
}

function usageGateway(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gateway start [--port 4646] [--telegram-polling true|false] [--foreground true|false]",
      "Start gateway (background by default)",
    ),
    helpCommand("opencolab gateway stop", "Stop background gateway service"),
    helpCommand(
      "opencolab gateway restart [--port 4646]",
      "Restart background gateway service",
    ),
    helpCommand("opencolab gateway status", "Show background gateway status"),
    helpCommand(
      "opencolab gateway logs",
      "Show log tail command and log paths",
    ),
    "",
    "Flags:",
    helpFlag("--port <number>", "Gateway port (default: 4646)"),
    helpFlag("--telegram-polling true|false", "Enable or disable polling mode"),
    helpFlag("--foreground true|false", "Run in current terminal process"),
  ]);
}

function usageIgnite(): string {
  return formatHelp([
    "Usage:",
    helpCommand("opencolab ignite", "Run interactive onboarding"),
    "",
    "Notes:",
    "  - Interactive setup for project/provider/built-in-tools/telegram/agent.",
    "  - Press Esc to skip the current step.",
  ]);
}

function usageUpgrade(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab upgrade",
      "Upgrade an installer-managed OpenColab or a git/source checkout",
    ),
    "",
    "Notes:",
    "  - One-link installer installs upgrade the managed package or managed clone behind the shim.",
    "  - Git/source installs require a clean tracked git worktree in the current OpenColab install.",
    "  - Git/source installs switch to branch main and fast-forward to origin/main.",
    "  - Git/source and managed clone installs rebuild OpenColab after pulling changes.",
    "  - Generic package installs without installer metadata print package-manager upgrade guidance instead.",
    "  - Successful managed upgrades restart the background gateway with saved settings when it is running.",
  ]);
}

function usageSetup(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab setup model [flags]",
      "Configure provider, model, and auth",
    ),
    helpCommand(
      "opencolab setup api-key [flags]",
      "Save one provider API key only",
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
    helpCommand(
      "opencolab setup telegram workflow-notifications <on|off|status>",
      "Toggle live workflow updates in Telegram",
    ),
    "",
    "Try:",
    helpCommand("setup api-key --help", "Show provider API key flags"),
    helpCommand("setup model --help", "Show model setup flags"),
    helpCommand("setup telegram --help", "Show telegram setup flags"),
    helpCommand("setup telegram commands sync --help", "Show sync flags"),
    helpCommand("setup telegram pair --help", "Show pairing command help"),
  ]);
}

function usageSetupApiKey(): string {
  const providerChoices = getSupportedProviderNames().join("|");
  return formatHelp([
    "Usage:",
    helpCommand(
      `opencolab setup api-key --provider ${providerChoices} --api-key <value>`,
      "Save a provider API key without changing the active agent runtime",
    ),
    "",
    "Flags:",
    helpFlag(`--provider ${providerChoices}`, "Provider identifier"),
    helpFlag(
      "--api-key <value>",
      "Provider API key value (saved to .env.local)",
    ),
  ]);
}

function usageSetupModel(): string {
  const providerChoices = getSupportedProviderNames().join("|");
  return formatHelp([
    "Usage:",
    helpCommand(
      `opencolab setup model [--agent-id <id>] [--provider ${providerChoices}] [--model <model>] [--auth api-key|oauth] [--reasoning-effort <value>] [--api-key <value>]`,
      "Configure an agent runtime",
    ),
    "",
    "Flags:",
    helpFlag("--agent-id <id>", "Target agent id (default: active agent)"),
    helpFlag(`--provider ${providerChoices}`, "Provider identifier"),
    helpFlag("--model <model>", "Provider model name"),
    helpFlag(
      "--auth api-key|oauth",
      "Provider auth mode (OpenAI, Anthropic, and Gemini support oauth)",
    ),
    helpFlag(
      "--reasoning-effort <value>",
      "Native provider reasoning effort when the model supports it",
    ),
    helpFlag(
      "--api-key <value>",
      "Provider API key value (saved to .env.local)",
    ),
    "",
    "Notes:",
    `  - Use ${accent("opencolab setup api-key")} to save a provider key without changing model/auth.`,
    "  - OpenAI models support low, medium, high, xhigh.",
    "  - Anthropic Claude models on the Claude runtime support low, medium, high, max.",
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
    helpFlag(
      "--bot-token <value>",
      "Telegram bot token value (saved to .env.local)",
    ),
    helpFlag("--chat-id <id>", "Authorized Telegram chat id"),
    helpFlag("--id <bot>", "Bot to configure (default: default)"),
    "",
    "Notes:",
    `  - This configures one bot. For a bot per project use ${accent("opencolab telegram bot add")}.`,
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
    helpFlag("--id <bot>", "Bot to sync (default: default)"),
    helpFlag("--all", "Sync every configured bot"),
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

function usageTelegram(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab telegram bot add --token <botfather_token> [--project <id>]",
      "Bind a new bot to a project",
    ),
    helpCommand("opencolab telegram bot list [--json]", "List bots and project owners"),
    helpCommand("opencolab telegram bot show --id <bot>", "Show one bot"),
    helpCommand(
      "opencolab telegram bot bind --id <bot> --project <id> [--agent <id>|--agent-auto]",
      "Repoint a bot at a project/agent",
    ),
    helpCommand(
      "opencolab telegram bot pin --id <bot> [--project <id>]",
      "Pin a floating bot to a project",
    ),
    helpCommand(
      "opencolab telegram bot unbind --id <bot>",
      "Return a bot to following the active project",
    ),
    helpCommand(
      "opencolab telegram bot enable|disable --id <bot>",
      "Enable or disable one bot",
    ),
    helpCommand(
      "opencolab telegram bot remove --id <bot> [--keep-token]",
      "Remove a bot and its token",
    ),
    helpCommand(
      "opencolab telegram bot pair --id <bot> start|complete --code <code>",
      "Pair one bot with its chat",
    ),
    helpCommand("opencolab telegram bot test --id <bot>", "Validate token and chat"),
    helpCommand(
      "opencolab telegram commands sync [--id <bot>|--all]",
      "Sync slash-command menus",
    ),
    "",
    "Flags:",
    helpFlag("--token <value>", "BotFather token (saved to .env.local)"),
    helpFlag("--id <bot>", "Local bot id; defaults to the bot's @username slug"),
    helpFlag("--project <id>", "Project this bot answers for"),
    helpFlag("--agent <id>", "Pin one agent; omit to follow the project default"),
    helpFlag("--agent-auto", "Clear a pinned agent"),
    helpFlag("--floating", "Legacy mode: follow the globally active project"),
    helpFlag("--keep-token", "Leave the token in .env.local when removing"),
    "",
    "Notes:",
    "  - One project owns at most one enabled bot, so a chat is never ambiguous.",
    "  - Messages to a bot route to its project regardless of the active project.",
    "  - Tokens live only in .env.local; opencolab.json stores the env var name.",
    "  - A project with no bot gets no heartbeat or workflow notifications.",
    `  - Create bots in BotFather first: ${accent("https://t.me/BotFather")}`,
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
      "opencolab agent create --agent-id <id> [--path projects/<project_id>/AGENTS/<agent_id>]",
      "Create/update and select an agent",
    ),
    helpCommand("opencolab agent use --agent-id <id>", "Switch active agent"),
    helpCommand("opencolab agent list", "List project agents"),
    helpCommand("opencolab agent show", "Print active agent JSON"),
  ]);
}

function usageGpu(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu server [subcommand]",
      "Manage Runpod-backed GPU servers",
    ),
    helpCommand("opencolab gpu job [subcommand]", "Manage bounded GPU jobs"),
    helpCommand(
      "opencolab gpu ssh [subcommand]",
      "Manage saved manual SSH profiles and sessions",
    ),
    "",
    "Try:",
    helpCommand("gpu server --help", "Show gpu server flags"),
    helpCommand("gpu job --help", "Show gpu job flags"),
    helpCommand("gpu ssh --help", "Show gpu ssh flags"),
  ]);
}

function usageGpuServer(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu server add --provider runpod --server-id <id> [flags]",
      "Create or update a GPU server target",
    ),
    helpCommand("opencolab gpu server list", "List GPU server targets"),
    helpCommand(
      "opencolab gpu server show --server-id <id>",
      "Print one GPU server target as JSON",
    ),
    helpCommand(
      "opencolab gpu server availability --server-id <id>",
      "Check live Runpod datacenter and GPU availability for one target",
    ),
    helpCommand(
      "opencolab gpu server test --server-id <id>",
      "Validate local and Runpod prerequisites",
    ),
    helpCommand(
      "opencolab gpu server remove --server-id <id>",
      "Remove a GPU server target",
    ),
    "",
    "Flags:",
    helpFlag("--provider runpod", "Required backend identifier"),
    helpFlag("--server-id <id>", "Project-scoped GPU server id"),
    helpFlag(
      "--location <csv>",
      "Preferred Runpod data center ids in fallback order",
    ),
    helpFlag("--datacenter-id <csv>", "Legacy alias for --location"),
    helpFlag(
      "--gpu-type <csv>",
      "Accepted Runpod GPU types in preference order",
    ),
    helpFlag("--gpu-count <n>", "GPU count"),
    helpFlag("--image-name <name>", "Container image name"),
    helpFlag("--template-id <id>", "Runpod template id"),
    helpFlag("--volume-name <name>", "Attached network volume name"),
    helpFlag("--volume-size-gb <n>", "Network volume size in GB"),
    helpFlag("--volume-id <id>", "Existing Runpod network volume id"),
    helpFlag("--workspace-root <path>", "Remote workspace mount root"),
    helpFlag("--ssh-user <user>", "SSH username (default: root)"),
    helpFlag("--ssh-port <n>", "Override SSH port when needed"),
    helpFlag("--ssh-key-path <path>", "SSH private key path"),
    helpFlag(
      "--bootstrap-profile python-ml|pytorch-cu12|minimal-shell",
      "Named bootstrap profile",
    ),
    helpFlag("--max-runtime-minutes <n>", "Target max runtime"),
    helpFlag("--idle-stop-minutes <n>", "Idle stop budget for warm Pods"),
    helpFlag(
      "--auto-stop-policy stop_on_completion|keep_warm",
      "Pod cleanup policy",
    ),
    helpFlag("--max-estimated-cost-usd <n>", "Operator-visible budget hint"),
    helpFlag("--enabled true|false", "Enable or disable the target"),
  ]);
}

function usageGpuJob(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu job start --server-id <id> --command <command> [flags]",
      "Launch a bounded remote GPU job",
    ),
    helpCommand(
      "opencolab gpu job status --run-id <id>",
      "Refresh and print one GPU run status as JSON",
    ),
    helpCommand(
      "opencolab gpu job logs --run-id <id> [--stream stdout|stderr|bootstrap|poller]",
      "Print one local run log",
    ),
    helpCommand(
      "opencolab gpu job exec --run-id <id> --command <command>",
      "Run one bounded remote command over the launched Pod SSH path",
    ),
    helpCommand(
      "opencolab gpu job fetch --run-id <id>",
      "Fetch remote logs and artifacts",
    ),
    helpCommand(
      "opencolab gpu job cancel --run-id <id>",
      "Cancel a running GPU job",
    ),
    helpCommand("opencolab gpu job list", "List local GPU run records"),
    "",
    "Flags:",
    helpFlag("--server-id <id>", "Target GPU server id for job start"),
    helpFlag("--run-id <id>", "Existing local GPU run id"),
    helpFlag("--command <command>", "Remote shell command to launch"),
    helpFlag(
      "--include <csv>",
      "Comma-separated include paths relative to repo root",
    ),
    helpFlag(
      "--exclude <csv>",
      "Comma-separated exclude paths relative to repo root",
    ),
    helpFlag(
      "--artifact <csv>",
      "Comma-separated artifact paths relative to remote working dir",
    ),
    helpFlag("--env <csv>", "Comma-separated env var names to forward"),
    helpFlag("--max-runtime-minutes <n>", "Override target runtime cap"),
    helpFlag(
      "--strict-artifacts true|false",
      "Fail if declared artifacts are missing",
    ),
    helpFlag(
      "--wait true|false",
      "Wait for terminal completion before returning",
    ),
    helpFlag("--stream stdout|stderr|bootstrap|poller", "Log stream to print"),
  ]);
}

function usageGpuSsh(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu ssh profile [subcommand]",
      "Manage saved manual Pod SSH profiles",
    ),
    helpCommand(
      "opencolab gpu ssh session [subcommand]",
      "Manage live manual SSH sessions",
    ),
    "",
    "Try:",
    helpCommand("gpu ssh profile --help", "Show manual SSH profile flags"),
    helpCommand("gpu ssh session --help", "Show manual SSH session flags"),
    "",
    "Examples:",
    ...helpExample(
      'opencolab gpu ssh profile save --profile-id runpod-manual-a100 --ssh-command "ssh -p 21438 -i ~/.ssh/id_ed25519 root@203.0.113.10"',
      "Save one manual Pod SSH profile",
    ),
    ...helpExample(
      "opencolab gpu ssh session start --profile-id runpod-manual-a100",
      "Start a live manual SSH session from a saved profile",
    ),
  ]);
}

function usageGpuSshProfile(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu ssh profile save --profile-id <id> [--pod-id <id>] [--ssh-command <command>] [flags]",
      "Create or update a saved manual Pod SSH profile",
    ),
    helpCommand(
      "opencolab gpu ssh profile list",
      "List saved manual SSH profiles",
    ),
    helpCommand(
      "opencolab gpu ssh profile show [--profile-id <id>]",
      "Print one saved manual SSH profile as JSON",
    ),
    helpCommand(
      "opencolab gpu ssh profile test [--profile-id <id>]",
      "Validate one saved manual SSH profile",
    ),
    helpCommand(
      "opencolab gpu ssh profile remove --profile-id <id>",
      "Remove one saved manual SSH profile",
    ),
    helpCommand(
      "opencolab gpu ssh profile set-default --profile-id <id> [--agent-id <id>]",
      "Set the default manual SSH profile for an agent",
    ),
    "",
    "Flags:",
    helpFlag("--profile-id <id>", "Project-scoped manual SSH profile id"),
    helpFlag("--pod-id <id>", "Optional user-managed Runpod Pod id"),
    helpFlag("--host <host>", "SSH host or public IP"),
    helpFlag("--port <n>", "SSH port"),
    helpFlag("--user <user>", "SSH username (default: root)"),
    helpFlag("--ssh-key-path <path>", "SSH private key path"),
    helpFlag("--ssh-config-host <name>", "SSH config host alias"),
    helpFlag(
      "--ssh-command <command>",
      "Parse and normalize an existing ssh command",
    ),
    helpFlag(
      "--workspace-root <path>",
      "Remote workspace root (default: /workspace)",
    ),
    helpFlag(
      "--interactive-access disabled|opt_in",
      "Interactive session policy",
    ),
    helpFlag("--agent-id <id>", "Agent id when setting a default profile"),
    helpFlag(
      "--set-default true|false",
      "Set the saved profile as the active agent default",
    ),
  ]);
}

function usageGpuSshSession(): string {
  return formatHelp([
    "Usage:",
    helpCommand(
      "opencolab gpu ssh session start [--profile-id <id>] [--agent-id <id>]",
      "Start a live manual SSH session from a saved profile",
    ),
    helpCommand(
      "opencolab gpu ssh session list",
      "List saved manual SSH sessions",
    ),
    helpCommand(
      "opencolab gpu ssh session read --session-id <id> [--offset <n>]",
      "Read transcript output from a live session",
    ),
    helpCommand(
      "opencolab gpu ssh session write --session-id <id> --stdin <text> [--append-newline true|false]",
      "Send one line of input to a live session",
    ),
    helpCommand(
      "opencolab gpu ssh session stop --session-id <id>",
      "Stop one live manual SSH session",
    ),
    "",
    "Flags:",
    helpFlag(
      "--profile-id <id>",
      "Saved manual SSH profile id (defaults when available)",
    ),
    helpFlag("--agent-id <id>", "Agent id used for default profile resolution"),
    helpFlag("--session-id <id>", "Saved manual SSH session id"),
    helpFlag("--offset <n>", "Character offset for transcript reads"),
    helpFlag("--stdin <text>", "Input text to send to the live shell"),
    helpFlag(
      "--append-newline true|false",
      "Append a trailing newline when writing input",
    ),
    "",
    "Examples:",
    ...helpExample(
      "opencolab gpu ssh session start --profile-id runpod-manual-a100",
      "Start a session from a saved manual SSH profile",
    ),
    ...helpExample(
      "opencolab gpu ssh session read --session-id manual-ssh-session-123 --offset 0",
      "Read the transcript from the beginning",
    ),
    ...helpExample(
      'opencolab gpu ssh session write --session-id manual-ssh-session-123 --stdin "nvidia-smi"',
      "Send one command to the remote shell",
    ),
    ...helpExample(
      "opencolab gpu ssh session stop --session-id manual-ssh-session-123",
      "Stop a live manual SSH session",
    ),
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

  if (command === "upgrade") {
    return usageUpgrade();
  }

  if (command === "gateway" || command === "getway" || command === "web") {
    return usageGateway();
  }

  if (command === "setup") {
    if (subcommand === "api-key") {
      return usageSetupApiKey();
    }
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

  if (command === "telegram") {
    return usageTelegram();
  }

  if (command === "project") {
    return usageProject();
  }

  if (command === "agent") {
    return usageAgent();
  }

  if (command === "gpu") {
    if (subcommand === "server") {
      return usageGpuServer();
    }
    if (subcommand === "job") {
      return usageGpuJob();
    }
    if (subcommand === "ssh") {
      if (action === "profile") {
        return usageGpuSshProfile();
      }
      if (action === "session") {
        return usageGpuSshSession();
      }
      return usageGpuSsh();
    }
    return usageGpu();
  }

  if (command === "workflow") {
    return usageWorkflow();
  }

  return usageMain();
}

function usageWorkflow(): string {
  return formatHelp([
    "Usage:",
    helpCommand("opencolab workflow list", "List workflows in the active project"),
    helpCommand(
      "opencolab workflow show --workflow-id <id>",
      "Show a workflow definition summary",
    ),
    helpCommand(
      "opencolab workflow validate --workflow-id <id>",
      "Validate a workflow XML without running it",
    ),
    helpCommand(
      "opencolab workflow create --workflow-id <id> [--from blank|review-loop|judge-and-retry]",
      "Create a new workflow from a template",
    ),
    helpCommand(
      "opencolab workflow run --workflow-id <id> --input <text> [--wait true|false]",
      "Start a workflow run with a single text input named 'task'",
    ),
    helpCommand(
      "opencolab workflow run --workflow-id <id> --input-file <path> [--wait true|false]",
      "Start a workflow run with inputs read from a JSON file",
    ),
    helpCommand(
      "opencolab workflow status --run-id <id>",
      "Show the latest durable status for a workflow run",
    ),
    helpCommand(
      "opencolab workflow logs --run-id <id> [--follow]",
      "Print recent workflow events from events.jsonl",
    ),
    helpCommand(
      "opencolab workflow stop --run-id <id>",
      "Request stop on a workflow run",
    ),
    helpCommand(
      "opencolab workflow resume --run-id <id>",
      "Resume a paused workflow run",
    ),
    helpCommand(
      "opencolab workflow approve --run-id <id> --decision continue|stop|retry|branch:<step>|edit",
      "Record a human gate decision",
    ),
    helpCommand(
      "opencolab workflow runs [--workflow-id <id>]",
      "List recent runs (optionally filtered by workflow)",
    ),
    "",
    "Flags:",
    helpFlag("--workflow-id <id>", "Workflow id (folder name under projects/<id>/workflows/)"),
    helpFlag("--input <text>", "Convenience input forwarded as 'task'"),
    helpFlag("--input-file <path>", "JSON file with inputs keyed by name"),
    helpFlag("--input-json <json>", "Inline JSON object with inputs keyed by name"),
    helpFlag("--from blank|review-loop|judge-and-retry", "Workflow template id"),
    helpFlag("--wait true|false", "Wait for terminal status before returning"),
    helpFlag("--follow", "Tail events.jsonl until the run finishes"),
    helpFlag("--decision continue|stop|retry|branch:<step>|edit", "Approval decision"),
    helpFlag("--values-json <json>", "Inline JSON for --decision edit"),
  ]);
}

function parseProviderName(
  value: string | undefined,
  fallback: ProviderName,
): ProviderName {
  const parsed = normalizeProviderName(value ?? fallback);
  if (!parsed) {
    const supported = getSupportedProviderNames().join(", ");
    throw new Error(`Unsupported provider: ${value}. Use ${supported}.`);
  }
  return parsed;
}

function displayProviderAuthMode(value: ProviderAuthMode): string {
  return value.replaceAll("_", "-");
}

function displayProviderRuntime(value: string): string {
  return value;
}

function parseProviderAuthMode(
  value: string | undefined,
  providerName: ProviderName,
  fallback: ProviderAuthMode,
): ProviderAuthMode {
  if (value === undefined) {
    return resolveProviderAuthMode(providerName, fallback, fallback);
  }

  const parsed = normalizeProviderAuthMode(value);
  const supportedModes = getProviderSupportedAuthModes(providerName);
  if (!parsed || !supportedModes.includes(parsed)) {
    const supported = supportedModes.map(displayProviderAuthMode).join(", ");
    throw new Error(
      `Unsupported auth mode '${value}' for provider '${providerName}'. Use ${supported}.`,
    );
  }

  return parsed;
}

function parseProviderReasoningEffort(
  value: string | undefined,
  providerName: ProviderName,
  model: string,
  fallback?: ProviderReasoningEffort,
): ProviderReasoningEffort | undefined {
  if (value === undefined) {
    return resolveProviderReasoningEffort(
      providerName,
      model,
      fallback,
      fallback,
    );
  }

  const parsed = normalizeProviderReasoningEffort(providerName, model, value);
  if (parsed) {
    return parsed;
  }

  const supported = getProviderReasoningEffortOptions(providerName, model);
  if (supported.length === 0) {
    throw new Error(
      `Reasoning effort is not supported for provider '${providerName}' with model '${model}'.`,
    );
  }

  throw new Error(
    `Unsupported reasoning effort '${value}' for provider '${providerName}' with model '${model}'. Use ${supported.join(", ")}.`,
  );
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  return defaultValue;
}

function parseOptionalIntegerFlag(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new Error(`Expected an integer, got '${value}'.`);
  }
  return numeric;
}

function parseOptionalNumberFlag(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected a number, got '${value}'.`);
  }
  return numeric;
}

function parseCsvFlag(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function resolveCliScriptPath(runtimeRootDir: string): string {
  const manifest = readManagedInstallManifest(runtimeRootDir);
  const managedCliScriptPath = manifest
    ? resolveManagedInstallCliScriptPath(manifest)
    : null;
  if (managedCliScriptPath) {
    return path.resolve(managedCliScriptPath);
  }
  const candidate = process.argv[1]?.trim();
  if (candidate) {
    return path.resolve(candidate);
  }
  return path.join(runtimeRootDir, "dist", "src", "cli.js");
}

function parseGatewayStartOptions(args: string[]): {
  port: number;
  telegramPolling: boolean;
  foreground: boolean;
} {
  const { values } = parseFlags(args);
  const port = Number(values.port ?? "4646");
  const telegramPolling = parseBooleanFlag(values["telegram-polling"], true);
  const foreground = parseBooleanFlag(values.foreground, false);
  return { port, telegramPolling, foreground };
}

async function startGatewayForeground(
  runtimeRootDir: string,
  port: number,
  telegramPolling: boolean,
): Promise<void> {
  const runtime = createRuntime(runtimeRootDir);
  runtime.init();
  const autoSync = await autoSyncTelegramCommandsIfConfigured(runtime);
  if (autoSync.attempted) {
    if (autoSync.ok) {
      console.log("Telegram bot commands synced.");
    } else {
      console.log(
        `Warning: could not sync Telegram commands (${autoSync.error ?? "unknown error"}).`,
      );
    }
  }

  startHttpServer(port, runtimeRootDir, { telegramPolling });
}

async function waitForTelegramHandshakeForIgnite(request: {
  token: string;
  timeoutMs?: number;
  onBotInfo?: (username: string | null) => void;
  onWaiting?: (elapsedSeconds: number) => void;
}): Promise<TelegramHandshakeResult | null> {
  const username = await fetchTelegramBotUsername(request.token);
  request.onBotInfo?.(username);
  return waitForTelegramHandshake({
    token: request.token,
    timeoutMs: request.timeoutMs,
    onWaiting: request.onWaiting,
    acknowledgeText: "Paired ✅ OpenColab is now connected to this chat.",
  });
}

interface TelegramCommandSyncTarget {
  token: string;
  chatId?: string | null;
  scope: "pinned" | "floating";
}

async function syncTelegramBotCommands(
  target: TelegramCommandSyncTarget,
): Promise<{ ok: boolean; error?: string }> {
  const token = target.token;
  const chatId = target.chatId;
  const menuCommands =
    target.scope === "floating"
      ? TELEGRAM_MENU_COMMANDS_FLOATING
      : TELEGRAM_MENU_COMMANDS_PINNED;

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
            commands: menuCommands,
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

/**
 * Syncs the command menu for every configured bot. One bot failing never aborts the
 * rest, so a single stale token cannot block the others from updating.
 */
async function autoSyncTelegramCommandsIfConfigured(
  runtime: OpenColabRuntime,
): Promise<{ attempted: boolean; ok: boolean; error?: string }> {
  const bots = runtime
    .listTelegramBotSummaries()
    .filter((bot) => bot.enabled && bot.tokenPresent && bot.chatId);
  if (bots.length === 0) {
    return { attempted: false, ok: true };
  }

  const errors: string[] = [];
  for (const bot of bots) {
    const token = resolveEnvVar(bot.tokenEnvVar);
    if (!token) {
      errors.push(`[bot ${bot.id}] missing token (${bot.tokenEnvVar})`);
      continue;
    }
    const result = await syncTelegramBotCommands({
      token,
      chatId: bot.chatId,
      scope: bot.scope,
    });
    if (!result.ok) {
      errors.push(`[bot ${bot.id}] ${result.error ?? "unknown error"}`);
    }
  }

  return {
    attempted: true,
    ok: errors.length === 0,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

/** Resolves one bot plus its token for a CLI command, with a clear error when missing. */
function requireTelegramBotForCli(
  runtime: OpenColabRuntime,
  botId: string,
): { bot: TelegramBotSummary; token: string } {
  const bot = runtime.getTelegramBotSummary(botId);
  const token = resolveEnvVar(bot.tokenEnvVar);
  if (!token) {
    throw new Error(
      `Telegram bot '${bot.id}' has no token in ${bot.tokenEnvVar}. Re-add it with 'opencolab telegram bot add --token <value> --id ${bot.id}'.`,
    );
  }
  return { bot, token };
}

function requireBotIdFlag(values: Record<string, string | undefined>): string {
  const botId = values.id?.trim();
  if (botId) {
    return botId;
  }
  throw new Error(`${accent("--id")} is required (see 'opencolab telegram bot list')`);
}

/** Syncs one bot's command menu, reporting rather than throwing on failure. */
async function syncTelegramBotCommandsForBot(
  runtime: OpenColabRuntime,
  botId: string,
): Promise<boolean> {
  const bot = runtime.getTelegramBotSummary(botId);
  const token = resolveEnvVar(bot.tokenEnvVar);
  if (!token) {
    console.log(
      `Warning: could not sync Telegram commands for '${bot.id}' (missing ${bot.tokenEnvVar}).`,
    );
    return false;
  }

  const result = await syncTelegramBotCommands({
    token,
    chatId: bot.chatId,
    scope: bot.scope,
  });
  if (result.ok) {
    console.log(`Telegram bot commands synced for '${bot.id}'.`);
    return true;
  }

  console.log(
    `Warning: could not sync Telegram commands for '${bot.id}' (${result.error ?? "unknown error"}).`,
  );
  return false;
}

async function runTelegramCommandsSync(
  runtime: OpenColabRuntime,
  values: Record<string, string | undefined>,
): Promise<void> {
  if (parseBooleanFlag(values.all, false)) {
    const bots = runtime.listTelegramBotSummaries();
    if (bots.length === 0) {
      throw new Error("No Telegram bots configured.");
    }
    let failures = 0;
    for (const bot of bots) {
      if (!(await syncTelegramBotCommandsForBot(runtime, bot.id))) {
        failures += 1;
      }
    }
    if (failures > 0) {
      throw new Error(`Could not sync Telegram commands for ${String(failures)} bot(s).`);
    }
    return;
  }

  const botId = values.id ?? DEFAULT_TELEGRAM_BOT_ID;
  const { bot, token } = requireTelegramBotForCli(runtime, botId);
  const result = await syncTelegramBotCommands({
    token,
    chatId: values["chat-id"] ?? bot.chatId,
    scope: bot.scope,
  });
  if (!result.ok) {
    throw new Error(
      `Could not sync Telegram commands: ${result.error ?? "unknown error"}`,
    );
  }
  console.log(`Telegram bot commands synced for '${bot.id}'.`);
}

async function runTelegramPairCommand(
  runtime: OpenColabRuntime,
  rest: string[],
  commandLabel: string,
): Promise<void> {
  const pairAction = rest.find((token) => !token.startsWith("--"));
  const { values } = parseFlags(rest.filter((token) => token !== pairAction));
  const botId = values.id ?? DEFAULT_TELEGRAM_BOT_ID;

  if (pairAction === "start") {
    const result = await runtime.startPairing(botId);
    console.log(
      `Pairing code sent through bot '${result.botId}' (expires ${result.expiresAt}).`,
    );
    console.log(
      styleCliText(
        `Enter in CLI: ${commandLabel} complete --code ${result.code}` +
          (botId === DEFAULT_TELEGRAM_BOT_ID ? "" : ` --id ${botId}`),
      ),
    );
    return;
  }

  if (pairAction === "complete") {
    const code = values.code;
    if (!code) {
      throw new Error(`${accent("--code")} is required`);
    }

    const result = runtime.completePairing(code, botId);
    console.log(
      `Telegram pairing completed for bot '${result.botId}' at ${result.pairedAt}`,
    );
    await syncTelegramBotCommandsForBot(runtime, result.botId);
    return;
  }

  throw new Error(
    styleCliText(
      "Unknown pairing command. Use 'start' or 'complete --code <value>'.",
    ),
  );
}

async function sendTelegramTestMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** Shows which bot owns each project's notifications, so a gap is visible not silent. */
function printTelegramProjectCoverage(runtime: OpenColabRuntime): void {
  const bots = runtime.listTelegramBotSummaries();
  const projects = runtime.listProjects();
  console.log("");
  console.log("Project notification owners");
  for (const project of projects) {
    const owner = bots.find(
      (bot) =>
        bot.enabled &&
        bot.tokenPresent &&
        ((bot.scope === "pinned" && bot.projectId === project.id) ||
          (bot.scope === "floating" && project.id === runtime.getState().activeProjectId)),
    );
    console.log(
      `- ${project.id}: ${owner ? `${owner.id}${owner.telegramUsername ? ` (@${owner.telegramUsername})` : ""}` : "none (heartbeat + workflow updates are skipped)"}`,
    );
  }
}

function formatTelegramBotLine(bot: TelegramBotSummary): string {
  const handle = bot.telegramUsername ? `@${bot.telegramUsername}` : "(username unknown)";
  const target =
    bot.scope === "floating"
      ? `follows active project (currently ${bot.effectiveProjectId ?? "none"})`
      : bot.orphaned
        ? `bound to missing project '${bot.projectId ?? "none"}'`
        : `project ${bot.effectiveProjectId}`;
  const agent = bot.effectiveAgentId
    ? `${bot.effectiveAgentId}${bot.agentId ? "" : " (project default)"}`
    : "none";
  const flags = [
    bot.enabled ? null : "disabled",
    bot.tokenPresent ? null : `token missing (${bot.tokenEnvVar})`,
    bot.paired ? null : "not paired",
    bot.orphaned ? "orphaned" : null,
  ].filter(Boolean);

  return [
    `- ${bot.id} ${handle}`,
    `    target: ${target}`,
    `    agent: ${agent}`,
    `    mode: ${bot.scope}  workflow updates: ${bot.notifyWorkflowProgress ? "on" : "off"}`,
    ...(flags.length > 0 ? [`    warnings: ${flags.join(", ")}`] : []),
  ].join("\n");
}

function formatUpgradeDependencyInstallMode(
  value: "frozen_lockfile" | "fallback",
): string {
  return value === "frozen_lockfile"
    ? "pnpm install --frozen-lockfile"
    : "pnpm install (fallback after frozen lockfile failure)";
}

function printUpgradeGatewayRestartSummary(
  runtimeRootDir: string,
  cliScriptPath: string,
): void {
  try {
    const { files, status } = getGatewayBackgroundServiceStatus(runtimeRootDir);
    if (!status.running) {
      console.log(
        "Gateway restart: skipped (managed background gateway not running).",
      );
      return;
    }

    const config = readGatewayServiceRuntimeConfig(runtimeRootDir);
    if (!config) {
      console.log(
        "Gateway restart: skipped (could not resolve saved gateway settings safely).",
      );
      console.log(
        styleCliText(
          "Restart manually with 'opencolab gateway restart' if needed.",
        ),
      );
      return;
    }

    restartGatewayBackgroundService({
      rootDir: runtimeRootDir,
      cliScriptPath,
      nodePath: process.execPath,
      port: config.port,
      telegramPolling: config.telegramPolling,
    });
    console.log(
      `Gateway restart: restarted (${files.platform}) on port ${String(config.port)} with telegram polling ${config.telegramPolling ? "enabled" : "disabled"}.`,
    );
  } catch (error) {
    console.log(
      `Gateway restart: skipped (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const [command, subcommand, action, ...rest] = argv;

  const versionOutput = resolveVersionOutput(argv);
  if (versionOutput) {
    console.log(versionOutput);
    return;
  }

  const help = resolveHelp(argv);
  if (help) {
    console.log(help);
    return;
  }

  if (command === "gateway" || command === "getway" || command === "web") {
    const runtimeRootDir = resolveRuntimeRootDir();
    const cliScriptPath = resolveCliScriptPath(runtimeRootDir);
    const gatewayAction = subcommand ?? "start";

    if (gatewayAction === "start") {
      const options = parseGatewayStartOptions(
        [action, ...rest].filter(Boolean),
      );
      if (options.foreground) {
        await startGatewayForeground(
          runtimeRootDir,
          options.port,
          options.telegramPolling,
        );
        return;
      }

      const files = startGatewayBackgroundService({
        rootDir: runtimeRootDir,
        cliScriptPath,
        nodePath: process.execPath,
        port: options.port,
        telegramPolling: options.telegramPolling,
      });
      console.log(`Gateway service started in background (${files.platform}).`);
      console.log(`Service config: ${files.configPath}`);
      console.log(`Stdout log: ${files.stdoutLogPath}`);
      console.log(`Stderr log: ${files.stderrLogPath}`);
      console.log("Use 'opencolab gateway status' to confirm runtime status.");
      return;
    }

    if (gatewayAction === "restart") {
      const options = parseGatewayStartOptions(
        [action, ...rest].filter(Boolean),
      );
      const files = restartGatewayBackgroundService({
        rootDir: runtimeRootDir,
        cliScriptPath,
        nodePath: process.execPath,
        port: options.port,
        telegramPolling: options.telegramPolling,
      });
      console.log(`Gateway service restarted (${files.platform}).`);
      console.log(`Service config: ${files.configPath}`);
      return;
    }

    if (gatewayAction === "stop") {
      const files = stopGatewayBackgroundService(runtimeRootDir);
      console.log(`Gateway service stop requested (${files.platform}).`);
      return;
    }

    if (gatewayAction === "status") {
      const { files, status } =
        getGatewayBackgroundServiceStatus(runtimeRootDir);
      console.log(
        `Gateway service status (${files.platform}): ${status.statusText}`,
      );
      console.log(`Service config: ${files.configPath}`);
      console.log(`Stdout log: ${files.stdoutLogPath}`);
      console.log(`Stderr log: ${files.stderrLogPath}`);
      return;
    }

    if (gatewayAction === "logs") {
      const { files, command: tailCommand } =
        getGatewayBackgroundLogCommand(runtimeRootDir);
      console.log(`Gateway logs (${files.platform}).`);
      console.log(`Tail command: ${tailCommand}`);
      console.log(`Stdout log: ${files.stdoutLogPath}`);
      console.log(`Stderr log: ${files.stderrLogPath}`);
      return;
    }

    throw new Error(
      styleCliText(
        "Unknown gateway command. Use 'start', 'stop', 'restart', 'status', or 'logs'.",
      ),
    );
  }

  if (command === "upgrade") {
    const runtimeRootDir = resolveRuntimeRootDir();
    const result = upgradeOpenColab(runtimeRootDir, {
      nodePath: process.execPath,
      entryScriptPath: process.argv[1],
    });
    if (result.kind === "package_guidance") {
      for (const line of result.messageLines) {
        console.log(line);
      }
      return;
    }

    console.log("OpenColab upgrade completed.");
    console.log(`Upgrade mode: ${result.kind}`);
    console.log(`Runtime root: ${result.runtimeRootDir}`);
    if (result.kind === "managed_package") {
      console.log(`Managed package spec: ${result.packageSpec}`);
    } else {
      console.log("Target branch: main");
      console.log(
        `Previous branch: ${result.previousBranch || "(detached HEAD)"}`,
      );
      console.log(`Previous revision: ${result.previousRevision}`);
      console.log(`Current revision: ${result.currentRevision}`);
      console.log(
        `Dependency install: ${formatUpgradeDependencyInstallMode(result.dependencyInstallMode)}`,
      );
    }
    printUpgradeGatewayRestartSummary(
      result.runtimeRootDir,
      result.cliScriptPath,
    );
    return;
  }

  const runtime = createRuntime(resolveRuntimeRootDir());
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
          confirm: async (prompt, defaultValue) =>
            confirmInteractive(prompt, defaultValue),
          write: (line) => {
            console.log(styleCliText(line));
          },
        },
        {
          syncTelegramCommands: syncTelegramBotCommands,
          waitForTelegramHandshake: waitForTelegramHandshakeForIgnite,
        },
      );
    } finally {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }
    return;
  }

  if (command === "setup" && subcommand === "model") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const project = runtime.getActiveProject();
    const targetAgentId = values["agent-id"]?.trim() || project.activeAgentId;
    const targetAgent = project.agents[targetAgentId];
    if (!targetAgent) {
      throw new Error(
        `Unknown agent in project '${project.id}': ${targetAgentId}`,
      );
    }

    const providerName = parseProviderName(
      values.provider,
      targetAgent.provider.name,
    );
    const providerDefaults = getProviderSetupDefaults(providerName);
    const model = values.model ?? providerDefaults.model;
    const defaultAuthMode =
      providerName === targetAgent.provider.name
        ? resolveProviderAuthMode(
            providerName,
            targetAgent.provider.authMode,
            providerDefaults.authMode,
          )
        : providerDefaults.authMode;
    const authMode = parseProviderAuthMode(
      values.auth,
      providerName,
      defaultAuthMode,
    );
    const defaultReasoningEffort =
      providerName === targetAgent.provider.name &&
      model === targetAgent.provider.model
        ? targetAgent.provider.reasoningEffort
        : (getProviderDefaultReasoningEffort(providerName, model) ?? undefined);
    const reasoningEffort = parseProviderReasoningEffort(
      values["reasoning-effort"],
      providerName,
      model,
      defaultReasoningEffort,
    );
    const keyEnvVar = getProviderApiKeyEnvVar(providerName);
    const apiKey = values["api-key"]?.trim() ?? "";
    if (authMode === "api_key") {
      if (apiKey) {
        writeSecretToLocalEnv(runtime.config.rootDir, keyEnvVar, apiKey);
      } else if (!resolveProviderApiKey(providerName)) {
        throw new Error(
          `Missing provider API key. Set ${keyEnvVar} in .env.local or pass ${accent("--api-key")} to save it automatically.`,
        );
      }
    } else if (apiKey) {
      throw new Error(
        `${accent("--api-key")} cannot be used with ${accent("--auth oauth")}.`,
      );
    }

    runtime.setupModel({
      agentId: targetAgentId,
      providerName,
      model,
      authMode,
      reasoningEffort,
    });

    const configuredProject = runtime.getActiveProject();
    const configuredAgent = configuredProject.agents[targetAgentId];
    console.log(`Project: ${project.id}`);
    console.log(`Agent: ${configuredAgent.id}`);
    console.log(`Provider configured: ${configuredAgent.provider.name}`);
    console.log(`Model: ${configuredAgent.provider.model}`);
    console.log(
      `Auth mode: ${displayProviderAuthMode(configuredAgent.provider.authMode)}`,
    );
    if (configuredAgent.provider.reasoningEffort) {
      console.log(
        `Reasoning effort: ${configuredAgent.provider.reasoningEffort}`,
      );
    }
    console.log(
      `Runtime: ${displayProviderRuntime(configuredAgent.provider.runtime)}`,
    );
    if (configuredAgent.provider.authMode === "api_key") {
      console.log(`API key env var: ${keyEnvVar}`);
    } else {
      console.log(
        `OAuth session: ${getProviderOauthSetupHint(
          configuredAgent.provider.name,
          configuredAgent.provider.cliCommand,
        )}`,
      );
    }
    console.log(
      `CLI: ${configuredAgent.provider.cliCommand} ${configuredAgent.provider.cliArgs.join(" ")}`,
    );
    return;
  }

  if (command === "setup" && subcommand === "api-key") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const providerValue = values.provider?.trim();
    const apiKey = values["api-key"]?.trim() ?? "";

    if (!providerValue) {
      throw new Error(`${accent("--provider")} is required`);
    }
    if (!apiKey) {
      throw new Error(`${accent("--api-key")} is required`);
    }

    const providerName = parseProviderName(providerValue, "openai");
    const keyEnvVar = getProviderApiKeyEnvVar(providerName);
    writeSecretToLocalEnv(runtime.config.rootDir, keyEnvVar, apiKey);

    console.log("Provider API key saved.");
    console.log(`Provider: ${providerName}`);
    console.log(`Env var: ${keyEnvVar}`);
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
    await runTelegramCommandsSync(runtime, values);
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
    // Legacy alias: operates on the `default` bot so existing scripts keep working.
    const botId = values.id ?? DEFAULT_TELEGRAM_BOT_ID;
    const existingBot = runtime.getTelegramBotProfile(botId);
    const tokenEnvVar = existingBot?.tokenEnvVar ?? TELEGRAM_BOT_TOKEN_ENV_VAR;

    if (!chatId) {
      throw new Error(`${accent("--chat-id")} is required`);
    }
    if (botToken) {
      writeSecretToLocalEnv(runtime.config.rootDir, tokenEnvVar, botToken);
    } else if (!resolveEnvVar(tokenEnvVar)) {
      throw new Error(
        `Missing Telegram bot token. Set ${tokenEnvVar} in .env.local or pass ${accent("--bot-token")} to save it automatically.`,
      );
    }

    runtime.setupTelegram({ chatId, botId });

    const bot = runtime.getTelegramBotSummary(botId);
    console.log("Telegram configured.");
    console.log(`Bot: ${bot.id}`);
    console.log(`Chat ID: ${bot.chatId}`);
    console.log(`Bot token env var: ${bot.tokenEnvVar}`);
    const token = resolveEnvVar(bot.tokenEnvVar);
    if (token) {
      const identity = await fetchTelegramBotIdentity(token);
      if (identity) {
        runtime.recordTelegramBotIdentity(bot.id, identity);
        if (identity.username) {
          console.log(`Username: @${identity.username}`);
        }
      }
    }
    if (!(await syncTelegramBotCommandsForBot(runtime, bot.id))) {
      console.log(
        styleCliText(
          "Run 'opencolab setup telegram commands sync' after fixing token access.",
        ),
      );
    }
    if (bot.scope === "floating") {
      console.log(
        styleCliText(
          `This bot follows the active project. Pin it with: opencolab telegram bot pin --id ${bot.id}`,
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

  if (
    command === "setup" &&
    subcommand === "telegram" &&
    action === "workflow-notifications"
  ) {
    const mode = (rest[0] ?? "status").trim().toLowerCase();
    const { values: notifyValues } = parseFlags(rest.slice(1));
    const notifyBotId = notifyValues.id ?? DEFAULT_TELEGRAM_BOT_ID;
    if (mode === "on" || mode === "enable" || mode === "true") {
      const bot = runtime.setTelegramBotWorkflowNotifications(notifyBotId, true);
      console.log(`Telegram workflow live updates: enabled for bot '${bot.id}'.`);
      console.log(
        styleCliText(
          "Live status will appear in that bot's paired chat for every run in its project.",
        ),
      );
      return;
    }
    if (mode === "off" || mode === "disable" || mode === "false") {
      const bot = runtime.setTelegramBotWorkflowNotifications(notifyBotId, false);
      console.log(`Telegram workflow live updates: disabled for bot '${bot.id}'.`);
      return;
    }
    if (mode === "status") {
      const bots = runtime.listTelegramBotSummaries();
      if (bots.length === 0) {
        console.log("Telegram workflow live updates: no bots configured.");
        return;
      }
      for (const bot of bots) {
        console.log(
          `${bot.id}: ${bot.notifyWorkflowProgress ? "enabled" : "disabled"}`,
        );
      }
      return;
    }
    throw new Error(
      "Usage: opencolab setup telegram workflow-notifications <on|off|status>",
    );
  }

  if (command === "setup" && subcommand === "telegram" && action === "pair") {
    await runTelegramPairCommand(runtime, rest, "opencolab setup telegram pair");
    return;
  }

  if (command === "telegram") {
    if (subcommand !== "bot" && subcommand !== "commands") {
      throw new Error(
        styleCliText("Unknown telegram command. Use 'bot' or 'commands sync'."),
      );
    }

    if (subcommand === "commands") {
      if (action !== "sync") {
        throw new Error("Unknown telegram commands command. Use 'sync'.");
      }
      const { values } = parseFlags(rest);
      await runTelegramCommandsSync(runtime, values);
      return;
    }

    const botAction = (action ?? "list").trim();
    const { values } = parseFlags(rest);

    if (botAction === "list") {
      const bots = runtime.listTelegramBotSummaries();
      if (bots.length === 0) {
        console.log("No Telegram bots configured.");
        console.log(
          styleCliText(
            "Add one with: opencolab telegram bot add --token <botfather_token> --project <project_id>",
          ),
        );
        return;
      }
      if (parseBooleanFlag(values.json, false)) {
        console.log(JSON.stringify(bots, null, 2));
        return;
      }
      console.log(`Telegram bots (${bots.length})`);
      for (const bot of bots) {
        console.log(formatTelegramBotLine(bot));
      }
      printTelegramProjectCoverage(runtime);
      return;
    }

    if (botAction === "show") {
      const bot = runtime.getTelegramBotSummary(requireBotIdFlag(values));
      if (parseBooleanFlag(values.json, false)) {
        console.log(JSON.stringify(bot, null, 2));
        return;
      }
      console.log(formatTelegramBotLine(bot));
      console.log(`    token env var: ${bot.tokenEnvVar}`);
      console.log(`    telegram bot id: ${bot.telegramBotId ?? "unknown"}`);
      console.log(`    paired at: ${bot.pairedAt ?? "never"}`);
      console.log(`    chat id: ${bot.chatId ?? "not set"}`);
      return;
    }

    if (botAction === "add") {
      const token = values.token?.trim();
      if (!token) {
        throw new Error(`${accent("--token")} is required`);
      }
      const floating = parseBooleanFlag(values.floating, false);
      const bot = await runtime.addTelegramBot({
        token,
        botId: values.id,
        projectId: values.project,
        agentId: values.agent ?? null,
        floating,
      });

      console.log(`Telegram bot added: ${bot.id}`);
      if (bot.telegramUsername) {
        console.log(`Username: @${bot.telegramUsername}`);
        console.log(`Open it: https://t.me/${bot.telegramUsername}`);
      }
      console.log(
        bot.scope === "floating"
          ? "Mode: floating (follows the active project)"
          : `Project: ${bot.projectId}`,
      );
      if (bot.agentId) {
        console.log(`Agent: ${bot.agentId}`);
      }
      console.log(`Token saved in .env.local as ${bot.tokenEnvVar}.`);
      await syncTelegramBotCommandsForBot(runtime, bot.id);
      console.log(
        styleCliText(
          `Next: message the bot, then run 'opencolab telegram bot pair --id ${bot.id} start'.`,
        ),
      );
      return;
    }

    if (botAction === "bind") {
      const botId = requireBotIdFlag(values);
      const bot = runtime.bindTelegramBot(botId, {
        projectId: values.project,
        ...(values.agent !== undefined ? { agentId: values.agent } : {}),
        agentAuto: parseBooleanFlag(values["agent-auto"], false),
      });
      console.log(`Bot '${bot.id}' is bound to project ${bot.projectId}.`);
      console.log(
        `Target agent: ${bot.effectiveAgentId ?? "none"}${bot.agentId ? "" : " (project default)"}`,
      );
      await syncTelegramBotCommandsForBot(runtime, bot.id);
      return;
    }

    if (botAction === "pin") {
      const bot = runtime.pinTelegramBot(requireBotIdFlag(values), values.project);
      console.log(`Bot '${bot.id}' is now pinned to project ${bot.projectId}.`);
      console.log(
        styleCliText(
          "That chat no longer follows the active project; /projects there is informational.",
        ),
      );
      await syncTelegramBotCommandsForBot(runtime, bot.id);
      return;
    }

    if (botAction === "unbind") {
      const bot = runtime.unbindTelegramBot(requireBotIdFlag(values));
      console.log(
        `Bot '${bot.id}' is floating again and follows the active project (${bot.effectiveProjectId ?? "none"}).`,
      );
      await syncTelegramBotCommandsForBot(runtime, bot.id);
      return;
    }

    if (botAction === "enable" || botAction === "disable") {
      const bot = runtime.setTelegramBotEnabled(
        requireBotIdFlag(values),
        botAction === "enable",
      );
      console.log(`Bot '${bot.id}' is now ${bot.enabled ? "enabled" : "disabled"}.`);
      return;
    }

    if (botAction === "remove") {
      const botId = requireBotIdFlag(values);
      const keepToken = parseBooleanFlag(values["keep-token"], false);
      const result = runtime.removeTelegramBot(botId, { keepToken });
      console.log(`Bot '${result.botId}' removed.`);
      console.log(
        result.tokenRemoved
          ? `Removed ${result.tokenEnvVar} from .env.local.`
          : `Left ${result.tokenEnvVar} in .env.local.`,
      );
      console.log(
        styleCliText(
          "Revoke the token in BotFather with /revoke if the bot is no longer needed.",
        ),
      );
      return;
    }

    if (botAction === "pair") {
      await runTelegramPairCommand(
        runtime,
        rest,
        "opencolab telegram bot pair",
      );
      return;
    }

    if (botAction === "test") {
      const { bot, token } = requireTelegramBotForCli(
        runtime,
        requireBotIdFlag(values),
      );
      const identity = await fetchTelegramBotIdentity(token);
      if (!identity) {
        throw new Error(
          `Telegram rejected the token in ${bot.tokenEnvVar} for bot '${bot.id}'.`,
        );
      }
      runtime.recordTelegramBotIdentity(bot.id, identity);
      console.log(`Token OK: @${identity.username ?? identity.telegramBotId}`);
      if (!bot.chatId) {
        console.log("No chat id yet, so no test message was sent.");
        return;
      }
      const sent = await sendTelegramTestMessage(
        token,
        bot.chatId,
        `OpenColab test from bot '${bot.id}'.`,
      );
      console.log(
        sent
          ? `Test message delivered to chat ${bot.chatId}.`
          : `Could not deliver a test message to chat ${bot.chatId}.`,
      );
      return;
    }

    throw new Error(
      styleCliText(
        "Unknown telegram bot command. Use add | list | show | bind | pin | unbind | enable | disable | remove | pair | test.",
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
        console.log(
          `${marker} ${agent.id} (${agent.path}) [${agent.provider.name}:${agent.provider.model} via ${agent.provider.runtime}]`,
        );
      }
      return;
    }

    if (subcommand === "show") {
      console.log(JSON.stringify(runtime.getActiveAgent(), null, 2));
      return;
    }
  }

  if (command === "gpu") {
    if (subcommand === "server") {
      const { values } = parseFlags([action, ...rest].filter(Boolean));

      if (action === "add") {
        const provider = values.provider?.trim();
        if (provider !== "runpod") {
          throw new Error(
            `${accent("--provider")} must be ${accent("runpod")}`,
          );
        }
        const serverId = values["server-id"]?.trim();
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }

        const bootstrapProfile = values["bootstrap-profile"]?.trim();
        if (
          bootstrapProfile &&
          bootstrapProfile !== "python-ml" &&
          bootstrapProfile !== "pytorch-cu12" &&
          bootstrapProfile !== "minimal-shell"
        ) {
          throw new Error("Unsupported bootstrap profile.");
        }

        const autoStopPolicy = values["auto-stop-policy"]?.trim();
        if (
          autoStopPolicy &&
          autoStopPolicy !== "stop_on_completion" &&
          autoStopPolicy !== "keep_warm"
        ) {
          throw new Error("Unsupported auto stop policy.");
        }

        runtime.setupExecutionTarget({
          id: serverId,
          enabled:
            values.enabled === undefined
              ? undefined
              : parseBooleanFlag(values.enabled, true),
          datacenterId: values.location ?? values["datacenter-id"],
          preferredDatacenterIds: parseCsvFlag(
            values.location ?? values["datacenter-id"],
          ),
          gpuType: parseCsvFlag(values["gpu-type"])?.[0],
          preferredGpuTypes: parseCsvFlag(values["gpu-type"]),
          gpuCount: parseOptionalIntegerFlag(values["gpu-count"]),
          templateId: values["template-id"] ?? undefined,
          imageName: values["image-name"] ?? undefined,
          volumeId: values["volume-id"] ?? undefined,
          volumeName: values["volume-name"],
          volumeSizeGb: parseOptionalIntegerFlag(values["volume-size-gb"]),
          workspaceRoot: values["workspace-root"],
          sshUser: values["ssh-user"] ?? undefined,
          sshPort: parseOptionalIntegerFlag(values["ssh-port"]),
          sshPrivateKeyPath: values["ssh-key-path"] ?? undefined,
          bootstrapProfile: bootstrapProfile as
            | "python-ml"
            | "pytorch-cu12"
            | "minimal-shell"
            | undefined,
          maxRuntimeMinutes: parseOptionalIntegerFlag(
            values["max-runtime-minutes"],
          ),
          idleStopMinutes:
            values["idle-stop-minutes"] === undefined
              ? undefined
              : (parseOptionalIntegerFlag(values["idle-stop-minutes"]) ?? null),
          autoStopPolicy: autoStopPolicy as
            | "stop_on_completion"
            | "keep_warm"
            | undefined,
          maxEstimatedCostUsd: parseOptionalNumberFlag(
            values["max-estimated-cost-usd"],
          ),
        });

        const target = runtime.getExecutionTarget(serverId);
        console.log(`Project: ${runtime.getActiveProject().id}`);
        console.log(`GPU server configured: ${target.id}`);
        console.log(`Provider: ${target.backend}`);
        console.log(`GPU: ${target.gpuCount} x ${target.gpuType}`);
        console.log(`Datacenter: ${target.datacenterId}`);
        if (target.preferredGpuTypes.length > 1) {
          console.log(`GPU candidates: ${target.preferredGpuTypes.join(", ")}`);
        }
        if (target.preferredDatacenterIds.length > 1) {
          console.log(
            `Location candidates: ${target.preferredDatacenterIds.join(", ")}`,
          );
        }
        console.log(`Workspace root: ${target.workspaceRoot}`);
        console.log(`Bootstrap profile: ${target.bootstrapProfile}`);
        return;
      }

      if (action === "list") {
        const targets = runtime.listExecutionTargets();
        for (const target of targets) {
          const marker = target.enabled ? "*" : "-";
          const gpuLabel =
            target.preferredGpuTypes.length > 1
              ? `${target.gpuType} (+${String(target.preferredGpuTypes.length - 1)})`
              : target.gpuType;
          const datacenterLabel =
            target.preferredDatacenterIds.length > 1
              ? `${target.datacenterId} (+${String(target.preferredDatacenterIds.length - 1)})`
              : target.datacenterId;
          console.log(
            `${marker} ${target.id} [${target.backend}] ${target.gpuCount}x ${gpuLabel} @ ${datacenterLabel}`,
          );
        }
        return;
      }

      if (action === "show") {
        const serverId = values["server-id"];
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }
        console.log(
          JSON.stringify(runtime.getExecutionTarget(serverId), null, 2),
        );
        return;
      }

      if (action === "availability") {
        const serverId = values["server-id"];
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }
        const result = await runtime.checkExecutionTargetAvailability(serverId);
        console.log(`Target: ${result.targetId}`);
        console.log(`Backend: ${result.backend}`);
        console.log(`Checked At: ${result.checkedAt}`);
        console.log(`Status: ${result.ok ? "available" : "unavailable"}`);
        if (result.bestCandidate) {
          const datacenterLabel =
            result.bestCandidate.datacenterLocation &&
            result.bestCandidate.datacenterLocation !==
              result.bestCandidate.datacenterId
              ? `${result.bestCandidate.datacenterId} (${result.bestCandidate.datacenterLocation})`
              : result.bestCandidate.datacenterId;
          const stockLabel = result.bestCandidate.stockStatus
            ? ` [${result.bestCandidate.stockStatus}]`
            : "";
          console.log(
            `Best match now: ${datacenterLabel} / ${result.bestCandidate.gpuType}${stockLabel}`,
          );
        }
        for (const candidate of result.candidates) {
          const datacenterLabel =
            candidate.datacenterLocation &&
            candidate.datacenterLocation !== candidate.datacenterId
              ? `${candidate.datacenterId} (${candidate.datacenterLocation})`
              : candidate.datacenterId;
          const stockLabel = candidate.available
            ? (candidate.stockStatus ?? "available")
            : "unavailable";
          const compatibilityHints: string[] = [];
          if (!candidate.podApiCompatible) {
            compatibilityHints.push("pod-api incompatible");
          }
          if (candidate.storageSupport === "failed") {
            compatibilityHints.push("storage failed");
          }
          const hintLabel =
            compatibilityHints.length > 0
              ? ` | ${compatibilityHints.join(", ")}`
              : "";
          console.log(
            `- ${datacenterLabel} | ${candidate.gpuType} | ${stockLabel}${hintLabel}`,
          );
        }
        for (const warning of result.warnings) {
          console.log(`Warning: ${warning}`);
        }
        return;
      }

      if (action === "test") {
        const serverId = values["server-id"];
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }
        const result = await runtime.testExecutionTarget(serverId);
        console.log(`Target: ${result.targetId}`);
        console.log(`Backend: ${result.backend}`);
        console.log(`Status: ${result.ok ? "ready" : "warnings"}`);
        for (const detail of result.details) {
          console.log(`- ${detail}`);
        }
        for (const warning of result.warnings) {
          console.log(`Warning: ${warning}`);
        }
        return;
      }

      if (action === "remove") {
        const serverId = values["server-id"];
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }
        runtime.removeExecutionTarget(serverId);
        console.log(`GPU server removed: ${serverId}`);
        return;
      }

      throw new Error("Unknown gpu server command.");
    }

    if (subcommand === "job") {
      const { values } = parseFlags([action, ...rest].filter(Boolean));

      if (action === "start") {
        const serverId = values["server-id"];
        const commandValue = values.command;
        if (!serverId) {
          throw new Error(`${accent("--server-id")} is required`);
        }
        if (!commandValue) {
          throw new Error(`${accent("--command")} is required`);
        }

        const status = await runtime.startGpuJob({
          targetId: serverId,
          command: commandValue,
          includePaths: parseCsvFlag(values.include),
          excludePaths: parseCsvFlag(values.exclude),
          expectedArtifacts: parseCsvFlag(values.artifact),
          envVarNames: parseCsvFlag(values.env),
          strictArtifacts: parseBooleanFlag(values["strict-artifacts"], false),
          maxRuntimeMinutes: parseOptionalIntegerFlag(
            values["max-runtime-minutes"],
          ),
          wait: parseBooleanFlag(values.wait, true),
        });

        console.log(`Run ID: ${status.runId}`);
        console.log(`Target: ${status.targetId}`);
        console.log(`State: ${status.state}`);
        console.log(`Message: ${status.message}`);
        return;
      }

      if (action === "status") {
        const runId = values["run-id"];
        if (!runId) {
          throw new Error(`${accent("--run-id")} is required`);
        }
        const status = await runtime.reconcileGpuJob(runId);
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      if (action === "logs") {
        const runId = values["run-id"];
        if (!runId) {
          throw new Error(`${accent("--run-id")} is required`);
        }
        const stream = values.stream?.trim() || "stdout";
        if (
          stream !== "stdout" &&
          stream !== "stderr" &&
          stream !== "bootstrap" &&
          stream !== "poller"
        ) {
          throw new Error("Unsupported log stream.");
        }
        const status = await runtime.reconcileGpuJob(runId);
        const logPath = status.logs[stream as keyof typeof status.logs];
        if (!logPath || !fs.existsSync(logPath)) {
          throw new Error(
            `No local ${stream} log is available for run '${runId}'.`,
          );
        }
        process.stdout.write(fs.readFileSync(logPath, "utf8"));
        return;
      }

      if (action === "exec") {
        const runId = values["run-id"];
        const commandValue = values.command;
        if (!runId) {
          throw new Error(`${accent("--run-id")} is required`);
        }
        if (!commandValue) {
          throw new Error(`${accent("--command")} is required`);
        }
        const result = await runtime.execGpuJobCommand({
          runId,
          command: commandValue,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (action === "fetch") {
        const runId = values["run-id"];
        if (!runId) {
          throw new Error(`${accent("--run-id")} is required`);
        }
        const status = await runtime.fetchGpuJobOutputs(runId);
        console.log(`Run ID: ${status.runId}`);
        console.log(`Fetched artifacts: ${status.fetchedArtifacts.length}`);
        console.log(`Missing artifacts: ${status.missingArtifacts.length}`);
        console.log(`State: ${status.state}`);
        return;
      }

      if (action === "cancel") {
        const runId = values["run-id"];
        if (!runId) {
          throw new Error(`${accent("--run-id")} is required`);
        }
        const status = await runtime.cancelGpuJob(runId);
        console.log(`Run ID: ${status.runId}`);
        console.log(`State: ${status.state}`);
        console.log(`Message: ${status.message}`);
        return;
      }

      if (action === "list") {
        const runs = runtime.listGpuJobs();
        for (const run of runs) {
          console.log(
            `${run.runId} [${run.state}] target=${run.targetId} created=${run.createdAt}`,
          );
        }
        return;
      }

      throw new Error("Unknown gpu job command.");
    }

    if (subcommand === "ssh") {
      const sshAction = action;
      const sshSubaction = rest[0];

      if (sshAction === "profile") {
        const { values } = parseFlags(rest.slice(1));
        const profileId = values["profile-id"]?.trim();

        if (sshSubaction === "save") {
          if (!profileId) {
            throw new Error(`${accent("--profile-id")} is required`);
          }

          const rawSshCommand = values["ssh-command"]?.trim();
          const parsedCommand = rawSshCommand
            ? parseManualSshCommand(rawSshCommand)
            : null;
          const interactiveAccess = values["interactive-access"]?.trim();
          if (
            interactiveAccess &&
            interactiveAccess !== "disabled" &&
            interactiveAccess !== "opt_in"
          ) {
            throw new Error("Unsupported interactive access policy.");
          }

          runtime.saveManualSshProfile({
            id: profileId,
            podId: values["pod-id"] ?? undefined,
            host: values.host ?? parsedCommand?.host ?? undefined,
            port:
              parseOptionalIntegerFlag(values.port) ??
              parsedCommand?.port ??
              undefined,
            user: values.user ?? parsedCommand?.user ?? undefined,
            privateKeyPath:
              values["ssh-key-path"] ??
              parsedCommand?.privateKeyPath ??
              undefined,
            sshConfigHost:
              values["ssh-config-host"] ??
              parsedCommand?.sshConfigHost ??
              undefined,
            workspaceRoot: values["workspace-root"] ?? undefined,
            interactiveAccess: interactiveAccess as
              | "disabled"
              | "opt_in"
              | undefined,
          });

          if (parseBooleanFlag(values["set-default"], false)) {
            runtime.setManualSshProfileDefault(profileId, values["agent-id"]);
          }

          const profile = runtime.getManualSshProfile(profileId);
          console.log(`Project: ${runtime.getActiveProject().id}`);
          console.log(`Manual SSH profile saved: ${profile.id}`);
          console.log(`Backend: ${profile.backend}`);
          if (profile.podId) {
            console.log(`Runpod Pod: ${profile.podId}`);
          }
          if (profile.sshConfigHost) {
            console.log(`SSH config host: ${profile.sshConfigHost}`);
          } else {
            console.log(`Host: ${profile.host}`);
            console.log(`Port: ${profile.port}`);
            console.log(`User: ${profile.user}`);
          }
          console.log(`Interactive access: ${profile.interactiveAccess}`);
          return;
        }

        if (sshSubaction === "list") {
          const project = runtime.getActiveProject();
          const activeAgentId = runtime.getActiveAgent().id;
          const defaultProfileId =
            project.agentRemoteDefaults[activeAgentId]?.manualSshProfileId;
          for (const profile of runtime.listManualSshProfiles()) {
            const marker = profile.id === defaultProfileId ? "*" : "-";
            const destination = profile.sshConfigHost
              ? profile.sshConfigHost
              : `${profile.user ?? "root"}@${profile.host}:${String(profile.port ?? 0)}`;
            const podLabel = profile.podId ? ` pod=${profile.podId}` : "";
            console.log(
              `${marker} ${profile.id} [${profile.backend}/${profile.mode}] ${destination}${podLabel}`,
            );
          }
          return;
        }

        if (sshSubaction === "show") {
          console.log(
            JSON.stringify(runtime.getManualSshProfile(profileId), null, 2),
          );
          return;
        }

        if (sshSubaction === "test") {
          const result = await runtime.testManualSshProfile(profileId);
          console.log(`Profile: ${result.profileId}`);
          console.log(`Backend: ${result.backend}`);
          console.log(`Status: ${result.ok ? "ready" : "warnings"}`);
          if (result.resolvedHost) {
            console.log(`Host: ${result.resolvedHost}`);
          }
          if (result.resolvedPort) {
            console.log(`Port: ${result.resolvedPort}`);
          }
          if (result.resolvedUser) {
            console.log(`User: ${result.resolvedUser}`);
          }
          if (result.refreshedFromRunpod) {
            console.log("Refreshed from Runpod: yes");
          }
          for (const detail of result.details) {
            console.log(`- ${detail}`);
          }
          for (const warning of result.warnings) {
            console.log(`Warning: ${warning}`);
          }
          return;
        }

        if (sshSubaction === "remove") {
          if (!profileId) {
            throw new Error(`${accent("--profile-id")} is required`);
          }
          runtime.removeManualSshProfile(profileId);
          console.log(`Manual SSH profile removed: ${profileId}`);
          return;
        }

        if (sshSubaction === "set-default") {
          if (!profileId) {
            throw new Error(`${accent("--profile-id")} is required`);
          }
          runtime.setManualSshProfileDefault(profileId, values["agent-id"]);
          const targetAgentId =
            values["agent-id"]?.trim() || runtime.getActiveAgent().id;
          console.log(`Manual SSH profile default set: ${profileId}`);
          console.log(`Agent: ${targetAgentId}`);
          return;
        }

        throw new Error("Unknown gpu ssh profile command.");
      }

      if (sshAction === "session") {
        const { values } = parseFlags(rest.slice(1));

        if (sshSubaction === "start") {
          const session = await runtime.startManualSshSession({
            profileId: values["profile-id"],
            agentId: values["agent-id"],
          });
          console.log(`Session ID: ${session.sessionId}`);
          console.log(`Profile: ${session.profileId}`);
          console.log(`State: ${session.state}`);
          console.log(`Message: ${session.message}`);
          return;
        }

        if (sshSubaction === "list") {
          for (const session of runtime.listManualSshSessions()) {
            console.log(
              `${session.sessionId} [${session.state}] profile=${session.profileId} agent=${session.agentId}`,
            );
          }
          return;
        }

        if (sshSubaction === "read") {
          const sessionId = values["session-id"]?.trim();
          if (!sessionId) {
            throw new Error(`${accent("--session-id")} is required`);
          }
          const offset = parseOptionalIntegerFlag(values.offset);
          console.log(
            JSON.stringify(
              runtime.readManualSshSession(sessionId, offset),
              null,
              2,
            ),
          );
          return;
        }

        if (sshSubaction === "write") {
          const sessionId = values["session-id"]?.trim();
          const inputValue = values.stdin;
          if (!sessionId) {
            throw new Error(`${accent("--session-id")} is required`);
          }
          if (inputValue === undefined) {
            throw new Error(`${accent("--stdin")} is required`);
          }
          const session = runtime.writeManualSshSession({
            sessionId,
            input: inputValue,
            appendNewline: parseBooleanFlag(values["append-newline"], true),
          });
          console.log(JSON.stringify(session, null, 2));
          return;
        }

        if (sshSubaction === "stop") {
          const sessionId = values["session-id"]?.trim();
          if (!sessionId) {
            throw new Error(`${accent("--session-id")} is required`);
          }
          console.log(
            JSON.stringify(
              await runtime.stopManualSshSession(sessionId),
              null,
              2,
            ),
          );
          return;
        }

        throw new Error("Unknown gpu ssh session command.");
      }

      throw new Error("Unknown gpu ssh command. Use 'profile' or 'session'.");
    }

    throw new Error("Unknown gpu command. Use 'server', 'job', or 'ssh'.");
  }

  if (command === "workflow") {
    await runWorkflowCommand(
      runtime,
      subcommand,
      [action, ...rest].filter(Boolean),
    );
    return;
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

async function runWorkflowCommand(
  runtime: ReturnType<typeof createRuntime>,
  subcommand: string | undefined,
  remaining: string[],
): Promise<void> {
  const { values, positionals } = parseFlags(remaining);
  const action = (subcommand ?? "").trim();

  if (!action || action === "help") {
    console.log(usageWorkflow());
    return;
  }

  if (action === "list") {
    const summaries = runtime.listWorkflows();
    if (summaries.length === 0) {
      console.log("No workflows found in this project.");
      return;
    }
    for (const summary of summaries) {
      const desc = summary.description ? ` - ${summary.description}` : "";
      console.log(`- ${summary.id} (v${summary.version}, ${summary.stepCount} steps)${desc}`);
    }
    return;
  }

  if (action === "show") {
    const workflowId = requireFlag(values, "workflow-id");
    const detail = runtime.getWorkflowDetail(workflowId);
    if (!detail) {
      throw new Error(`Workflow '${workflowId}' was not found or failed to validate.`);
    }
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (action === "validate") {
    const workflowId = requireFlag(values, "workflow-id");
    const result = runtime.validateWorkflow(workflowId);
    if (result.ok) {
      console.log(`Workflow '${workflowId}' is valid.`);
    } else {
      console.log(`Workflow '${workflowId}' has validation errors.`);
    }
    for (const issue of result.issues) {
      const tag = issue.severity === "error" ? "ERROR" : "warn";
      console.log(`  [${tag}] ${issue.message}`);
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (action === "create") {
    const workflowId = requireFlag(values, "workflow-id");
    const template = (values.from ?? "blank").trim();
    if (template !== "blank" && template !== "review-loop" && template !== "judge-and-retry") {
      throw new Error("--from must be blank, review-loop, or judge-and-retry");
    }
    const result = runtime.createWorkflow({
      workflowId,
      template,
    });
    console.log(`Workflow created: ${result.workflowId}`);
    console.log(`File: ${result.xmlPath}`);
    return;
  }

  if (action === "run") {
    const workflowId = requireFlag(values, "workflow-id");
    const input = resolveWorkflowInputs(values);
    const result = runtime.startWorkflowRun({
      workflowId,
      input,
      initiator: "cli",
    });
    console.log(`Workflow run started: ${result.runId}`);
    console.log(`Workflow: ${result.workflowId}`);
    const wait = parseBooleanFlag(values.wait, false);
    if (!wait) {
      console.log("Use 'opencolab workflow status --run-id ${runId}' to check progress.");
      return;
    }
    await waitForWorkflowRun(runtime, result.runId);
    return;
  }

  if (action === "status") {
    const runId = requireFlag(values, "run-id");
    const status = runtime.resolveWorkflowRun(runId);
    if (!status) {
      throw new Error(`Unknown workflow run: ${runId}`);
    }
    const fullStatus = runtime.getWorkflowRunStatus(status.workflowId, runId);
    console.log(JSON.stringify(fullStatus ?? status.runState, null, 2));
    return;
  }

  if (action === "logs") {
    const runId = requireFlag(values, "run-id");
    const resolved = runtime.resolveWorkflowRun(runId);
    if (!resolved) {
      throw new Error(`Unknown workflow run: ${runId}`);
    }
    const events = runtime.listWorkflowRunEvents(resolved.workflowId, runId);
    for (const event of events) {
      console.log(`[${event.at}] ${event.kind} ${event.message}`);
    }
    if (parseBooleanFlag(values.follow, false)) {
      await tailWorkflowEvents(runtime, resolved.workflowId, runId, events.length);
    }
    return;
  }

  if (action === "stop") {
    const runId = requireFlag(values, "run-id");
    const status = runtime.stopWorkflowRun(runId);
    if (!status) {
      throw new Error(`Unknown workflow run: ${runId}`);
    }
    console.log(`Stop requested for run ${runId}. Current status: ${status.status}`);
    return;
  }

  if (action === "resume") {
    const runId = requireFlag(values, "run-id");
    const status = runtime.resumeWorkflowRun(runId);
    console.log(`Workflow run resumed: ${status.runId} (status: ${status.status})`);
    return;
  }

  if (action === "approve") {
    const runId = requireFlag(values, "run-id");
    const decisionRaw = requireFlag(values, "decision").trim();
    if (decisionRaw === "continue") {
      const status = runtime.approveWorkflowGate(runId, { kind: "continue" });
      console.log(`Approval recorded: continue -> ${status.status}`);
      return;
    }
    if (decisionRaw === "stop") {
      const status = runtime.approveWorkflowGate(runId, { kind: "stop" });
      console.log(`Approval recorded: stop -> ${status.status}`);
      return;
    }
    if (decisionRaw === "retry") {
      const status = runtime.approveWorkflowGate(runId, { kind: "retry" });
      console.log(`Approval recorded: retry -> ${status.status}`);
      return;
    }
    if (decisionRaw.startsWith("branch:")) {
      const next = decisionRaw.slice("branch:".length).trim();
      if (!next) {
        throw new Error("--decision branch:<step> requires a step id");
      }
      const status = runtime.approveWorkflowGate(runId, { kind: "branch", next });
      console.log(`Approval recorded: branch -> ${status.status}`);
      return;
    }
    if (decisionRaw === "edit") {
      const valuesJson = values["values-json"];
      let parsed: Record<string, string> = {};
      if (valuesJson) {
        try {
          const obj = JSON.parse(valuesJson);
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            parsed = Object.fromEntries(
              Object.entries(obj as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value),
              ]),
            );
          }
        } catch {
          throw new Error("--values-json must be a JSON object of string values");
        }
      }
      const status = runtime.approveWorkflowGate(runId, {
        kind: "edit",
        values: parsed,
      });
      console.log(`Approval recorded: edit -> ${status.status}`);
      return;
    }
    throw new Error(
      "--decision must be one of continue, stop, retry, branch:<step>, or edit",
    );
  }

  if (action === "runs") {
    const workflowId = values["workflow-id"];
    const runs = runtime.listWorkflowRuns(workflowId);
    if (runs.length === 0) {
      console.log("No workflow runs found.");
      return;
    }
    for (const run of runs) {
      console.log(
        `${run.runId} workflow=${run.workflowId} status=${run.status} updated=${run.updatedAt}`,
      );
    }
    return;
  }

  void positionals;
  throw new Error(`Unknown workflow command: ${action}. Try 'opencolab workflow --help'.`);
}

function requireFlag(values: Record<string, string>, name: string): string {
  const value = values[name]?.trim();
  if (!value) {
    throw new Error(`${accent(`--${name}`)} is required`);
  }
  return value;
}

function resolveWorkflowInputs(values: Record<string, string>): Record<string, string> {
  const fromFile = values["input-file"];
  if (fromFile) {
    const raw = fs.readFileSync(fromFile, "utf8");
    return parseInputsJson(raw, `--input-file ${fromFile}`);
  }
  const fromJson = values["input-json"];
  if (fromJson) {
    return parseInputsJson(fromJson, "--input-json");
  }
  const inputText = values.input;
  if (inputText !== undefined) {
    return { task: inputText };
  }
  return {};
}

function parseInputsJson(raw: string, source: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse ${source} as JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object of string values.`);
  }
  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    inputs[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return inputs;
}

async function waitForWorkflowRun(
  runtime: ReturnType<typeof createRuntime>,
  runId: string,
): Promise<void> {
  let lastSeen = 0;
  while (true) {
    const resolved = runtime.resolveWorkflowRun(runId);
    if (!resolved) {
      throw new Error(`Workflow run ${runId} disappeared before completion.`);
    }
    const status = resolved.runState.status;
    const events = runtime.listWorkflowRunEvents(resolved.workflowId, runId);
    for (let i = lastSeen; i < events.length; i += 1) {
      const event = events[i]!;
      console.log(`[${event.at}] ${event.kind} ${event.message}`);
    }
    lastSeen = events.length;
    if (
      status === "complete" ||
      status === "failed" ||
      status === "stopped" ||
      status === "paused"
    ) {
      return;
    }
    await delay(1000);
  }
}

async function tailWorkflowEvents(
  runtime: ReturnType<typeof createRuntime>,
  workflowId: string,
  runId: string,
  startIndex: number,
): Promise<void> {
  let lastSeen = startIndex;
  while (true) {
    const events = runtime.listWorkflowRunEvents(workflowId, runId);
    for (let i = lastSeen; i < events.length; i += 1) {
      const event = events[i]!;
      console.log(`[${event.at}] ${event.kind} ${event.message}`);
    }
    lastSeen = events.length;
    const state = runtime.getWorkflowRun(workflowId, runId);
    if (
      state &&
      (state.status === "complete" ||
        state.status === "failed" ||
        state.status === "stopped" ||
        state.status === "paused")
    ) {
      return;
    }
    await delay(1000);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
