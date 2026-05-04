/**
 * Small shared utility helpers.
 * Includes filesystem safety helpers and common time/random/json operations.
 */
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function randomDigits(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 9) {
    throw new Error("length must be an integer between 1 and 9");
  }

  const max = 10 ** length;
  return String(randomInt(max)).padStart(length, "0");
}

export function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomDigits(6)}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures and surface the original write error.
    }
    throw error;
  }
}
