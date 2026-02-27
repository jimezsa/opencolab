import type { OpenColabConfig } from "./config.js";
import { getSetting, setSetting, type Db } from "./db.js";
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

  hasConfiguredChat(): boolean {
    return Boolean(this.config.telegramChatId);
  }

  isAllowedChat(chatId: string): boolean {
    if (!this.config.telegramChatId) {
      return false;
    }
    return String(this.config.telegramChatId) === String(chatId);
  }

  ensureThread(runId: string, chatId?: string): string | null {
    const resolvedChatId = this.resolveChatId(chatId);
    if (!resolvedChatId) {
      return null;
    }

    const existing = this.db.get<{ thread_id: string }>(
      `SELECT thread_id
       FROM telegram_threads
       WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
      {
        run_id: runId,
        telegram_chat_id: resolvedChatId
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
        telegram_chat_id: resolvedChatId,
        last_message_at: null,
        created_at: nowIso()
      }
    );
    return threadId;
  }

  getLatestRunForChat(chatId?: string): string | null {
    const resolvedChatId = this.resolveChatId(chatId);
    if (!resolvedChatId) {
      return null;
    }

    const row = this.db.get<{ run_id: string }>(
      `SELECT run_id
       FROM telegram_threads
       WHERE telegram_chat_id = :telegram_chat_id
         AND run_id IS NOT NULL
       ORDER BY COALESCE(last_message_at, created_at) DESC
       LIMIT 1`,
      {
        telegram_chat_id: resolvedChatId
      }
    );

    return row?.run_id ?? null;
  }

  activateRun(runId: string, chatId?: string): void {
    const resolvedChatId = this.resolveChatId(chatId);
    if (!resolvedChatId) {
      return;
    }

    this.ensureThread(runId, resolvedChatId);
    this.db.run(
      `UPDATE telegram_threads
       SET last_message_at = :last_message_at
       WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
      {
        run_id: runId,
        telegram_chat_id: resolvedChatId,
        last_message_at: nowIso()
      }
    );
  }

  getActiveAgent(chatId: string): string | null {
    return getSetting(this.db, this.activeAgentSettingKey(chatId));
  }

  setActiveAgent(chatId: string, agentId: string): void {
    setSetting(this.db, this.activeAgentSettingKey(chatId), agentId);
  }

  clearActiveAgent(chatId: string): void {
    this.db.run(`DELETE FROM settings WHERE key = :key`, {
      key: this.activeAgentSettingKey(chatId)
    });
  }

  async sendMessage(chatId: string, text: string, runId?: string): Promise<boolean> {
    const token = this.config.telegramBotToken;
    if (!token) {
      return false;
    }

    if (runId) {
      this.ensureThread(runId, chatId);
    }

    let ok = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text
        })
      });
      ok = response.ok;
    } catch {
      ok = false;
    }

    if (runId) {
      this.db.run(
        `UPDATE telegram_threads
         SET last_message_at = :last_message_at
         WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
        {
          run_id: runId,
          telegram_chat_id: chatId,
          last_message_at: nowIso()
        }
      );

      recordEvent(this.db, runId, "telegram.message", {
        direction: "outbound",
        ok,
        text
      });
    }

    return ok;
  }

  async sendRunUpdate(runId: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    return this.sendMessage(this.config.telegramChatId as string, text, runId);
  }

  recordInbound(runId: string, sender: string, text: string, chatId?: string): void {
    const resolvedChatId = this.resolveChatId(chatId);
    if (resolvedChatId) {
      this.ensureThread(runId, resolvedChatId);
      this.db.run(
        `UPDATE telegram_threads
         SET last_message_at = :last_message_at
         WHERE run_id = :run_id AND telegram_chat_id = :telegram_chat_id`,
        {
          run_id: runId,
          telegram_chat_id: resolvedChatId,
          last_message_at: nowIso()
        }
      );
    }

    recordEvent(this.db, runId, "telegram.message", {
      direction: "inbound",
      sender,
      text
    });
  }

  private resolveChatId(chatId?: string): string | null {
    if (chatId) {
      return chatId;
    }
    if (this.config.telegramChatId) {
      return String(this.config.telegramChatId);
    }
    return null;
  }

  private activeAgentSettingKey(chatId: string): string {
    return `telegram.active_agent.${chatId}`;
  }
}
