import type { OpenColabConfig } from "./config.js";
import type { Db } from "./db.js";
import { recordEvent } from "./events.js";
import { newId, nowIso } from "./utils.js";

export class TelegramBridge {
  constructor(
    private readonly db: Db,
    private readonly config: OpenColabConfig
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.telegramBotToken && this.config.telegramChatId);
  }

  ensureThread(runId: string): string | null {
    if (!this.config.telegramChatId) {
      return null;
    }

    const existing = this.db.get<{ thread_id: string }>(
      `SELECT thread_id
       FROM telegram_threads
       WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
      {
        run_id: runId,
        telegram_chat_id: this.config.telegramChatId
      }
    );

    if (existing) {
      return existing.thread_id;
    }

    const threadId = newId("tg");
    this.db.run(
      `INSERT INTO telegram_threads (thread_id, run_id, telegram_chat_id, last_message_at, created_at)
       VALUES (:thread_id, :run_id, :telegram_chat_id, :last_message_at, :created_at)`,
      {
        thread_id: threadId,
        run_id: runId,
        telegram_chat_id: this.config.telegramChatId,
        last_message_at: null,
        created_at: nowIso()
      }
    );
    return threadId;
  }

  async sendRunUpdate(runId: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const chatId = this.config.telegramChatId as string;
    const token = this.config.telegramBotToken as string;
    this.ensureThread(runId);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const ok = response.ok;
    const now = nowIso();
    this.db.run(
      `UPDATE telegram_threads
       SET last_message_at = :last_message_at
       WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
      {
        run_id: runId,
        telegram_chat_id: chatId,
        last_message_at: now
      }
    );

    recordEvent(this.db, runId, "telegram.message", {
      direction: "outbound",
      ok,
      text
    });

    return ok;
  }

  recordInbound(runId: string, sender: string, text: string): void {
    this.ensureThread(runId);
    this.db.run(
      `UPDATE telegram_threads
       SET last_message_at = :last_message_at
       WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
      {
        run_id: runId,
        telegram_chat_id: this.config.telegramChatId,
        last_message_at: nowIso()
      }
    );

    recordEvent(this.db, runId, "telegram.message", {
      direction: "inbound",
      sender,
      text
    });
  }
}
