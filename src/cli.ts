#!/usr/bin/env node
import { startHttpServer } from "./http.js";
import { getProviderSetupDefaults, isProviderName } from "./provider.js";
import { createRuntime } from "./runtime.js";
import type { ProviderName } from "./types.js";

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
    "OpenColab CLI (minimal v1)",
    "",
    "Commands:",
    "  opencolab init",
    "  opencolab setup model [--provider codex|claude_code] [--model <model>] [--api-key-env-var <env>] [--cli-command <cmd>] [--cli-args '<arg1,arg2>']",
    "  opencolab setup telegram --bot-token-env-var TELEGRAM_BOT_TOKEN --chat-id <id>",
    "  opencolab setup telegram pair start",
    "  opencolab setup telegram pair complete --code <pairing_code>",
    "  opencolab agent init [--agent-id research_agent] [--path agents/research_agent]",
    "  opencolab agent show",
    "  opencolab gateway start [--port 4646] [--telegram-polling true|false]",
    "",
    "Notes:",
    "  - v1 uses one agent with provider runtime: codex or claude_code.",
    "  - Pairing code is sent to Telegram and must be entered in CLI."
  ].join("\n");
}

function parseProviderName(value: string | undefined): ProviderName {
  const parsed = value ?? "codex";
  if (!isProviderName(parsed)) {
    throw new Error(`Unsupported provider: ${parsed}. Use codex or claude_code.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const [command, subcommand, action, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  if ((command === "gateway" || command === "getway" || command === "web") && subcommand === "start") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const port = Number(values.port ?? "4646");
    const telegramPolling = values["telegram-polling"] !== "false" && values["telegram-polling"] !== "0";
    startHttpServer(port, process.cwd(), { telegramPolling });
    return;
  }

  const runtime = createRuntime();
  runtime.init();

  if (command === "init") {
    const state = runtime.getState();
    console.log(`Initialized OpenColab at ${runtime.config.projectConfigPath}`);
    console.log(`Agent: ${state.agent.id} (${state.agent.path})`);
    return;
  }

  if (command === "setup" && subcommand === "model") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const providerName = parseProviderName(values.provider);
    const providerDefaults = getProviderSetupDefaults(providerName);
    const state = runtime.setupModel({
      providerName,
      model: values.model ?? providerDefaults.model,
      apiKeyEnvVar: values["api-key-env-var"] ?? providerDefaults.apiKeyEnvVar,
      cliCommand: values["cli-command"] ?? providerDefaults.cliCommand,
      cliArgs: parseCsv(values["cli-args"] ?? providerDefaults.cliArgs.join(","))
    });

    console.log(`Provider configured: ${state.provider.name}`);
    console.log(`Model: ${state.provider.model}`);
    console.log(`API key env var: ${state.provider.apiKeyEnvVar}`);
    console.log(`CLI: ${state.provider.cliCommand} ${state.provider.cliArgs.join(" ")}`);
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action !== "pair") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const chatId = values["chat-id"];

    if (!chatId) {
      throw new Error("--chat-id is required");
    }

    const state = runtime.setupTelegram({
      botTokenEnvVar: values["bot-token-env-var"] ?? "TELEGRAM_BOT_TOKEN",
      chatId
    });

    console.log("Telegram configured.");
    console.log(`Chat ID: ${state.telegram.chatId}`);
    console.log(`Bot token env var: ${state.telegram.botTokenEnvVar}`);
    console.log("Run 'opencolab setup telegram pair start' to begin pairing.");
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action === "pair") {
    const pairAction = rest[0];

    if (pairAction === "start") {
      const result = await runtime.startPairing();
      console.log(`Pairing code sent to Telegram (expires ${result.expiresAt}).`);
      console.log(`Enter in CLI: opencolab setup telegram pair complete --code ${result.code}`);
      return;
    }

    if (pairAction === "complete") {
      const { values } = parseFlags(rest.slice(1));
      const code = values.code;
      if (!code) {
        throw new Error("--code is required");
      }

      const result = runtime.completePairing(code);
      console.log(`Telegram pairing completed at ${result.pairedAt}`);
      return;
    }

    throw new Error("Unknown pairing command. Use 'start' or 'complete --code <value>'.");
  }

  if (command === "agent" && subcommand === "init") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const agentId = values["agent-id"] ?? "research_agent";
    const agentPath = values.path ?? "agents/research_agent";

    const state = runtime.configureAgent(agentId, agentPath);
    console.log(`Agent configured: ${state.agent.id}`);
    console.log(`Agent path: ${state.agent.path}`);
    return;
  }

  if (command === "agent" && subcommand === "show") {
    console.log(JSON.stringify(runtime.getState().agent, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
