/**
 * Secret resolution and persistence helpers.
 * Reads canonical provider/Telegram keys from env and updates .env.local safely.
 */
import fs from "node:fs";
import path from "node:path";
import { getCanonicalProviderKeyEnvVar } from "./provider.js";
import { spawnCliSync } from "./spawn-cli.js";
import type { ProviderName } from "./types.js";

export const TELEGRAM_BOT_TOKEN_ENV_VAR = "TELEGRAM_BOT_TOKEN";
export const RUNPOD_API_KEY_ENV_VAR = "RUNPOD_API_KEY";
const OAUTH_STATUS_TIMEOUT_MS = 5_000;

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

type LoginStatusExecutor = (cliCommand: string) => CommandResult;

type AuthStatusExecutor = (cliCommand: string) => CommandResult;

export interface ProviderOauthStatus {
  authenticated: boolean;
  detail?: string;
}

export function getProviderApiKeyEnvVar(providerName: ProviderName): string {
  return getCanonicalProviderKeyEnvVar(providerName);
}

export function resolveProviderApiKey(providerName: ProviderName): string | null {
  return readEnvValue(getProviderApiKeyEnvVar(providerName));
}

export function resolveEnvVar(key: string): string | null {
  return readEnvValue(key);
}

export function resolveTelegramBotToken(): string | null {
  return readEnvValue(TELEGRAM_BOT_TOKEN_ENV_VAR);
}

export function resolveRunpodApiKey(): string | null {
  return readEnvValue(RUNPOD_API_KEY_ENV_VAR);
}

export function hasProviderApiKey(providerName: ProviderName): boolean {
  return resolveProviderApiKey(providerName) !== null;
}

export function hasTelegramBotToken(): boolean {
  return resolveTelegramBotToken() !== null;
}

export function hasRunpodApiKey(): boolean {
  return resolveRunpodApiKey() !== null;
}

export function resolveOpenAiOauthStatus(
  cliCommand = "codex",
  executeLoginStatus: LoginStatusExecutor = runOpenAiLoginStatusCommand
): ProviderOauthStatus {
  const result = executeLoginStatus(cliCommand);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const normalized = output.toLowerCase();

  if (result.error) {
    return {
      authenticated: false,
      detail: describeSpawnError(result.error, cliCommand)
    };
  }

  if (normalized.includes("not logged in") || normalized.includes("logged out")) {
    return {
      authenticated: false,
      detail: output || `${cliCommand} login status reported no active session.`
    };
  }

  if (result.status === 0 && (normalized.includes("logged in") || normalized.includes("authenticated"))) {
    return {
      authenticated: true,
      detail: output
    };
  }

  const fallbackDetail = output || `${cliCommand} login status returned ${String(result.status)}.`;
  return {
    authenticated: false,
    detail: fallbackDetail
  };
}

export function resolveAnthropicOauthStatus(
  cliCommand = "claude",
  executeAuthStatus: AuthStatusExecutor = runAnthropicAuthStatusCommand
): ProviderOauthStatus {
  const result = executeAuthStatus(cliCommand);
  const output = `${result.stdout}\n${result.stderr}`.trim();

  if (result.error) {
    return {
      authenticated: false,
      detail: describeSpawnError(result.error, cliCommand)
    };
  }

  const parsed = parseJsonObject(output);
  if (!parsed) {
    return {
      authenticated: false,
      detail: output || `${cliCommand} auth status returned ${String(result.status)}.`
    };
  }

  const loggedIn = parsed.loggedIn === true;
  const authMethod = normalizeAnthropicAuthMethod(parsed.authMethod);
  if (loggedIn && authMethod !== "api_key") {
    return {
      authenticated: true,
      detail: output
    };
  }

  if (loggedIn && authMethod === "api_key") {
    const apiKeySource = asNonEmptyString(parsed.apiKeySource);
    return {
      authenticated: false,
      detail: apiKeySource
        ? `${cliCommand} auth status is using ${apiKeySource}; OAuth mode requires a stored Claude Code login.`
        : `${cliCommand} auth status is using API key auth; OAuth mode requires a stored Claude Code login.`
    };
  }

  return {
    authenticated: false,
    detail: output || `${cliCommand} auth status reported no active session.`
  };
}

export function writeSecretToLocalEnv(rootDir: string, key: string, value: string): void {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error("Secret key is required.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedKey)) {
    throw new Error(`Invalid env key: ${trimmedKey}`);
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error(`Secret value for ${trimmedKey} is required.`);
  }
  if (trimmedValue.includes("\n") || trimmedValue.includes("\r")) {
    throw new Error(`Secret value for ${trimmedKey} cannot contain new lines.`);
  }

  const envPath = path.join(rootDir, ".env.local");
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const nextLine = `${trimmedKey}=${trimmedValue}`;

  let replaced = false;
  const nextLines = lines.map((line) => {
    const candidate = parseEnvLine(line);
    if (!candidate || candidate.key !== trimmedKey) {
      return line;
    }
    replaced = true;
    return nextLine;
  });

  if (!replaced) {
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
      nextLines.pop();
    }
    if (nextLines.length > 0) {
      nextLines.push("");
    }
    nextLines.push(nextLine);
  }

  fs.writeFileSync(envPath, `${nextLines.join("\n")}\n`, "utf8");
  process.env[trimmedKey] = trimmedValue;
}

function readEnvValue(key: string): string | null {
  const value = process.env[key];
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function describeSpawnError(error: Error, cliCommand: string): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return (
      `Could not find the '${cliCommand}' CLI on PATH. Install it and ensure it is ` +
      `on PATH, or set the provider's cliCommand to its full path.`
    );
  }
  return error.message;
}

function runOpenAiLoginStatusCommand(cliCommand: string): CommandResult {
  const result = spawnCliSync(cliCommand, ["login", "status"], {
    encoding: "utf8",
    env: buildCommandEnv(process.env, ["OPENAI_API_KEY"]),
    timeout: OAUTH_STATUS_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

function runAnthropicAuthStatusCommand(cliCommand: string): CommandResult {
  const result = spawnCliSync(cliCommand, ["auth", "status", "--json"], {
    encoding: "utf8",
    env: buildCommandEnv(process.env, [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_SMALL_FAST_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "API_TIMEOUT_MS",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
    ]),
    timeout: OAUTH_STATUS_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

function buildCommandEnv(
  baseEnv: NodeJS.ProcessEnv,
  keysToClear: string[]
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of keysToClear) {
    delete env[key];
  }
  return env;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAnthropicAuthMethod(value: unknown): string | null {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  return normalized ?? null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEnvLine(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) {
    return null;
  }

  const separator = line.indexOf("=");
  if (separator < 1) {
    return null;
  }

  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!key) {
    return null;
  }

  return { key, value };
}
