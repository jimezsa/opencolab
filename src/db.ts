import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { OpenColabConfig } from "./config.js";
import { nowIso } from "./utils.js";

export class Db {
  readonly sqlite: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new DatabaseSync(dbPath);
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
  }

  exec(sql: string): void {
    this.sqlite.exec(sql);
  }

  run(sql: string, params: Record<string, SQLInputValue> = {}): void {
    this.sqlite.prepare(sql).run(params);
  }

  get<T>(sql: string, params: Record<string, SQLInputValue> = {}): T | undefined {
    return this.sqlite.prepare(sql).get(params) as T | undefined;
  }

  all<T>(sql: string, params: Record<string, SQLInputValue> = {}): T[] {
    return this.sqlite.prepare(sql).all(params) as T[];
  }

  close(): void {
    this.sqlite.close();
  }
}

export function openDb(config: OpenColabConfig): Db {
  const db = new Db(config.dbPath);
  initSchema(db);
  return db;
}

export function initSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_templates (
      template_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      cli_command TEXT NOT NULL,
      default_args TEXT NOT NULL,
      default_env TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
      agent_id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES agent_templates(template_id),
      role TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      max_runtime_sec INTEGER NOT NULL,
      retry_limit INTEGER NOT NULL,
      isolation_mode TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL REFERENCES projects(project_name),
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewer_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      agent_id TEXT REFERENCES agent_instances(agent_id),
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      retries INTEGER NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      stdout_path TEXT,
      stderr_path TEXT,
      output_files TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      participants TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(chat_id),
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      linked_artifacts TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meetings (
      meeting_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      meeting_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      task_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_threads (
      thread_id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(run_id),
      telegram_chat_id TEXT NOT NULL,
      last_message_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      repository_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL REFERENCES projects(project_name),
      owner_type TEXT NOT NULL,
      owner_id TEXT,
      repo_name TEXT NOT NULL,
      repo_url TEXT,
      local_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_drafts (
      paper_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL REFERENCES projects(project_name),
      run_id TEXT REFERENCES runs(run_id),
      title TEXT NOT NULL,
      latex_main_path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      skill_name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      description TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_skill_bindings (
      binding_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agent_instances(agent_id),
      skill_name TEXT NOT NULL REFERENCES skills(skill_name),
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, skill_name)
    );
  `);
}

export function upsertProject(db: Db, projectName: string): void {
  const now = nowIso();
  db.run(
    `INSERT INTO projects (project_name, created_at)
     VALUES (:project_name, :created_at)
     ON CONFLICT(project_name) DO NOTHING`,
    {
      project_name: projectName,
      created_at: now
    }
  );
}
