import fs from "node:fs";
import path from "node:path";
import { getCanonicalProviderKeyEnvVar } from "./provider.js";
import type { ProviderName } from "./types.js";

export const TELEGRAM_BOT_TOKEN_ENV_VAR = "TELEGRAM_BOT_TOKEN";

export function getProviderApiKeyEnvVar(providerName: ProviderName): string {
  return getCanonicalProviderKeyEnvVar(providerName);
}

export function resolveProviderApiKey(providerName: ProviderName): string | null {
  return readEnvValue(getProviderApiKeyEnvVar(providerName));
}

export function resolveTelegramBotToken(): string | null {
  return readEnvValue(TELEGRAM_BOT_TOKEN_ENV_VAR);
}

export function hasProviderApiKey(providerName: ProviderName): boolean {
  return resolveProviderApiKey(providerName) !== null;
}

export function hasTelegramBotToken(): boolean {
  return resolveTelegramBotToken() !== null;
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
