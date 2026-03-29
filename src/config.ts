/**
 * Runtime configuration loader.
 * Resolves repository paths and imports environment values from local env files.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PROVIDER_CLI_TIMEOUT_MS = 1800000;
const PROVIDER_CLI_TIMEOUT_ENV_VAR = "OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS";

export interface OpenColabConfig {
  rootDir: string;
  projectConfigPath: string;
  stateDir: string;
  conversationsDir: string;
  piAgentDir: string;
  localApiPort: number;
  forceMockCodex: boolean;
  providerCliTimeoutMs: number;
}

export function loadConfig(cwd = process.cwd()): OpenColabConfig {
  const rootDir = cwd;
  loadLocalEnv(rootDir);

  return {
    rootDir,
    projectConfigPath: path.join(rootDir, "opencolab.json"),
    stateDir: path.join(rootDir, ".opencolab"),
    conversationsDir: path.join(rootDir, ".opencolab", "conversations"),
    piAgentDir: path.join(rootDir, ".opencolab", "pi-agent"),
    localApiPort: Number(process.env.OPENCOLAB_PORT ?? "4646"),
    forceMockCodex: (process.env.OPENCOLAB_FORCE_MOCK_CLI ?? "0") !== "0",
    providerCliTimeoutMs: Number(resolveProviderCliTimeoutMs()),
  };
}

function resolveProviderCliTimeoutMs(): string {
  return process.env[PROVIDER_CLI_TIMEOUT_ENV_VAR] ?? String(DEFAULT_PROVIDER_CLI_TIMEOUT_MS);
}

function loadLocalEnv(rootDir: string): void {
  loadEnvFile(path.join(rootDir, ".env.local"));
  loadEnvFile(path.join(rootDir, ".env"));
}

function loadEnvFile(envPath: string): void {
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
