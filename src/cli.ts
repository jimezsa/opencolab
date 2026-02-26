#!/usr/bin/env node
import path from "node:path";
import { createRuntime } from "./runtime.js";
import { startHttpServer } from "./http.js";
import { loadConfig } from "./config.js";
import { isSetupCompleted, runSetupWizard } from "./setup.js";

function parseFlags(args: string[]): { values: Record<string, string>; positionals: string[] } {
  const values: Record<string, string> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        values[key] = "true";
      } else {
        values[key] = next;
        i += 1;
      }
    } else {
      positionals.push(value);
    }
  }

  return { values, positionals };
}

function parseEnvFlags(raw: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [key, ...rest] = pair.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

function usage(): string {
  return [
    "OpenColab CLI",
    "",
    "Commands:",
    "  opencolab setup",
    "  opencolab init",
    "  opencolab project create <name>",
    "  opencolab agent template add --template-id <id> --provider <openai|anthropic|google> --cli-command <cmd> [--default-args \"a,b\"] [--default-env \"KEY=V,KEY2=V2\"]",
    "  opencolab agent instance add --agent-id <id> --template-id <id> --role <professor|student|reviewer> [--workspace <path>] [--max-runtime-sec 300] [--retry-limit 1]",
    "  opencolab agent list",
    "  opencolab run start --project <name> --goal <text>",
    "  opencolab run status <run_id>",
    "  opencolab run approve <run_id>",
    "  opencolab run pause <run_id>",
    "  opencolab run stop <run_id>",
    "  opencolab chat list <run_id>",
    "  opencolab chat view <chat_id>",
    "  opencolab meeting list <run_id>",
    "  opencolab skill sync",
    "  opencolab web start [--port 4646]"
  ].join("\n");
}

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;
  const [command, subcommand, action, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    if (!isSetupCompleted()) {
      console.log("\nTip: run 'opencolab setup' for guided first-time configuration.");
    }
    return;
  }

  if (command === "setup") {
    await runSetupWizard();
    return;
  }

  if (command === "web" && subcommand === "start") {
    const { values } = parseFlags([action, ...rest].filter(Boolean));
    const config = loadConfig();
    const port = Number(values.port ?? config.localApiPort);
    startHttpServer(port);
    return;
  }

  const runtime = createRuntime();
  const { orchestrator, close } = runtime;

  try {
    if (command === "init") {
      orchestrator.init();
      console.log("OpenColab initialized.");
      if (!isSetupCompleted()) {
        console.log("Run 'opencolab setup' for guided provider keys, models, and Telegram setup.");
      }
      return;
    }

    if (command === "project" && subcommand === "create") {
      const projectName = action;
      if (!projectName) {
        throw new Error("project name is required");
      }
      orchestrator.createProject(projectName);
      console.log(`Project created: ${projectName}`);
      return;
    }

    if (command === "agent" && subcommand === "template" && action === "add") {
      const { values } = parseFlags(rest);
      const templateId = values["template-id"];
      const provider = values.provider as "openai" | "anthropic" | "google" | undefined;
      const cliCommand = values["cli-command"];

      if (!templateId || !provider || !cliCommand) {
        throw new Error("--template-id, --provider, and --cli-command are required");
      }

      orchestrator.addAgentTemplate({
        templateId,
        provider,
        cliCommand,
        defaultArgs: (values["default-args"] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        defaultEnv: parseEnvFlags(values["default-env"] ?? "")
      });
      console.log(`Agent template saved: ${templateId}`);
      return;
    }

    if (command === "agent" && subcommand === "instance" && action === "add") {
      const { values } = parseFlags(rest);
      const agentId = values["agent-id"];
      const templateId = values["template-id"];
      const role = values.role as "professor" | "student" | "reviewer" | undefined;

      if (!agentId || !templateId || !role) {
        throw new Error("--agent-id, --template-id, and --role are required");
      }

      const workspace =
        values.workspace ?? path.join(process.cwd(), "projects", "_default", "agents", agentId);

      orchestrator.addAgentInstance({
        agentId,
        templateId,
        role,
        workspacePath: workspace,
        maxRuntimeSec: Number(values["max-runtime-sec"] ?? "300"),
        retryLimit: Number(values["retry-limit"] ?? "1"),
        isolationMode: (values["isolation-mode"] as "host" | "docker" | undefined) ?? "host",
        enabled: values.enabled !== "false"
      });

      console.log(`Agent instance saved: ${agentId}`);
      return;
    }

    if (command === "agent" && subcommand === "list") {
      console.log(JSON.stringify(orchestrator.listAgentInstances(), null, 2));
      return;
    }

    if (command === "run" && subcommand === "start") {
      const { values } = parseFlags([action, ...rest].filter(Boolean));
      const projectName = values.project;
      const goal = values.goal;

      if (!projectName || !goal) {
        throw new Error("--project and --goal are required");
      }

      const result = await orchestrator.startRun({
        projectName,
        goal
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "run" && subcommand === "status") {
      if (!action) {
        throw new Error("run id is required");
      }
      console.log(JSON.stringify(orchestrator.getRunStatus(action), null, 2));
      return;
    }

    if (command === "run" && subcommand === "approve") {
      if (!action) {
        throw new Error("run id is required");
      }
      orchestrator.approveRun(action);
      console.log(`Run approved: ${action}`);
      return;
    }

    if (command === "run" && subcommand === "pause") {
      if (!action) {
        throw new Error("run id is required");
      }
      orchestrator.pauseRun(action);
      console.log(`Run paused: ${action}`);
      return;
    }

    if (command === "run" && subcommand === "stop") {
      if (!action) {
        throw new Error("run id is required");
      }
      orchestrator.stopRun(action);
      console.log(`Run stopped: ${action}`);
      return;
    }

    if (command === "chat" && subcommand === "list") {
      if (!action) {
        throw new Error("run id is required");
      }
      console.log(JSON.stringify(orchestrator.listChats(action), null, 2));
      return;
    }

    if (command === "chat" && subcommand === "view") {
      if (!action) {
        throw new Error("chat id is required");
      }
      console.log(JSON.stringify(orchestrator.viewChat(action), null, 2));
      return;
    }

    if (command === "meeting" && subcommand === "list") {
      if (!action) {
        throw new Error("run id is required");
      }
      console.log(JSON.stringify(orchestrator.listMeetings(action), null, 2));
      return;
    }

    if (command === "skill" && subcommand === "sync") {
      console.log(JSON.stringify(orchestrator.syncSkills(), null, 2));
      return;
    }

    throw new Error(`Unknown command: ${argv.join(" ")}`);
  } finally {
    close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
