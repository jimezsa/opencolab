import fs from "node:fs";
import type { OpenColabConfig } from "./config.js";
import type { AgentFiles, OpenColabState } from "./types.js";
import { nowIso, safeReadJson, writeJson } from "./utils.js";

const CURRENT_VERSION = 1 as const;

export function defaultProjectState(config: OpenColabConfig): OpenColabState {
  const relativeAgentPath = "agents/research_agent";

  return {
    version: CURRENT_VERSION,
    updatedAt: nowIso(),
    agent: {
      id: "research_agent",
      path: relativeAgentPath,
      files: {
        agents: "AGENTS.md",
        identity: "IDENTITY.md",
        soul: "SOUL.md",
        tools: "TOOLS.md",
        user: "USER.md"
      }
    },
    provider: {
      name: "codex",
      model: "gpt-5",
      apiKeyEnvVar: "OPENAI_API_KEY",
      cliCommand: "codex",
      cliArgs: ["exec", "-"]
    },
    telegram: {
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      chatId: null,
      paired: false,
      pairedAt: null,
      pendingPairingCode: null,
      pendingPairingExpiresAt: null
    }
  };
}

export function readProjectState(config: OpenColabConfig): OpenColabState {
  const defaults = defaultProjectState(config);

  if (!fs.existsSync(config.projectConfigPath)) {
    return defaults;
  }

  const raw = safeReadJson<unknown>(config.projectConfigPath, null);
  return normalizeState(raw, defaults);
}

export function writeProjectState(config: OpenColabConfig, value: OpenColabState): void {
  writeJson(config.projectConfigPath, {
    ...value,
    version: CURRENT_VERSION,
    updatedAt: nowIso()
  });
}

export function updateProjectState(
  config: OpenColabConfig,
  updater: (current: OpenColabState) => OpenColabState
): OpenColabState {
  const current = readProjectState(config);
  const next = updater(current);
  writeProjectState(config, next);
  return readProjectState(config);
}

function normalizeState(raw: unknown, defaults: OpenColabState): OpenColabState {
  const source = asRecord(raw);
  if (!source) {
    return defaults;
  }

  const sourceAgent = asRecord(source.agent);
  const sourceAgentFiles = asRecord(sourceAgent?.files);
  const sourceProvider = asRecord(source.provider);
  const sourceTelegram = asRecord(source.telegram);

  const agentFiles: AgentFiles = {
    agents: asString(sourceAgentFiles?.agents, defaults.agent.files.agents),
    identity: asString(sourceAgentFiles?.identity, defaults.agent.files.identity),
    soul: asString(sourceAgentFiles?.soul, defaults.agent.files.soul),
    tools: asString(sourceAgentFiles?.tools, defaults.agent.files.tools),
    user: asString(sourceAgentFiles?.user, defaults.agent.files.user)
  };

  const cliArgs = Array.isArray(sourceProvider?.cliArgs)
    ? sourceProvider.cliArgs.map((item) => String(item))
    : defaults.provider.cliArgs;

  return {
    version: CURRENT_VERSION,
    updatedAt: asString(source.updatedAt, defaults.updatedAt),
    agent: {
      id: asString(sourceAgent?.id, defaults.agent.id),
      path: asString(sourceAgent?.path, defaults.agent.path),
      files: agentFiles
    },
    provider: {
      name: "codex",
      model: asString(sourceProvider?.model, defaults.provider.model),
      apiKeyEnvVar: asString(sourceProvider?.apiKeyEnvVar, defaults.provider.apiKeyEnvVar),
      cliCommand: asString(sourceProvider?.cliCommand, defaults.provider.cliCommand),
      cliArgs
    },
    telegram: {
      botTokenEnvVar: asString(sourceTelegram?.botTokenEnvVar, defaults.telegram.botTokenEnvVar),
      chatId: asNullableString(sourceTelegram?.chatId),
      paired: Boolean(sourceTelegram?.paired),
      pairedAt: asNullableString(sourceTelegram?.pairedAt),
      pendingPairingCode: asNullableString(sourceTelegram?.pendingPairingCode),
      pendingPairingExpiresAt: asNullableString(sourceTelegram?.pendingPairingExpiresAt)
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}
