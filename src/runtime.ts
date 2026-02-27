import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { initWorkspace } from "./paths.js";
import { Orchestrator } from "./orchestration/orchestrator.js";
import { ensureProjectConfiguration } from "./project-config.js";

export function createRuntime(cwd = process.cwd()): {
  orchestrator: Orchestrator;
  close: () => void;
} {
  const config = loadConfig(cwd);
  initWorkspace(config);
  const db = openDb(config);
  const projectConfig = ensureProjectConfiguration(config, db);
  applyProjectConfigOverrides(config, projectConfig);
  const orchestrator = new Orchestrator(db, config);
  orchestrator.init();

  return {
    orchestrator,
    close: () => db.close()
  };
}

function applyProjectConfigOverrides(
  config: ReturnType<typeof loadConfig>,
  projectConfig: ReturnType<typeof ensureProjectConfiguration>
): void {
  const forceMock = projectConfig.settings["opencolab.force_mock_cli"] ?? null;
  if (forceMock !== null && process.env.OPENCOLAB_FORCE_MOCK_CLI === undefined) {
    config.forceMockCli = forceMock !== "0";
  }

  const telegramBotToken = projectConfig.settings["telegram.bot_token"] ?? null;
  if (telegramBotToken && process.env.TELEGRAM_BOT_TOKEN === undefined) {
    config.telegramBotToken = telegramBotToken;
  }

  const telegramChatId = projectConfig.settings["telegram.chat_id"] ?? null;
  if (telegramChatId && process.env.TELEGRAM_CHAT_ID === undefined) {
    config.telegramChatId = telegramChatId;
  }
}
