#!/usr/bin/env node
import { startHttpServer } from "./http.js";
import { DEFAULT_AGENT_ID } from "./project-config.js";
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
    "OpenColab CLI (multi-project v1)",
    "",
    "Commands:",
    "  opencolab init",
    "  opencolab setup model [--provider codex|claude_code] [--model <model>] [--api-key-env-var <env>] [--cli-command <cmd>] [--cli-args '<arg1,arg2>']",
    "  opencolab setup telegram --bot-token-env-var TELEGRAM_BOT_TOKEN --chat-id <id>",
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
    "  - Telegram pairing is per active project."
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
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    console.log(`Initialized OpenColab at ${runtime.config.projectConfigPath}`);
    console.log(`Active project: ${state.activeProjectId} (${project.path})`);
    console.log(`Active agent: ${agent.id} (${agent.path})`);
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

  if (command === "setup" && subcommand === "telegram" && action !== "pair") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const chatId = values["chat-id"];

    if (!chatId) {
      throw new Error("--chat-id is required");
    }

    runtime.setupTelegram({
      botTokenEnvVar: values["bot-token-env-var"] ?? "TELEGRAM_BOT_TOKEN",
      chatId
    });

    const project = runtime.getActiveProject();
    console.log(`Project: ${project.id}`);
    console.log("Telegram configured.");
    console.log(`Chat ID: ${project.telegram.chatId}`);
    console.log(`Bot token env var: ${project.telegram.botTokenEnvVar}`);
    console.log("Run 'opencolab setup telegram pair start' to begin pairing.");
    return;
  }

  if (command === "setup" && subcommand === "telegram" && action === "pair") {
    const pairAction = rest[0];

    if (pairAction === "start") {
      const project = runtime.getActiveProject();
      const result = await runtime.startPairing();
      console.log(`Project: ${project.id}`);
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

      const project = runtime.getActiveProject();
      const result = runtime.completePairing(code);
      console.log(`Project: ${project.id}`);
      console.log(`Telegram pairing completed at ${result.pairedAt}`);
      return;
    }

    throw new Error("Unknown pairing command. Use 'start' or 'complete --code <value>'.");
  }

  if (command === "project") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));

    if (subcommand === "create" || subcommand === "init") {
      const projectId = values["project-id"];
      if (!projectId) {
        throw new Error("--project-id is required");
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
        throw new Error("--project-id is required");
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
        throw new Error("--agent-id is required");
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
