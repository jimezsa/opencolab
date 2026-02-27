import fs from "node:fs";
import type { OpenColabConfig } from "./config.js";
import type { Db } from "./db.js";
import type { AgentInstance, AgentTemplate } from "./types.js";
import { nowIso, splitArgs, toJson } from "./utils.js";

export interface ProjectConfiguration {
  version: 1;
  updatedAt: string;
  settings: Record<string, string>;
  agentTemplates: AgentTemplate[];
  agentInstances: AgentInstance[];
}

interface AgentTemplateRow {
  template_id: string;
  provider: "openai" | "anthropic" | "google";
  cli_command: string;
  default_args: string;
  default_env: string;
}

interface AgentInstanceRow {
  agent_id: string;
  template_id: string;
  role: "professor" | "student" | "reviewer";
  workspace_path: string;
  max_runtime_sec: number;
  retry_limit: number;
  isolation_mode: "host" | "docker";
  enabled: 0 | 1;
}

const PROJECT_CONFIG_VERSION = 1 as const;

const MIGRATED_SETTING_KEYS = ["opencolab.force_mock_cli", "telegram.bot_token", "telegram.chat_id"];

export function ensureProjectConfiguration(config: OpenColabConfig, db: Db): ProjectConfiguration {
  const existing = readProjectConfiguration(config);
  if (existing) {
    syncDbAgentConfiguration(db, existing);
    return existing;
  }

  const fromDb = exportProjectConfigurationFromDb(db);
  writeProjectConfiguration(config, fromDb);
  return fromDb;
}

export function readProjectConfiguration(config: OpenColabConfig): ProjectConfiguration | null {
  if (!fs.existsSync(config.projectConfigPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(config.projectConfigPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectConfiguration>;
    return normalizeProjectConfiguration(parsed);
  } catch {
    return null;
  }
}

export function writeProjectConfiguration(config: OpenColabConfig, value: ProjectConfiguration): void {
  fs.writeFileSync(config.projectConfigPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function getProjectSetting(config: OpenColabConfig, key: string): string | null {
  const current = readProjectConfiguration(config);
  return current?.settings[key] ?? null;
}

export function setProjectSetting(config: OpenColabConfig, key: string, value: string): void {
  const current = readProjectConfiguration(config) ?? defaultProjectConfiguration();
  current.settings[key] = value;
  current.updatedAt = nowIso();
  writeProjectConfiguration(config, current);
}

export function persistProjectConfigurationFromDb(config: OpenColabConfig, db: Db): void {
  const current = readProjectConfiguration(config);
  const exported = exportProjectConfigurationFromDb(db);

  const next: ProjectConfiguration = {
    ...exported,
    settings: current?.settings ?? exported.settings,
    updatedAt: nowIso()
  };

  writeProjectConfiguration(config, next);
}

function exportProjectConfigurationFromDb(db: Db): ProjectConfiguration {
  const settingsRows = db.all<{ key: string; value: string }>(
    `SELECT key, value
     FROM settings
     WHERE key IN (${MIGRATED_SETTING_KEYS.map((key) => `'${key}'`).join(",")})
     ORDER BY key`
  );

  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  const templates = db
    .all<AgentTemplateRow>(
      `SELECT template_id, provider, cli_command, default_args, default_env
       FROM agent_templates
       ORDER BY template_id`
    )
    .map((row) => ({
      templateId: row.template_id,
      provider: row.provider,
      cliCommand: row.cli_command,
      defaultArgs: splitArgs(row.default_args),
      defaultEnv: parseEnv(row.default_env)
    }));

  const instances = db
    .all<AgentInstanceRow>(
      `SELECT agent_id, template_id, role, workspace_path, max_runtime_sec, retry_limit, isolation_mode, enabled
       FROM agent_instances
       ORDER BY agent_id`
    )
    .map((row) => ({
      agentId: row.agent_id,
      templateId: row.template_id,
      role: row.role,
      workspacePath: row.workspace_path,
      maxRuntimeSec: row.max_runtime_sec,
      retryLimit: row.retry_limit,
      isolationMode: row.isolation_mode,
      enabled: row.enabled === 1
    }));

  return {
    version: PROJECT_CONFIG_VERSION,
    updatedAt: nowIso(),
    settings,
    agentTemplates: templates,
    agentInstances: instances
  };
}

function syncDbAgentConfiguration(db: Db, value: ProjectConfiguration): void {
  const now = nowIso();

  for (const template of value.agentTemplates) {
    db.run(
      `INSERT INTO agent_templates (template_id, provider, cli_command, default_args, default_env, created_at)
       VALUES (:template_id, :provider, :cli_command, :default_args, :default_env, :created_at)
       ON CONFLICT(template_id) DO UPDATE SET
         provider = excluded.provider,
         cli_command = excluded.cli_command,
         default_args = excluded.default_args,
         default_env = excluded.default_env`,
      {
        template_id: template.templateId,
        provider: template.provider,
        cli_command: template.cliCommand,
        default_args: toJson(template.defaultArgs),
        default_env: toJson(template.defaultEnv),
        created_at: now
      }
    );
  }

  for (const instance of value.agentInstances) {
    db.run(
      `INSERT INTO agent_instances (
          agent_id, template_id, role, workspace_path,
          max_runtime_sec, retry_limit, isolation_mode, enabled, created_at
       ) VALUES (
          :agent_id, :template_id, :role, :workspace_path,
          :max_runtime_sec, :retry_limit, :isolation_mode, :enabled, :created_at
       )
       ON CONFLICT(agent_id) DO UPDATE SET
         template_id = excluded.template_id,
         role = excluded.role,
         workspace_path = excluded.workspace_path,
         max_runtime_sec = excluded.max_runtime_sec,
         retry_limit = excluded.retry_limit,
         isolation_mode = excluded.isolation_mode,
         enabled = excluded.enabled`,
      {
        agent_id: instance.agentId,
        template_id: instance.templateId,
        role: instance.role,
        workspace_path: instance.workspacePath,
        max_runtime_sec: instance.maxRuntimeSec,
        retry_limit: instance.retryLimit,
        isolation_mode: instance.isolationMode,
        enabled: instance.enabled ? 1 : 0,
        created_at: now
      }
    );
  }
}

function defaultProjectConfiguration(): ProjectConfiguration {
  return {
    version: PROJECT_CONFIG_VERSION,
    updatedAt: nowIso(),
    settings: {},
    agentTemplates: [],
    agentInstances: []
  };
}

function normalizeProjectConfiguration(value: Partial<ProjectConfiguration>): ProjectConfiguration {
  return {
    version: PROJECT_CONFIG_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    settings: value.settings ?? {},
    agentTemplates: Array.isArray(value.agentTemplates) ? value.agentTemplates : [],
    agentInstances: Array.isArray(value.agentInstances) ? value.agentInstances : []
  };
}

function parseEnv(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}
