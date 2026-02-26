import path from "node:path";

export interface OpenColabConfig {
  rootDir: string;
  dbPath: string;
  projectsDir: string;
  skillsDir: string;
  globalConcurrency: number;
  localApiPort: number;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  mockCliOnMissing: boolean;
  forceMockCli: boolean;
}

export function loadConfig(cwd = process.cwd()): OpenColabConfig {
  const rootDir = cwd;
  return {
    rootDir,
    dbPath: path.join(rootDir, "opencolab.db"),
    projectsDir: path.join(rootDir, "projects"),
    skillsDir: path.join(rootDir, "SKILLS"),
    globalConcurrency: Number(process.env.OPENCOLAB_GLOBAL_CONCURRENCY ?? "4"),
    localApiPort: Number(process.env.OPENCOLAB_PORT ?? "4646"),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? null,
    mockCliOnMissing: (process.env.OPENCOLAB_MOCK_CLI_ON_MISSING ?? "1") !== "0",
    forceMockCli: (process.env.OPENCOLAB_FORCE_MOCK_CLI ?? "1") !== "0"
  };
}
