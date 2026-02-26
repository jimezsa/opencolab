import fs from "node:fs";
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
  setupStatePath: string;
}

export function loadConfig(cwd = process.cwd()): OpenColabConfig {
  const rootDir = cwd;
  loadLocalEnv(rootDir);
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
    forceMockCli: (process.env.OPENCOLAB_FORCE_MOCK_CLI ?? "1") !== "0",
    setupStatePath: path.join(rootDir, ".opencolab", "setup.json")
  };
}

function loadLocalEnv(rootDir: string): void {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
