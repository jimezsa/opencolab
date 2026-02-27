import fs from "node:fs";
import path from "node:path";
import type { ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

export class ConversationStore {
  constructor(private readonly conversationsDir: string) {
    ensureDir(conversationsDir);
  }

  readRecent(chatId: string, limit = 8): ConversationMessage[] {
    const conversationPath = this.filePath(chatId);
    if (!fs.existsSync(conversationPath)) {
      return [];
    }

    const lines = fs.readFileSync(conversationPath, "utf8").split(/\r?\n/).filter(Boolean);
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

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(parsed.length - limit);
  }

  append(chatId: string, message: ConversationMessage): void {
    const conversationPath = this.filePath(chatId);
    ensureDir(path.dirname(conversationPath));
    fs.appendFileSync(conversationPath, `${JSON.stringify(message)}\n`, "utf8");
  }

  private filePath(chatId: string): string {
    const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.conversationsDir, `${safeChatId}.jsonl`);
  }
}
