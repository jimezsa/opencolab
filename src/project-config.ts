import fs from "node:fs";
import type { OpenColabConfig } from "./config.js";
import { getProviderSetupDefaults, isProviderName } from "./provider.js";
import type {
  AgentConfig,
  AgentFiles,
  OpenColabState,
  ProjectState,
  ProviderConfig,
  TelegramConfig
} from "./types.js";
import { nowIso, safeReadJson, writeJson } from "./utils.js";

const CURRENT_VERSION = 1 as const;
export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_AGENT_ID = "research_agent";

const DEFAULT_AGENT_FILES: AgentFiles = {
  agents: "AGENTS.md",
  identity: "IDENTITY.md",
  soul: "SOUL.md",
  tools: "TOOLS.md",
  user: "USER.md",
  memory: "MEMORY.md"
};

function cloneAgentFiles(source: AgentFiles): AgentFiles {
  return {
    agents: source.agents,
    identity: source.identity,
    soul: source.soul,
    tools: source.tools,
    user: source.user,
    memory: source.memory
  };
}

export function buildProjectPath(projectId: string): string {
  return `projects/${projectId}`;
}

export function buildAgentPath(projectId: string, agentId: string): string {
  return `${buildProjectPath(projectId)}/agents/${agentId}`;
}

export function createDefaultAgentConfig(projectId: string, agentId = DEFAULT_AGENT_ID): AgentConfig {
  return {
    id: agentId,
    path: buildAgentPath(projectId, agentId),
    files: cloneAgentFiles(DEFAULT_AGENT_FILES)
  };
}

export function createDefaultProjectState(projectId = DEFAULT_PROJECT_ID): ProjectState {
  const defaultAgent = createDefaultAgentConfig(projectId, DEFAULT_AGENT_ID);

  return {
    id: projectId,
    path: buildProjectPath(projectId),
    activeAgentId: defaultAgent.id,
    agents: {
      [defaultAgent.id]: defaultAgent
    },
    provider: {
      name: "codex",
      ...getProviderSetupDefaults("codex")
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

export function defaultProjectState(config: OpenColabConfig): OpenColabState {
  void config;
  const defaultProject = createDefaultProjectState(DEFAULT_PROJECT_ID);

  return {
    version: CURRENT_VERSION,
    updatedAt: nowIso(),
    activeProjectId: defaultProject.id,
    projects: {
      [defaultProject.id]: defaultProject
    }
  };
}

export function getProject(state: OpenColabState, projectId: string): ProjectState | null {
  return state.projects[projectId] ?? null;
}

export function getActiveProject(state: OpenColabState): ProjectState {
  const active = getProject(state, state.activeProjectId);
  if (active) {
    return active;
  }

  const first = Object.values(state.projects)[0];
  if (first) {
    return first;
  }

  return createDefaultProjectState(DEFAULT_PROJECT_ID);
}

export function getActiveAgent(project: ProjectState): AgentConfig {
  const active = project.agents[project.activeAgentId];
  if (active) {
    return active;
  }

  const first = Object.values(project.agents)[0];
  if (first) {
    return first;
  }

  return createDefaultAgentConfig(project.id, DEFAULT_AGENT_ID);
}

export function ensureProjectAndAgent(state: OpenColabState): OpenColabState {
  const projects = { ...state.projects };
  if (Object.keys(projects).length === 0) {
    const fallback = createDefaultProjectState(DEFAULT_PROJECT_ID);
    return {
      ...state,
      activeProjectId: fallback.id,
      projects: {
        [fallback.id]: fallback
      }
    };
  }

  const activeProjectId = projects[state.activeProjectId] ? state.activeProjectId : Object.keys(projects)[0];
  const activeProject = projects[activeProjectId];
  const hasAgents = Object.keys(activeProject.agents).length > 0;

  if (!hasAgents) {
    const fallbackAgent = createDefaultAgentConfig(activeProject.id, DEFAULT_AGENT_ID);
    projects[activeProjectId] = {
      ...activeProject,
      activeAgentId: fallbackAgent.id,
      agents: {
        [fallbackAgent.id]: fallbackAgent
      }
    };
    return {
      ...state,
      activeProjectId,
      projects
    };
  }

  if (activeProject.agents[activeProject.activeAgentId]) {
    return {
      ...state,
      activeProjectId
    };
  }

  const fallbackAgentId = Object.keys(activeProject.agents)[0];
  projects[activeProjectId] = {
    ...activeProject,
    activeAgentId: fallbackAgentId
  };

  return {
    ...state,
    activeProjectId,
    projects
  };
}

export function readProjectState(config: OpenColabConfig): OpenColabState {
  const defaults = defaultProjectState(config);

  if (!fs.existsSync(config.projectConfigPath)) {
    return defaults;
  }

  const raw = safeReadJson<unknown>(config.projectConfigPath, null);
  const normalized = normalizeState(raw, defaults);
  return ensureProjectAndAgent(normalized);
}

export function writeProjectState(config: OpenColabConfig, value: OpenColabState): void {
  const normalized = ensureProjectAndAgent(value);
  writeJson(config.projectConfigPath, {
    ...normalized,
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

  const sourceProjects = asRecord(source.projects);
  if (sourceProjects && Object.keys(sourceProjects).length > 0) {
    const projects: Record<string, ProjectState> = {};

    for (const [candidateId, value] of Object.entries(sourceProjects)) {
      const candidateSource = asRecord(value);
      const normalizedId = asString(candidateSource?.id, candidateId).trim();
      if (!normalizedId) {
        continue;
      }

      projects[normalizedId] = normalizeProject(normalizedId, candidateSource);
    }

    if (Object.keys(projects).length === 0) {
      return defaults;
    }

    const preferredActiveId = asString(source.activeProjectId, defaults.activeProjectId);
    const activeProjectId = projects[preferredActiveId] ? preferredActiveId : Object.keys(projects)[0];

    return {
      version: CURRENT_VERSION,
      updatedAt: asString(source.updatedAt, defaults.updatedAt),
      activeProjectId,
      projects
    };
  }

  return normalizeLegacyState(source, defaults);
}

function normalizeLegacyState(
  source: Record<string, unknown>,
  defaults: OpenColabState
): OpenColabState {
  const sourceAgent = asRecord(source.agent);
  const sourceAgentFiles = asRecord(sourceAgent?.files);
  const sourceProvider = asRecord(source.provider);
  const sourceTelegram = asRecord(source.telegram);

  const projectId = DEFAULT_PROJECT_ID;
  const projectDefaults = createDefaultProjectState(projectId);
  const agentId = asString(sourceAgent?.id, projectDefaults.activeAgentId);
  const agentPath = asString(sourceAgent?.path, buildAgentPath(projectId, agentId));

  const agent: AgentConfig = {
    id: agentId,
    path: agentPath,
    files: {
      agents: asString(sourceAgentFiles?.agents, DEFAULT_AGENT_FILES.agents),
      identity: asString(sourceAgentFiles?.identity, DEFAULT_AGENT_FILES.identity),
      soul: asString(sourceAgentFiles?.soul, DEFAULT_AGENT_FILES.soul),
      tools: asString(sourceAgentFiles?.tools, DEFAULT_AGENT_FILES.tools),
      user: asString(sourceAgentFiles?.user, DEFAULT_AGENT_FILES.user),
      memory: asString(sourceAgentFiles?.memory, DEFAULT_AGENT_FILES.memory)
    }
  };

  const project: ProjectState = {
    ...projectDefaults,
    activeAgentId: agent.id,
    agents: {
      [agent.id]: agent
    },
    provider: normalizeProvider(sourceProvider, projectDefaults.provider),
    telegram: normalizeTelegram(sourceTelegram, projectDefaults.telegram)
  };

  const normalized: OpenColabState = {
    version: CURRENT_VERSION,
    updatedAt: asString(source.updatedAt, defaults.updatedAt),
    activeProjectId: project.id,
    projects: {
      [project.id]: project
    }
  };

  return ensureProjectAndAgent(normalized);
}

function normalizeProject(projectId: string, source: Record<string, unknown> | null): ProjectState {
  const defaults = createDefaultProjectState(projectId);
  if (!source) {
    return defaults;
  }

  const sourceAgents = asRecord(source.agents);
  const normalizedAgents: Record<string, AgentConfig> = {};

  if (sourceAgents) {
    for (const [candidateAgentId, value] of Object.entries(sourceAgents)) {
      const candidate = asRecord(value);
      const agent = normalizeAgent(projectId, candidateAgentId, candidate);
      normalizedAgents[agent.id] = agent;
    }
  }

  if (Object.keys(normalizedAgents).length === 0) {
    const sourceAgent = asRecord(source.agent);
    if (sourceAgent) {
      const fallbackId = asString(sourceAgent.id, defaults.activeAgentId);
      const agent = normalizeAgent(projectId, fallbackId, sourceAgent);
      normalizedAgents[agent.id] = agent;
    }
  }

  if (Object.keys(normalizedAgents).length === 0) {
    const fallbackAgent = createDefaultAgentConfig(projectId);
    normalizedAgents[fallbackAgent.id] = fallbackAgent;
  }

  const candidateActiveAgentId = asString(source.activeAgentId, defaults.activeAgentId);
  const activeAgentId = normalizedAgents[candidateActiveAgentId]
    ? candidateActiveAgentId
    : Object.keys(normalizedAgents)[0];

  return {
    id: asString(source.id, projectId),
    path: asString(source.path, defaults.path),
    activeAgentId,
    agents: normalizedAgents,
    provider: normalizeProvider(asRecord(source.provider), defaults.provider),
    telegram: normalizeTelegram(asRecord(source.telegram), defaults.telegram)
  };
}

function normalizeAgent(
  projectId: string,
  fallbackAgentId: string,
  source: Record<string, unknown> | null
): AgentConfig {
  const id = asString(source?.id, fallbackAgentId);
  const sourceFiles = asRecord(source?.files);
  const defaults = createDefaultAgentConfig(projectId, id);

  return {
    id,
    path: asString(source?.path, defaults.path),
    files: {
      agents: asString(sourceFiles?.agents, defaults.files.agents),
      identity: asString(sourceFiles?.identity, defaults.files.identity),
      soul: asString(sourceFiles?.soul, defaults.files.soul),
      tools: asString(sourceFiles?.tools, defaults.files.tools),
      user: asString(sourceFiles?.user, defaults.files.user),
      memory: asString(sourceFiles?.memory, defaults.files.memory)
    }
  };
}

function normalizeProvider(
  sourceProvider: Record<string, unknown> | null,
  defaults: ProviderConfig
): ProviderConfig {
  const providerName = asProviderName(sourceProvider?.name, defaults.name);
  const providerDefaults = getProviderSetupDefaults(providerName);
  const cliArgs = Array.isArray(sourceProvider?.cliArgs)
    ? sourceProvider.cliArgs.map((item) => String(item))
    : providerDefaults.cliArgs;

  return {
    name: providerName,
    model: asString(sourceProvider?.model, providerDefaults.model),
    apiKeyEnvVar: asString(sourceProvider?.apiKeyEnvVar, providerDefaults.apiKeyEnvVar),
    cliCommand: asString(sourceProvider?.cliCommand, providerDefaults.cliCommand),
    cliArgs
  };
}

function normalizeTelegram(
  sourceTelegram: Record<string, unknown> | null,
  defaults: TelegramConfig
): TelegramConfig {
  return {
    botTokenEnvVar: asString(sourceTelegram?.botTokenEnvVar, defaults.botTokenEnvVar),
    chatId: asNullableString(sourceTelegram?.chatId),
    paired: Boolean(sourceTelegram?.paired),
    pairedAt: asNullableString(sourceTelegram?.pairedAt),
    pendingPairingCode: asNullableString(sourceTelegram?.pendingPairingCode),
    pendingPairingExpiresAt: asNullableString(sourceTelegram?.pendingPairingExpiresAt)
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

function asProviderName(value: unknown, fallback: ProviderConfig["name"]) {
  if (typeof value === "string" && isProviderName(value)) {
    return value;
  }
  return fallback;
}
