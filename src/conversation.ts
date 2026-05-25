/**
 * Conversation history storage.
 * Persists and reads per-agent session JSONL logs under project memory folders.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentMemoryContext, ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

export class ConversationStore {
  constructor(private readonly rootDir: string) {
    ensureDir(rootDir);
  }

  readPromptMemory(agentPath: string, limit = 8, now = new Date()): AgentMemoryContext {
    return {
      workingMemory: this.readWorkingMemory(agentPath, limit, now),
      previousDaySummary: this.readPreviousDaySummary(agentPath, now)
    };
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

  getActiveSessionId(agentPath: string): string {
    const sessionsDir = this.sessionsDir(agentPath);
    ensureDir(sessionsDir);
    const marker = this.readActiveSessionId(sessionsDir);
    if (marker && fs.existsSync(path.join(sessionsDir, marker))) {
      return marker;
    }
    const directories = this.listSessionDirectories(sessionsDir);
    const latest = directories[directories.length - 1];
    if (latest) {
      this.writeActiveSessionId(sessionsDir, latest);
      return latest;
    }
    return this.resetSession(agentPath);
  }

  listSessionIds(agentPath: string): string[] {
    const sessionsDir = this.sessionsDir(agentPath);
    if (!fs.existsSync(sessionsDir)) {
      return [];
    }
    return this.listSessionDirectories(sessionsDir);
  }

  activateSession(agentPath: string, sessionId: string): boolean {
    if (!sessionId) {
      return false;
    }
    const sessionsDir = this.sessionsDir(agentPath);
    const targetDir = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(targetDir)) {
      return false;
    }
    this.writeActiveSessionId(sessionsDir, sessionId);
    return true;
  }

  readSessionMessages(agentPath: string, sessionId: string): ConversationMessage[] {
    const sessionsDir = this.sessionsDir(agentPath);
    const sessionDir = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      return [];
    }
    const collected: ConversationMessage[] = [];
    for (const filePath of this.listSessionFiles(sessionDir)) {
      collected.push(...this.readConversationFile(filePath));
    }
    return collected;
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

  private dailyDir(agentPath: string): string {
    return path.join(this.rootDir, agentPath, "memory", "Daily");
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

  private readWorkingMemory(
    agentPath: string,
    limit: number,
    now: Date
  ): ConversationMessage[] {
    const sessionDir = this.resolveCurrentSessionDir(agentPath);
    const dayPath = path.join(sessionDir, `${currentDateIso(now)}.jsonl`);
    const parsed = this.readConversationFile(dayPath);
    return parsed.length <= limit ? parsed : parsed.slice(parsed.length - limit);
  }

  private readPreviousDaySummary(agentPath: string, now: Date): string {
    const dateIso = previousDateIso(now);
    const summaryPath = path.join(this.dailyDir(agentPath), `${dateIso}.md`);
    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, "utf8").trim();
    }

    const source = this.collectDayMessages(agentPath, dateIso);
    if (source.messages.length === 0) {
      return "";
    }

    ensureDir(path.dirname(summaryPath));
    const summary = buildDailySummary(dateIso, source.messages, source.sessionCount);
    fs.writeFileSync(summaryPath, `${summary}\n`, "utf8");
    return summary;
  }

  private collectDayMessages(
    agentPath: string,
    dateIso: string
  ): { messages: ConversationMessage[]; sessionCount: number } {
    const sessionsDir = this.sessionsDir(agentPath);
    ensureDir(sessionsDir);
    const messages: ConversationMessage[] = [];
    let sessionCount = 0;

    for (const sessionId of this.listSessionDirectories(sessionsDir)) {
      const dayPath = path.join(sessionsDir, sessionId, `${dateIso}.jsonl`);
      if (!fs.existsSync(dayPath)) {
        continue;
      }
      sessionCount += 1;
      messages.push(...this.readConversationFile(dayPath));
    }

    return { messages, sessionCount };
  }

  private readConversationFile(filePath: string): ConversationMessage[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    const parsed: ConversationMessage[] = [];
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
    return parsed;
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

function previousDateIso(now: Date): string {
  const previous = new Date(now.getTime());
  previous.setUTCDate(previous.getUTCDate() - 1);
  return currentDateIso(previous);
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

function buildDailySummary(
  dateIso: string,
  messages: ConversationMessage[],
  sessionCount: number
): string {
  const userHighlights = collectHighlights(messages, "user", 4);
  const assistantHighlights = collectHighlights(messages, "assistant", 3);
  const lastUser = findLastMessage(messages, "user");
  const lastAssistant = findLastMessage(messages, "assistant");
  const openLoops = [
    lastUser ? `Last user request: ${truncateForSummary(lastUser.content, 220)}` : "",
    lastAssistant ? `Last agent response: ${truncateForSummary(lastAssistant.content, 220)}` : ""
  ].filter(Boolean);

  return [
    `# DAILY MEMORY - ${dateIso}`,
    "",
    "Deterministic recap of the previous UTC day.",
    "",
    `Sessions covered: ${String(sessionCount)}`,
    `Messages captured: ${String(messages.length)}`,
    "",
    "## User Focus",
    ...renderBulletSection(userHighlights, "No user highlights captured."),
    "",
    "## Agent Responses",
    ...renderBulletSection(assistantHighlights, "No assistant responses captured."),
    "",
    "## Open Loops",
    ...renderBulletSection(openLoops, "No explicit open loops captured.")
  ].join("\n");
}

function collectHighlights(
  messages: ConversationMessage[],
  role: ConversationMessage["role"],
  limit: number
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== role) {
      continue;
    }

    const normalized = truncateForSummary(message.content, 220);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
    if (results.length >= limit) {
      break;
    }
  }

  return results.reverse();
}

function renderBulletSection(items: string[], emptyMessage: string): string[] {
  if (items.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return items.map((item) => `- ${item}`);
}

function findLastMessage(
  messages: ConversationMessage[],
  role: ConversationMessage["role"]
): ConversationMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return messages[index];
    }
  }
  return null;
}

function truncateForSummary(value: string, limit: number): string {
  const normalized = value
    .replace(/\[telegram_files\][\s\S]*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}
