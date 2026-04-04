/**
 * OpenColab state schema helpers.
 * Provides defaults, normalization/migration, and opencolab.json read/write utilities.
 */
import fs from "node:fs";
import type { OpenColabConfig } from "./config.js";
import {
  normalizeProviderReasoningEffort,
  getProviderSetupDefaults,
  normalizeProviderName,
  resolveProviderAuthMode,
  usesLegacyProviderCliDefaults
} from "./provider.js";
import type {
  AgentConfig,
  AgentFiles,
  ExecutionTargetConfig,
  OpenColabState,
  ProjectState,
  ProviderConfig,
  TelegramConfig
} from "./types.js";
import { nowIso, safeReadJson, writeJson } from "./utils.js";

const CURRENT_VERSION = 1 as const;
export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_AGENT_ID = "professor";
export const DEFAULT_RUNPOD_IMAGE = "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04";

const DEFAULT_AGENT_FILES: AgentFiles = {
  agents: "AGENTS.md",
  bootstrap: "BOOTSTRAP.md",
  identity: "IDENTITY.md",
  alma: "ALMA.md",
  tools: "TOOLS.md",
  user: "USER.md",
  todo: "TODO.md",
  memory: "MEMORY.md"
};

function cloneAgentFiles(source: AgentFiles): AgentFiles {
  return {
    agents: source.agents,
    bootstrap: source.bootstrap,
    identity: source.identity,
    alma: source.alma,
    tools: source.tools,
    user: source.user,
    todo: source.todo,
    memory: source.memory
  };
}

function cloneProviderConfig(source: ProviderConfig): ProviderConfig {
  return {
    name: source.name,
    model: source.model,
    runtime: source.runtime,
    cliCommand: source.cliCommand,
    cliArgs: [...source.cliArgs],
    authMode: source.authMode,
    reasoningEffort: source.reasoningEffort
  };
}

function cloneExecutionTargetConfig(source: ExecutionTargetConfig): ExecutionTargetConfig {
  return {
    id: source.id,
    backend: source.backend,
    enabled: source.enabled,
    datacenterId: source.datacenterId,
    preferredDatacenterIds: [...source.preferredDatacenterIds],
    cloudType: source.cloudType,
    gpuType: source.gpuType,
    preferredGpuTypes: [...source.preferredGpuTypes],
    gpuCount: source.gpuCount,
    templateId: source.templateId,
    imageName: source.imageName,
    volume: {
      mode: source.volume.mode,
      id: source.volume.id,
      name: source.volume.name,
      sizeGb: source.volume.sizeGb
    },
    ssh: {
      mode: source.ssh.mode,
      user: source.ssh.user,
      port: source.ssh.port,
      privateKeyPath: source.ssh.privateKeyPath
    },
    workspaceRoot: source.workspaceRoot,
    bootstrapProfile: source.bootstrapProfile,
    maxRuntimeMinutes: source.maxRuntimeMinutes,
    idleStopMinutes: source.idleStopMinutes,
    autoStopPolicy: source.autoStopPolicy,
    maxEstimatedCostUsd: source.maxEstimatedCostUsd
  };
}

export function buildProjectPath(projectId: string): string {
  return `projects/${projectId}`;
}

export function buildAgentsPath(projectId: string): string {
  return `${buildProjectPath(projectId)}/AGENTS`;
}

export function buildAgentPath(projectId: string, agentId: string): string {
  return `${buildAgentsPath(projectId)}/${agentId}`;
}

export function createDefaultProviderConfig(providerName: ProviderConfig["name"] = "anthropic"): ProviderConfig {
  const providerDefaults = getProviderSetupDefaults(providerName);
  return {
    name: providerName,
    model: providerDefaults.model,
    runtime: providerDefaults.runtime,
    cliCommand: providerDefaults.cliCommand,
    cliArgs: [...providerDefaults.cliArgs],
    authMode: providerDefaults.authMode
  };
}

export function createDefaultExecutionTargetConfig(targetId: string): ExecutionTargetConfig {
  return {
    id: targetId,
    backend: "runpod",
    enabled: true,
    datacenterId: "US-KS-2",
    preferredDatacenterIds: ["US-KS-2"],
    cloudType: "secure",
    gpuType: "NVIDIA A100 80GB PCIe",
    preferredGpuTypes: ["NVIDIA A100 80GB PCIe"],
    gpuCount: 1,
    templateId: null,
    imageName: DEFAULT_RUNPOD_IMAGE,
    volume: {
      mode: "network_volume",
      id: null,
      name: `${targetId}-volume`,
      sizeGb: 200
    },
    ssh: {
      mode: "public_ip",
      user: "root",
      port: null,
      privateKeyPath: null
    },
    workspaceRoot: "/workspace",
    bootstrapProfile: "pytorch-cu12",
    maxRuntimeMinutes: 360,
    idleStopMinutes: 15,
    autoStopPolicy: "keep_warm",
    maxEstimatedCostUsd: null
  };
}

export function createDefaultAgentConfig(
  projectId: string,
  agentId = DEFAULT_AGENT_ID,
  provider = createDefaultProviderConfig("anthropic")
): AgentConfig {
  return {
    id: agentId,
    path: buildAgentPath(projectId, agentId),
    files: cloneAgentFiles(DEFAULT_AGENT_FILES),
    provider: cloneProviderConfig(provider)
  };
}

export function createDefaultProjectState(projectId = DEFAULT_PROJECT_ID): ProjectState {
  const defaultAgent = createDefaultAgentConfig(projectId, DEFAULT_AGENT_ID);

  return {
    id: projectId,
    path: buildProjectPath(projectId),
    activeAgentId: defaultAgent.id,
    executionTargets: {},
    agents: {
      [defaultAgent.id]: defaultAgent
    }
  };
}

export function createDefaultTelegramConfig(): TelegramConfig {
  return {
    chatId: null,
    paired: false,
    pairedAt: null,
    pendingPairingCode: null,
    pendingPairingExpiresAt: null
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
    },
    telegram: createDefaultTelegramConfig()
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
  const telegram = normalizeTelegram(
    asRecord((state as unknown as Record<string, unknown>).telegram),
    createDefaultTelegramConfig()
  );
  const projects = { ...state.projects };
  if (Object.keys(projects).length === 0) {
    const fallback = createDefaultProjectState(DEFAULT_PROJECT_ID);
    return {
      ...state,
      activeProjectId: fallback.id,
      projects: {
        [fallback.id]: fallback
      },
      telegram
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
      projects,
      telegram
    };
  }

  if (activeProject.agents[activeProject.activeAgentId]) {
    return {
      ...state,
      activeProjectId,
      telegram
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
    projects,
    telegram
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
    const telegram = normalizeSharedTelegram(source, sourceProjects, activeProjectId, defaults.telegram);

    return {
      version: CURRENT_VERSION,
      updatedAt: asString(source.updatedAt, defaults.updatedAt),
      activeProjectId,
      projects,
      telegram
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
  const fallbackProvider = normalizeProvider(sourceProvider, createDefaultProviderConfig("anthropic"));
  const agentId = asString(sourceAgent?.id, projectDefaults.activeAgentId);
  const agentPath = asString(sourceAgent?.path, buildAgentPath(projectId, agentId));

  const agent: AgentConfig = {
    id: agentId,
    path: agentPath,
    files: {
      agents: asString(sourceAgentFiles?.agents, DEFAULT_AGENT_FILES.agents),
      bootstrap: asString(sourceAgentFiles?.bootstrap, DEFAULT_AGENT_FILES.bootstrap),
      identity: asString(sourceAgentFiles?.identity, DEFAULT_AGENT_FILES.identity),
      alma: asString(sourceAgentFiles?.alma, DEFAULT_AGENT_FILES.alma),
      tools: asString(sourceAgentFiles?.tools, DEFAULT_AGENT_FILES.tools),
      user: asString(sourceAgentFiles?.user, DEFAULT_AGENT_FILES.user),
      todo: asString(sourceAgentFiles?.todo, DEFAULT_AGENT_FILES.todo),
      memory: asString(sourceAgentFiles?.memory, DEFAULT_AGENT_FILES.memory)
    },
    provider: fallbackProvider
  };

  const project: ProjectState = {
    ...projectDefaults,
    activeAgentId: agent.id,
    agents: {
      [agent.id]: agent
    }
  };

  const normalized: OpenColabState = {
    version: CURRENT_VERSION,
    updatedAt: asString(source.updatedAt, defaults.updatedAt),
    activeProjectId: project.id,
    projects: {
      [project.id]: project
    },
    telegram: normalizeTelegram(sourceTelegram, defaults.telegram)
  };

  return ensureProjectAndAgent(normalized);
}

function normalizeProject(projectId: string, source: Record<string, unknown> | null): ProjectState {
  const defaults = createDefaultProjectState(projectId);
  if (!source) {
    return defaults;
  }

  const legacyProjectProvider = normalizeProvider(
    asRecord(source.provider),
    createDefaultProviderConfig("anthropic")
  );

  const sourceAgents = asRecord(source.agents);
  const normalizedAgents: Record<string, AgentConfig> = {};

  if (sourceAgents) {
    for (const [candidateAgentId, value] of Object.entries(sourceAgents)) {
      const candidate = asRecord(value);
      const agent = normalizeAgent(projectId, candidateAgentId, candidate, legacyProjectProvider);
      normalizedAgents[agent.id] = agent;
    }
  }

  if (Object.keys(normalizedAgents).length === 0) {
    const sourceAgent = asRecord(source.agent);
    if (sourceAgent) {
      const fallbackId = asString(sourceAgent.id, defaults.activeAgentId);
      const agent = normalizeAgent(projectId, fallbackId, sourceAgent, legacyProjectProvider);
      normalizedAgents[agent.id] = agent;
    }
  }

  if (Object.keys(normalizedAgents).length === 0) {
    const fallbackAgent = createDefaultAgentConfig(projectId, DEFAULT_AGENT_ID, legacyProjectProvider);
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
    executionTargets: normalizeExecutionTargets(
      projectId,
      asRecord(source.executionTargets)
    ),
    agents: normalizedAgents
  };
}

function normalizeExecutionTargets(
  projectId: string,
  sourceTargets: Record<string, unknown> | null
): Record<string, ExecutionTargetConfig> {
  if (!sourceTargets) {
    return {};
  }

  const normalizedTargets: Record<string, ExecutionTargetConfig> = {};
  for (const [candidateId, value] of Object.entries(sourceTargets)) {
    const normalizedId = asString(asRecord(value)?.id, candidateId).trim();
    if (!normalizedId) {
      continue;
    }
    normalizedTargets[normalizedId] = normalizeExecutionTarget(
      projectId,
      normalizedId,
      asRecord(value)
    );
  }
  return normalizedTargets;
}

function normalizeExecutionTarget(
  projectId: string,
  targetId: string,
  source: Record<string, unknown> | null
): ExecutionTargetConfig {
  void projectId;
  const defaults = createDefaultExecutionTargetConfig(targetId);
  const sourceVolume = asRecord(source?.volume);
  const sourceSsh = asRecord(source?.ssh);
  const preferredDatacenterIds = normalizeOrderedStrings(
    asStringArray(source?.preferredDatacenterIds),
    asNullableString(source?.datacenterId) ?? defaults.datacenterId
  );
  const preferredGpuTypes = normalizeOrderedStrings(
    asStringArray(source?.preferredGpuTypes),
    asNullableString(source?.gpuType) ?? defaults.gpuType
  );
  return {
    id: asString(source?.id, defaults.id),
    backend: "runpod",
    enabled: asBoolean(source?.enabled, defaults.enabled),
    datacenterId: preferredDatacenterIds[0] ?? defaults.datacenterId,
    preferredDatacenterIds,
    cloudType: "secure",
    gpuType: preferredGpuTypes[0] ?? defaults.gpuType,
    preferredGpuTypes,
    gpuCount: asPositiveInteger(source?.gpuCount, defaults.gpuCount),
    templateId: asNullableString(source?.templateId),
    imageName: asNullableString(source?.imageName) ?? defaults.imageName,
    volume: {
      mode: "network_volume",
      id: asNullableString(sourceVolume?.id),
      name: asString(sourceVolume?.name, defaults.volume.name),
      sizeGb: asPositiveInteger(sourceVolume?.sizeGb, defaults.volume.sizeGb)
    },
    ssh: {
      mode: "public_ip",
      user: asNullableString(sourceSsh?.user) ?? defaults.ssh.user,
      port: asNullableInteger(sourceSsh?.port),
      privateKeyPath: asNullableString(sourceSsh?.privateKeyPath)
    },
    workspaceRoot: asString(source?.workspaceRoot, defaults.workspaceRoot),
    bootstrapProfile: asBootstrapProfile(source?.bootstrapProfile, defaults.bootstrapProfile),
    maxRuntimeMinutes: asPositiveInteger(source?.maxRuntimeMinutes, defaults.maxRuntimeMinutes),
    idleStopMinutes: asNullableInteger(source?.idleStopMinutes),
    autoStopPolicy: asAutoStopPolicy(source?.autoStopPolicy, defaults.autoStopPolicy),
    maxEstimatedCostUsd: asNullableNumber(source?.maxEstimatedCostUsd)
  };
}

function normalizeAgent(
  projectId: string,
  fallbackAgentId: string,
  source: Record<string, unknown> | null,
  fallbackProvider: ProviderConfig
): AgentConfig {
  const id = asString(source?.id, fallbackAgentId);
  const sourceFiles = asRecord(source?.files);
  const defaults = createDefaultAgentConfig(projectId, id, fallbackProvider);

  return {
    id,
    path: asString(source?.path, defaults.path),
    files: {
      agents: asString(sourceFiles?.agents, defaults.files.agents),
      bootstrap: asString(sourceFiles?.bootstrap, defaults.files.bootstrap),
      identity: asString(sourceFiles?.identity, defaults.files.identity),
      alma: asString(sourceFiles?.alma, defaults.files.alma),
      tools: asString(sourceFiles?.tools, defaults.files.tools),
      user: asString(sourceFiles?.user, defaults.files.user),
      todo: asString(sourceFiles?.todo, defaults.files.todo),
      memory: asString(sourceFiles?.memory, defaults.files.memory)
    },
    provider: normalizeProvider(asRecord(source?.provider), fallbackProvider)
  };
}

function normalizeProvider(
  sourceProvider: Record<string, unknown> | null,
  defaults: ProviderConfig
): ProviderConfig {
  const providerName = asProviderName(sourceProvider?.name, defaults.name);
  const providerDefaults = getProviderSetupDefaults(providerName);
  const cliCommand = asString(sourceProvider?.cliCommand, providerDefaults.cliCommand);
  const cliArgs = Array.isArray(sourceProvider?.cliArgs)
    ? sourceProvider.cliArgs.map((item) => String(item))
    : providerDefaults.cliArgs;
  const shouldMigrateLegacyDefaults = usesLegacyProviderCliDefaults(providerName, cliCommand, cliArgs);
  const authMode = resolveProviderAuthMode(
    providerName,
    asNullableString(sourceProvider?.authMode),
    defaults.authMode
  );
  const model = asString(sourceProvider?.model, providerDefaults.model);
  const reasoningEffort = normalizeProviderReasoningEffort(
    providerName,
    model,
    asNullableString(sourceProvider?.reasoningEffort)
  );

  return {
    name: providerName,
    model,
    runtime: providerDefaults.runtime,
    cliCommand: shouldMigrateLegacyDefaults ? providerDefaults.cliCommand : cliCommand,
    cliArgs: shouldMigrateLegacyDefaults ? providerDefaults.cliArgs : cliArgs,
    authMode,
    reasoningEffort: reasoningEffort ?? undefined
  };
}

function normalizeSharedTelegram(
  sourceState: Record<string, unknown>,
  sourceProjects: Record<string, unknown>,
  activeProjectId: string,
  defaults: TelegramConfig
): TelegramConfig {
  const topLevelTelegram = asRecord(sourceState.telegram);
  if (topLevelTelegram) {
    return normalizeTelegram(topLevelTelegram, defaults);
  }

  const preferredProject = asRecord(sourceProjects[activeProjectId]);
  const preferredProjectTelegram = asRecord(preferredProject?.telegram);
  if (preferredProjectTelegram) {
    return normalizeTelegram(preferredProjectTelegram, defaults);
  }

  for (const value of Object.values(sourceProjects)) {
    const project = asRecord(value);
    const legacyTelegram = asRecord(project?.telegram);
    if (legacyTelegram) {
      return normalizeTelegram(legacyTelegram, defaults);
    }
  }

  return defaults;
}

function normalizeTelegram(
  sourceTelegram: Record<string, unknown> | null,
  defaults: TelegramConfig
): TelegramConfig {
  return {
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

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function normalizeOrderedStrings(values: string[] | null, fallback: string): string[] {
  const ordered = new Set<string>();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (normalized) {
      ordered.add(normalized);
    }
  }
  if (ordered.size === 0) {
    const fallbackValue = fallback.trim();
    if (fallbackValue) {
      ordered.add(fallbackValue);
    }
  }
  return [...ordered];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function asNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asBootstrapProfile(
  value: unknown,
  fallback: ExecutionTargetConfig["bootstrapProfile"]
): ExecutionTargetConfig["bootstrapProfile"] {
  if (value === "python-ml" || value === "pytorch-cu12" || value === "minimal-shell") {
    return value;
  }
  return fallback;
}

function asAutoStopPolicy(
  value: unknown,
  fallback: ExecutionTargetConfig["autoStopPolicy"]
): ExecutionTargetConfig["autoStopPolicy"] {
  if (value === "stop_on_completion" || value === "keep_warm") {
    return value;
  }
  return fallback;
}

function asProviderName(value: unknown, fallback: ProviderConfig["name"]) {
  if (typeof value === "string") {
    const normalized = normalizeProviderName(value);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
}
