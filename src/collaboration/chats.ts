import type { Db } from "../db.js";
import type { RunPaths } from "../paths.js";
import { writeChatExport } from "../storage.js";
import { newId, nowIso, toJson, fromJson } from "../utils.js";

interface ChatRow {
  chat_id: string;
  run_id: string;
  kind: string;
  title: string;
  participants: string;
  created_at: string;
}

interface ChatMessageRow {
  message_id: string;
  chat_id: string;
  sender: string;
  content: string;
  linked_artifacts: string;
  created_at: string;
}

export class ChatService {
  constructor(private readonly db: Db) {}

  createChat(runId: string, kind: "group" | "private", title: string, participants: string[]): string {
    const chatId = newId("chat");
    this.db.run(
      `INSERT INTO chats (chat_id, run_id, kind, title, participants, created_at)
       VALUES (:chat_id, :run_id, :kind, :title, :participants, :created_at)`,
      {
        chat_id: chatId,
        run_id: runId,
        kind,
        title,
        participants: toJson(participants),
        created_at: nowIso()
      }
    );

    return chatId;
  }

  addMessage(chatId: string, sender: string, content: string, linkedArtifacts: string[] = []): string {
    const messageId = newId("msg");
    this.db.run(
      `INSERT INTO chat_messages (message_id, chat_id, sender, content, linked_artifacts, created_at)
       VALUES (:message_id, :chat_id, :sender, :content, :linked_artifacts, :created_at)`,
      {
        message_id: messageId,
        chat_id: chatId,
        sender,
        content,
        linked_artifacts: toJson(linkedArtifacts),
        created_at: nowIso()
      }
    );

    return messageId;
  }

  listChats(runId: string): Array<{ chatId: string; kind: string; title: string; participants: string[]; createdAt: string }> {
    return this.db
      .all<ChatRow>(
        `SELECT chat_id, run_id, kind, title, participants, created_at
         FROM chats
         WHERE run_id = :run_id
         ORDER BY created_at ASC`,
        { run_id: runId }
      )
      .map((row) => ({
        chatId: row.chat_id,
        kind: row.kind,
        title: row.title,
        participants: fromJson<string[]>(row.participants),
        createdAt: row.created_at
      }));
  }

  viewChat(chatId: string): Array<{ sender: string; content: string; linkedArtifacts: string[]; createdAt: string }> {
    return this.db
      .all<ChatMessageRow>(
        `SELECT message_id, chat_id, sender, content, linked_artifacts, created_at
         FROM chat_messages
         WHERE chat_id = :chat_id
         ORDER BY created_at ASC`,
        { chat_id: chatId }
      )
      .map((row) => ({
        sender: row.sender,
        content: row.content,
        linkedArtifacts: fromJson<string[]>(row.linked_artifacts),
        createdAt: row.created_at
      }));
  }

  exportChat(chatId: string, runPaths: RunPaths): string {
    const messages = this.viewChat(chatId);
    const markdown = messages
      .map((item) => `- [${item.createdAt}] **${item.sender}**: ${item.content}`)
      .join("\n");

    return writeChatExport(runPaths, chatId, markdown);
  }
}
