#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline";
import { startHttpServer } from "./http.js";
import { runIgnite } from "./ignite.js";
import { DEFAULT_AGENT_ID } from "./project-config.js";
import { getProviderSetupDefaults, isProviderName } from "./provider.js";
import { createRuntime } from "./runtime.js";
import { resolveSecretReference } from "./secrets.js";
import type { OpenColabState, ProviderName } from "./types.js";

const PROJECT_PET = "🐙";
const ESC_INPUT = "\u001b";
const ANSI_ORANGE = "\u001b[38;5;208m";
const ANSI_RESET = "\u001b[0m";

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
  { command: "project_create", description: "Create project: /project_create <id>" },
  { command: "project_use", description: "Use project: /project_use <id>" },
  { command: "agent_list", description: "List agents" },
  { command: "agent_create", description: "Create agent: /agent_create <id>" },
  { command: "agent_use", description: "Use agent: /agent_use <id>" },
  { command: "session_reset", description: "Reset active session" },
  { command: "project", description: "Project command help" },
  { command: "agent", description: "Agent command help" },
  { command: "session", description: "Session command help" }
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

function styleCliText(value: string): string {
  const withCommands = value.replace(
    /\bopencolab(?:\s+[a-z0-9_./<>\-|]+)+/gi,
    (match) => accent(match)
  );
  return withCommands.replace(/--[a-z0-9-]+/gi, (match) => accent(match));
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

function parseFlags(args: string[]): { values: Record<string, string>; positionals: string[] } {
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

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function usage(): string {
  return [
    `OpenColab CLI (multi-project v1) ${PROJECT_PET}`,
    "",
    "Commands:",
    "  opencolab init",
    "  opencolab ignite",
    "  opencolab setup model [--provider codex|claude_code] [--model <model>] [--api-key-env-var <env>] [--cli-command <cmd>] [--cli-args '<arg1,arg2>']",
    "  opencolab setup telegram --bot-token-env-var TELEGRAM_BOT_TOKEN --chat-id <id>",
    "  opencolab setup telegram commands sync [--bot-token-env-var TELEGRAM_BOT_TOKEN] [--chat-id <id>]",
    "  opencolab setup telegram pair start",
    "  opencolab setup telegram pair complete --code <pairing_code>",
    "  opencolab project create --project-id <id>",
    "  opencolab project use --project-id <id>",
    "  opencolab project list",
    "  opencolab project show",
    "  opencolab agent create --agent-id <id> [--path projects/<project_id>/subagents/<agent_id>]",
    "  opencolab agent use --agent-id <id>",
    "  opencolab agent list",
    "  opencolab agent show",
    "  opencolab gateway start [--port 4646] [--telegram-polling true|false]",
    "",
    "Notes:",
    "  - State is stored in opencolab.json under projects and agents.",
    "  - Telegram configuration and pairing are shared across all projects.",
    "  - 'opencolab ignite' runs an interactive first-time setup."
  ]
    .map((line) => styleCliText(line))
    .join("\n");
}

function parseProviderName(value: string | undefined): ProviderName {
  const parsed = value ?? "codex";
  if (!isProviderName(parsed)) {
    throw new Error(`Unsupported provider: ${parsed}. Use codex or claude_code.`);
  }
  return parsed;
}

async function syncTelegramBotCommands(
  botTokenReference: string,
  chatId?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const token = resolveSecretReference(botTokenReference);
  if (!token) {
    return {
      ok: false,
      error: `missing token value for reference '${botTokenReference}'`
    };
  }

  try {
    const scopes: TelegramCommandScope[] = [
      { type: "default" },
      { type: "all_private_chats" },
      { type: "all_group_chats" },
      ...(chatId ? [{ type: "chat", chat_id: chatId } as const] : [])
    ];

    for (const scope of scopes) {
      const scopePayload =
        scope.type === "default"
          ? {}
          : scope.type === "chat"
            ? { scope: { type: "chat", chat_id: scope.chat_id } }
            : { scope: { type: scope.type } };

      const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          commands: TELEGRAM_MENU_COMMANDS,
          ...scopePayload
        })
      });

      if (!response.ok) {
        const message = await response.text();
        return {
          ok: false,
          error: `[scope:${scope.type}] ${message || `telegram api status ${String(response.status)}`}`
        };
      }

      const body = (await response.json()) as TelegramApiResult;
      if (body.ok !== true) {
        return {
          ok: false,
          error: `[scope:${scope.type}] ${body.description ?? "telegram returned ok=false"}`
        };
      }
    }

    const menuTargets: Array<{ label: string; payload: Record<string, unknown> }> = [
      {
        label: "default",
        payload: {
          menu_button: { type: "commands" }
        }
      },
      ...(chatId
        ? [
            {
              label: "chat",
              payload: {
                chat_id: chatId,
                menu_button: { type: "commands" }
              }
            }
          ]
        : [])
    ];

    for (const target of menuTargets) {
      const menuResponse = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(target.payload)
      });

      if (!menuResponse.ok) {
        const message = await menuResponse.text();
        return {
          ok: false,
          error: `[menu:${target.label}] ${message || `telegram api status ${String(menuResponse.status)}`}`
        };
      }

      const menuBody = (await menuResponse.json()) as TelegramApiResult;
      if (menuBody.ok !== true) {
        return {
          ok: false,
          error: `[menu:${target.label}] ${menuBody.description ?? "telegram returned ok=false"}`
        };
      }
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function autoSyncTelegramCommandsIfConfigured(
  state: OpenColabState
): Promise<{ attempted: boolean; ok: boolean; error?: string }> {
  if (!state.telegram.chatId) {
    return { attempted: false, ok: true };
  }

  const result = await syncTelegramBotCommands(state.telegram.botTokenEnvVar, state.telegram.chatId);
  return {
    attempted: true,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {})
  };
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const [command, subcommand, action, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  if ((command === "gateway" || command === "getway" || command === "web") && subcommand === "start") {
    const runtime = createRuntime();
    runtime.init();
    const autoSync = await autoSyncTelegramCommandsIfConfigured(runtime.getState());
    if (autoSync.attempted) {
      if (autoSync.ok) {
        console.log("Telegram bot commands synced.");
      } else {
        console.log(`Warning: could not sync Telegram commands (${autoSync.error ?? "unknown error"}).`);
      }
    }

    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const port = Number(values.port ?? "4646");
    const telegramPolling = values["telegram-polling"] !== "false" && values["telegram-polling"] !== "0";
    startHttpServer(port, process.cwd(), { telegramPolling });
    return;
  }

  const runtime = createRuntime();
  runtime.init();

  if (command === "ignite" || command === "onboard") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Interactive onboarding requires a TTY terminal.");
    }

    try {
      await runIgnite(
        runtime,
        {
          ask: async (prompt) => askInteractive(prompt),
          write: (line) => {
            console.log(styleCliText(line));
          }
        },
        {
          syncTelegramCommands: syncTelegramBotCommands
        }
      );
    } finally {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    }
    return;
  }

  if (command === "init") {
    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    console.log(`Initialized OpenColab at ${runtime.config.projectConfigPath}`);
    console.log(`Project pet: ${PROJECT_PET}`);
    console.log(`Active project: ${state.activeProjectId} (${project.path})`);
    console.log(`Active agent: ${agent.id} (${agent.path})`);
    const autoSync = await autoSyncTelegramCommandsIfConfigured(state);
    if (autoSync.attempted) {
      if (autoSync.ok) {
        console.log("Telegram bot commands synced.");
      } else {
        console.log(`Warning: could not sync Telegram commands (${autoSync.error ?? "unknown error"}).`);
      }
    }
    return;
  }

  if (command === "setup" && subcommand === "model") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const providerName = parseProviderName(values.provider);
    const providerDefaults = getProviderSetupDefaults(providerName);
    runtime.setupModel({
      providerName,
      model: values.model ?? providerDefaults.model,
      apiKeyEnvVar: values["api-key-env-var"] ?? providerDefaults.apiKeyEnvVar,
      cliCommand: values["cli-command"] ?? providerDefaults.cliCommand,
      cliArgs: parseCsv(values["cli-args"] ?? providerDefaults.cliArgs.join(","))
    });

    const project = runtime.getActiveProject();
    console.log(`Project: ${project.id}`);
    console.log(`Provider configured: ${project.provider.name}`);
    console.log(`Model: ${project.provider.model}`);
    console.log(`API key env var: ${project.provider.apiKeyEnvVar}`);
    console.log(`CLI: ${project.provider.cliCommand} ${project.provider.cliArgs.join(" ")}`);
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action === "commands") {
    const syncAction = rest[0];
    if (syncAction !== "sync") {
      throw new Error("Unknown telegram commands command. Use 'sync'.");
    }

    const { values } = parseFlags(rest.slice(1));
    const botTokenReference = values["bot-token-env-var"] ?? runtime.getState().telegram.botTokenEnvVar;
    const chatId = values["chat-id"] ?? runtime.getState().telegram.chatId;
    const syncResult = await syncTelegramBotCommands(botTokenReference, chatId);
    if (!syncResult.ok) {
      throw new Error(`Could not sync Telegram commands: ${syncResult.error ?? "unknown error"}`);
    }

    console.log("Telegram bot commands synced.");
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action !== "pair" && action !== "commands") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const chatId = values["chat-id"];

    if (!chatId) {
      throw new Error(`${accent("--chat-id")} is required`);
    }

    runtime.setupTelegram({
      botTokenEnvVar: values["bot-token-env-var"] ?? "TELEGRAM_BOT_TOKEN",
      chatId
    });

    const state = runtime.getState();
    console.log("Telegram configured.");
    console.log(`Chat ID: ${state.telegram.chatId}`);
    console.log(`Bot token env var: ${state.telegram.botTokenEnvVar}`);
    const syncResult = await syncTelegramBotCommands(state.telegram.botTokenEnvVar, state.telegram.chatId);
    if (syncResult.ok) {
      console.log("Telegram bot commands synced.");
    } else {
      console.log(`Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`);
      console.log(styleCliText("Run 'opencolab setup telegram commands sync' after fixing token access."));
    }
    console.log(styleCliText("Run 'opencolab setup telegram pair start' to begin pairing."));
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action === "pair") {
    const pairAction = rest[0];

    if (pairAction === "start") {
      const result = await runtime.startPairing();
      console.log(`Pairing code sent to Telegram (expires ${result.expiresAt}).`);
      console.log(styleCliText(`Enter in CLI: opencolab setup telegram pair complete --code ${result.code}`));
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
      const syncResult = await syncTelegramBotCommands(state.telegram.botTokenEnvVar, state.telegram.chatId);
      if (syncResult.ok) {
        console.log("Telegram bot commands synced.");
      } else {
        console.log(`Warning: could not sync Telegram commands (${syncResult.error ?? "unknown error"}).`);
      }
      return;
    }

    throw new Error(styleCliText("Unknown pairing command. Use 'start' or 'complete --code <value>'."));
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
        console.log(`${marker} ${project.id} (active agent: ${project.activeAgentId})`);
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
