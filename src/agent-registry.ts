import path from "node:path";
import type { OpenColabConfig } from "./config.js";
import { Db } from "./db.js";
import type { AgentInstance, AgentRole, AgentTemplate } from "./types.js";
import { fromJson, newId, nowIso, splitArgs, toJson } from "./utils.js";

interface AgentTemplateRow {
  template_id: string;
  provider: string;
  cli_command: string;
  default_args: string;
  default_env: string;
}

interface AgentInstanceRow {
  agent_id: string;
  template_id: string;
  role: AgentRole;
  workspace_path: string;
  max_runtime_sec: number;
  retry_limit: number;
  isolation_mode: "host" | "docker";
  enabled: 0 | 1;
}

export class AgentRegistry {
  constructor(
    private readonly db: Db,
    private readonly config: OpenColabConfig
  ) {}

  ensureDefaults(): void {
    const defaults: AgentTemplate[] = [
      {
        templateId: "tpl_codex",
        provider: "openai",
        cliCommand: "codex",
        defaultArgs: [],
        defaultEnv: {}
      },
      {
        templateId: "tpl_claude_code",
        provider: "anthropic",
        cliCommand: "claude_code",
        defaultArgs: [],
        defaultEnv: {}
      },
      {
        templateId: "tpl_gemini",
        provider: "google",
        cliCommand: "gemini",
        defaultArgs: [],
        defaultEnv: {}
      }
    ];

    for (const template of defaults) {
      this.createTemplate(template);
    }

    const workspaceBase = path.join(this.config.rootDir, "projects", "_default", "agents");
    const instances: AgentInstance[] = [
      {
        agentId: "professor_codex",
        templateId: "tpl_codex",
        role: "professor",
        workspacePath: path.join(workspaceBase, "professor_codex"),
        maxRuntimeSec: 300,
        retryLimit: 1,
        isolationMode: "host",
        enabled: true
      },
      {
        agentId: "student_claude_1",
        templateId: "tpl_claude_code",
        role: "student",
        workspacePath: path.join(workspaceBase, "student_claude_1"),
        maxRuntimeSec: 300,
        retryLimit: 1,
        isolationMode: "host",
        enabled: true
      },
      {
        agentId: "student_codex_1",
        templateId: "tpl_codex",
        role: "student",
        workspacePath: path.join(workspaceBase, "student_codex_1"),
        maxRuntimeSec: 300,
        retryLimit: 1,
        isolationMode: "host",
        enabled: true
      },
      {
        agentId: "student_gemini_1",
        templateId: "tpl_gemini",
        role: "student",
        workspacePath: path.join(workspaceBase, "student_gemini_1"),
        maxRuntimeSec: 300,
        retryLimit: 1,
        isolationMode: "host",
        enabled: true
      }
    ];

    for (const instance of instances) {
      this.createInstance(instance);
    }
  }

  createTemplate(input: AgentTemplate): void {
    this.db.run(
      `INSERT INTO agent_templates (template_id, provider, cli_command, default_args, default_env, created_at)
       VALUES (:template_id, :provider, :cli_command, :default_args, :default_env, :created_at)
       ON CONFLICT(template_id) DO UPDATE SET
         provider = excluded.provider,
         cli_command = excluded.cli_command,
         default_args = excluded.default_args,
         default_env = excluded.default_env`,
      {
        template_id: input.templateId,
        provider: input.provider,
        cli_command: input.cliCommand,
        default_args: toJson(input.defaultArgs),
        default_env: toJson(input.defaultEnv),
        created_at: nowIso()
      }
    );
  }

  createInstance(input: AgentInstance): string {
    const agentId = input.agentId || newId("agent");

    this.db.run(
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
        agent_id: agentId,
        template_id: input.templateId,
        role: input.role,
        workspace_path: input.workspacePath,
        max_runtime_sec: input.maxRuntimeSec,
        retry_limit: input.retryLimit,
        isolation_mode: input.isolationMode,
        enabled: input.enabled ? 1 : 0,
        created_at: nowIso()
      }
    );

    return agentId;
  }

  listTemplates(): AgentTemplate[] {
    return this.db.all<AgentTemplateRow>(
      `SELECT template_id, provider, cli_command, default_args, default_env
       FROM agent_templates
       ORDER BY template_id`
    ).map((row) => ({
      templateId: row.template_id,
      provider: row.provider as AgentTemplate["provider"],
      cliCommand: row.cli_command,
      defaultArgs: splitArgs(row.default_args),
      defaultEnv: fromJson<Record<string, string>>(row.default_env)
    }));
  }

  getTemplate(templateId: string): AgentTemplate | undefined {
    const row = this.db.get<AgentTemplateRow>(
      `SELECT template_id, provider, cli_command, default_args, default_env
       FROM agent_templates
       WHERE template_id = :template_id`,
      { template_id: templateId }
    );

    if (!row) {
      return undefined;
    }

    return {
      templateId: row.template_id,
      provider: row.provider as AgentTemplate["provider"],
      cliCommand: row.cli_command,
      defaultArgs: splitArgs(row.default_args),
      defaultEnv: fromJson<Record<string, string>>(row.default_env)
    };
  }

  listInstances(role?: AgentRole): AgentInstance[] {
    const rows = this.db.all<AgentInstanceRow>(
      `SELECT agent_id, template_id, role, workspace_path,
              max_runtime_sec, retry_limit, isolation_mode, enabled
       FROM agent_instances
       WHERE (:role IS NULL OR role = :role)
       ORDER BY agent_id`,
      { role: role ?? null }
    );

    return rows.map((row) => ({
      agentId: row.agent_id,
      templateId: row.template_id,
      role: row.role,
      workspacePath: row.workspace_path,
      maxRuntimeSec: row.max_runtime_sec,
      retryLimit: row.retry_limit,
      isolationMode: row.isolation_mode,
      enabled: row.enabled === 1
    }));
  }

  getInstance(agentId: string): AgentInstance | undefined {
    const row = this.db.get<AgentInstanceRow>(
      `SELECT agent_id, template_id, role, workspace_path,
              max_runtime_sec, retry_limit, isolation_mode, enabled
       FROM agent_instances
       WHERE agent_id = :agent_id`,
      { agent_id: agentId }
    );

    if (!row) {
      return undefined;
    }

    return {
      agentId: row.agent_id,
      templateId: row.template_id,
      role: row.role,
      workspacePath: row.workspace_path,
      maxRuntimeSec: row.max_runtime_sec,
      retryLimit: row.retry_limit,
      isolationMode: row.isolation_mode,
      enabled: row.enabled === 1
    };
  }
}
