/**
 * Conversation history storage.
 * Persists and reads per-agent session JSONL logs under project memory folders.
 */
import fs from "node:fs";
import path from "node:path";
import type { ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

export class ConversationStore {
  constructor(private readonly rootDir: string) {
    ensureDir(rootDir);
  }

  readRecent(agentPath: string, limit = 8): ConversationMessage[] {
    const sessionDir = this.resolveCurrentSessionDir(agentPath);
    const files = this.listSessionFiles(sessionDir);
    const parsed: ConversationMessage[] = [];

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

      for (const line of lines) {
        try {
          const item = JSON.parse(line) as ConversationMessage;
          if (item && (item.role === "user" || item.role === "assistant")) {
            parsed.push(item);
          }
        } catch {
          // Ignore malformed history lines.
        }
      }
    }

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(parsed.length - limit);
  }

  append(agentPath: string, message: ConversationMessage): void {
    const sessionDir = this.resolveCurrentSessionDir(agentPath);
    const conversationPath = path.join(sessionDir, `${currentDateIso()}.jsonl`);
    ensureDir(path.dirname(conversationPath));
    fs.appendFileSync(conversationPath, `${JSON.stringify(message)}\n`, "utf8");
  }

  resetSession(agentPath: string): string {
    const sessionsDir = this.sessionsDir(agentPath);
    ensureDir(sessionsDir);
    const sessionId = this.createUniqueSessionId(sessionsDir);
    ensureDir(path.join(sessionsDir, sessionId));
    this.writeActiveSessionId(sessionsDir, sessionId);
    return sessionId;
  }

  private resolveCurrentSessionDir(agentPath: string): string {
    const sessionsDir = this.sessionsDir(agentPath);
    ensureDir(sessionsDir);
    const activeSessionId = this.readActiveSessionId(sessionsDir);
    if (activeSessionId && fs.existsSync(path.join(sessionsDir, activeSessionId))) {
      return path.join(sessionsDir, activeSessionId);
    }

    const entries = this.listSessionDirectories(sessionsDir);
    const latest = entries[entries.length - 1];
    if (latest) {
      this.writeActiveSessionId(sessionsDir, latest);
      return path.join(sessionsDir, latest);
    }

    const sessionId = this.createUniqueSessionId(sessionsDir);
    const sessionDir = path.join(sessionsDir, sessionId);
    ensureDir(sessionDir);
    this.writeActiveSessionId(sessionsDir, sessionId);
    return sessionDir;
  }

  private sessionsDir(agentPath: string): string {
    return path.join(this.rootDir, agentPath, "memory", "Session");
  }

  private listSessionFiles(sessionDir: string): string[] {
    return fs
      .readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(sessionDir, name));
  }

  private listSessionDirectories(sessionsDir: string): string[] {
    return fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private activeSessionMarkerPath(sessionsDir: string): string {
    return path.join(sessionsDir, ".active-session");
  }

  private readActiveSessionId(sessionsDir: string): string | null {
    const markerPath = this.activeSessionMarkerPath(sessionsDir);
    if (!fs.existsSync(markerPath)) {
      return null;
    }

    const value = fs.readFileSync(markerPath, "utf8").trim();
    return value || null;
  }

  private writeActiveSessionId(sessionsDir: string, sessionId: string): void {
    fs.writeFileSync(this.activeSessionMarkerPath(sessionsDir), `${sessionId}\n`, "utf8");
  }

  private createUniqueSessionId(sessionsDir: string): string {
    let sessionId = createSessionId();
    while (fs.existsSync(path.join(sessionsDir, sessionId))) {
      sessionId = createSessionId();
    }
    return sessionId;
  }
}

function createSessionId(now = new Date()): string {
  const suffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `session-${formatTimestamp(now)}-${suffix}`;
}

function currentDateIso(now = new Date()): string {
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimestamp(now: Date): string {
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}`;
}
