import { loadConfig } from "./config.js";
import { getSetting, openDb } from "./db.js";
import { initWorkspace } from "./paths.js";
import { Orchestrator } from "./orchestration/orchestrator.js";

export function createRuntime(cwd = process.cwd()): {
  orchestrator: Orchestrator;
  close: () => void;
} {
  const config = loadConfig(cwd);
  initWorkspace(config);
  const db = openDb(config);
  applyDbSettingsOverrides(config, db);
  const orchestrator = new Orchestrator(db, config);
  orchestrator.init();

  return {
    orchestrator,
    close: () => db.close()
  };
}

function applyDbSettingsOverrides(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof openDb>
): void {
  const forceMock = getSetting(db, "opencolab.force_mock_cli");
  if (forceMock !== null && process.env.OPENCOLAB_FORCE_MOCK_CLI === undefined) {
    config.forceMockCli = forceMock !== "0";
  }

  const telegramBotToken = getSetting(db, "telegram.bot_token");
  if (telegramBotToken && process.env.TELEGRAM_BOT_TOKEN === undefined) {
    config.telegramBotToken = telegramBotToken;
  }

  const telegramChatId = getSetting(db, "telegram.chat_id");
  if (telegramChatId && process.env.TELEGRAM_CHAT_ID === undefined) {
    config.telegramChatId = telegramChatId;
  }
}
