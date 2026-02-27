import fs from "node:fs";
import path from "node:path";

export interface OpenColabConfig {
  rootDir: string;
  projectConfigPath: string;
  stateDir: string;
  conversationsDir: string;
  localApiPort: number;
  forceMockCodex: boolean;
  codexTimeoutMs: number;
}

export function loadConfig(cwd = process.cwd()): OpenColabConfig {
  const rootDir = cwd;
  loadLocalEnv(rootDir);

  return {
    rootDir,
    projectConfigPath: path.join(rootDir, "opencolab.json"),
    stateDir: path.join(rootDir, ".opencolab"),
    conversationsDir: path.join(rootDir, ".opencolab", "conversations"),
    localApiPort: Number(process.env.OPENCOLAB_PORT ?? "4646"),
    forceMockCodex: (process.env.OPENCOLAB_FORCE_MOCK_CLI ?? "1") !== "0",
    codexTimeoutMs: Number(process.env.OPENCOLAB_CODEX_TIMEOUT_MS ?? "120000")
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

    const separator = line.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
