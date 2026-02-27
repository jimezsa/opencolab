import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

interface ProviderWizard {
  provider: "openai" | "anthropic" | "google";
  templateId: string;
  label: string;
  defaultCli: string;
  keyName: string;
}

const providers: ProviderWizard[] = [
  {
    provider: "openai",
    templateId: "tpl_codex",
    label: "OpenAI Codex",
    defaultCli: "codex",
    keyName: "OPENAI_API_KEY"
  },
  {
    provider: "anthropic",
    templateId: "tpl_claude_code",
    label: "Anthropic Claude Code",
    defaultCli: "claude_code",
    keyName: "ANTHROPIC_API_KEY"
  },
  {
    provider: "google",
    templateId: "tpl_gemini",
    label: "Google Gemini CLI",
    defaultCli: "gemini",
    keyName: "GEMINI_API_KEY"
  }
];

export async function runSetupWizard(cwd = process.cwd()): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Setup wizard requires an interactive terminal (TTY).");
  }

  const config = loadConfig(cwd);
  const runtime = createRuntime(cwd);
  const { orchestrator, close } = runtime;
  const rl = createInterface({ input, output });

  try {
    console.log("\nOpenColab first-time setup\n");
    console.log("This wizard configures provider CLIs, model args, API keys, and Telegram access.");
    console.log("Project configuration is saved in opencolab.json.\n");

    const configuredProviders: string[] = [];
    const missingCli: string[] = [];

    const forceMock = await askYesNo(
      rl,
      "Use mock execution mode by default? (recommended for first run)",
      true
    );
    orchestrator.setSetting("opencolab.force_mock_cli", forceMock ? "1" : "0");

    const existingTemplates = new Map(
      orchestrator.listAgentTemplates().map((template) => [template.templateId, template])
    );

    for (const provider of providers) {
      console.log(`\n--- ${provider.label} ---`);
      const enable = await askYesNo(rl, `Configure ${provider.label}?`, true);
      if (!enable) {
        continue;
      }

      configuredProviders.push(provider.label);
      const existing = existingTemplates.get(provider.templateId);
      const existingDefaultEnv = { ...(existing?.defaultEnv ?? {}) };

      const cliCommand = await askText(
        rl,
        "CLI command",
        existing?.cliCommand ?? provider.defaultCli
      );

      const currentArgs = existing?.defaultArgs.join(",") ?? "";
      const modelArgsRaw = await askText(
        rl,
        "Default model args (comma-separated, leave blank for none)",
        currentArgs
      );

      const hasStoredKey = Boolean(existingDefaultEnv[provider.keyName]);
      const apiKeyPrompt = hasStoredKey
        ? `${provider.keyName} (leave blank to keep current key)`
        : `${provider.keyName} (leave blank to skip for now)`;

      const apiKey = await askText(rl, apiKeyPrompt, "");
      if (apiKey) {
        existingDefaultEnv[provider.keyName] = apiKey;
      }

      orchestrator.addAgentTemplate({
        templateId: provider.templateId,
        provider: provider.provider,
        cliCommand,
        defaultArgs: splitCsv(modelArgsRaw),
        defaultEnv: existingDefaultEnv
      });

      if (!commandExists(cliCommand)) {
        missingCli.push(`${provider.label}: install executable '${cliCommand}'`);
      }
    }

    const setupTelegram = await askYesNo(rl, "Configure Telegram bridge now?", false);
    if (setupTelegram) {
      const existingBotToken = orchestrator.getSetting("telegram.bot_token") ?? "";
      const existingChatId = orchestrator.getSetting("telegram.chat_id") ?? "";

      const botToken = await askText(
        rl,
        existingBotToken
          ? "TELEGRAM_BOT_TOKEN (leave blank to keep current token)"
          : "TELEGRAM_BOT_TOKEN",
        ""
      );
      const chatId = await askText(
        rl,
        existingChatId ? "TELEGRAM_CHAT_ID (leave blank to keep current chat)" : "TELEGRAM_CHAT_ID",
        existingChatId
      );

      if (botToken) {
        orchestrator.setSetting("telegram.bot_token", botToken);
      }
      if (chatId) {
        orchestrator.setSetting("telegram.chat_id", chatId);
      }
    }

    writeSetupState(config.setupStatePath, {
      completedAt: new Date().toISOString(),
      configuredProviders,
      secretsStorage: "opencolab.json",
      forceMockDefault: forceMock
    });

    console.log("\nSetup complete.\n");

    if (missingCli.length > 0) {
      console.log("Missing CLI tools detected:");
      for (const item of missingCli) {
        console.log(`- ${item}`);
      }
      console.log("");
    }

    console.log("Next steps:");
    console.log("1. npm run build");
    console.log("2. node dist/src/cli.js project create demo-lab");
    console.log('3. node dist/src/cli.js run start --project demo-lab --goal "Your research goal"');
    console.log("4. node dist/src/cli.js web start --port 4646");
  } finally {
    rl.close();
    close();
  }
}

export function isSetupCompleted(cwd = process.cwd()): boolean {
  const config = loadConfig(cwd);
  return fs.existsSync(config.setupStatePath);
}

async function askText(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: string
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const response = (await rl.question(`${question}${suffix}: `)).trim();
  if (!response) {
    return defaultValue;
  }
  return response;
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean
): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const response = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();

  if (!response) {
    return defaultValue;
  }

  return response === "y" || response === "yes";
}

function splitCsv(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function commandExists(command: string): boolean {
  if (!command) {
    return false;
  }

  const result = spawnSync("sh", ["-lc", `command -v ${shellEscape(command)} >/dev/null 2>&1`]);
  return result.status === 0;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function writeSetupState(setupStatePath: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(setupStatePath), { recursive: true });
  fs.writeFileSync(setupStatePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
