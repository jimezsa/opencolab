/**
 * Runtime orchestration layer.
 * Coordinates state persistence, gateway integration, agent execution, and setup actions.
 */
import { ensureAgentFiles } from "./agent.js";
import { loadConfig, type OpenColabConfig } from "./config.js";
import { ConversationStore } from "./conversation.js";
import {
  ensureProjectExperimentDirs,
  readExperimentRunManifest,
  readExperimentRunStatus,
  removeExecutionTargetSnapshot,
  writeExecutionTargetSnapshot
} from "./experiments.js";
import {
  ProviderAgent,
  type ProviderAgentInput,
  type ProviderRespondOptions
} from "./provider-agent.js";
import {
  buildAgentPath,
  createDefaultExecutionTargetConfig,
  createDefaultAgentConfig,
  createDefaultProjectState,
  DEFAULT_AGENT_ID,
  ensureProjectAndAgent,
  getActiveAgent as getProjectActiveAgent,
  getActiveProject,
  readProjectState,
  writeProjectState
} from "./project-config.js";
import { getProviderSetupDefaults, resolveProviderAuthMode } from "./provider.js";
import {
  RunpodExecutionServiceImpl,
  type RunpodExecutionService,
  type RunpodJobStartInput
} from "./gpu-providers/runpod/index.js";
import {
  TelegramGateway,
  type TelegramFileSender,
  type TelegramSender,
  type TelegramTypingSender
} from "./gateway.js";
import type {
  AgentMemoryContext,
  AgentConfig,
  ExecutionTargetConfig,
  ExecutionTargetTestResult,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary,
  GatewayResult,
  OpenColabState,
  ProjectState,
  ProviderAuthMode,
  ProviderName
} from "./types.js";
import { ensureDir } from "./utils.js";

export interface RuntimeOptions {
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
  runpodExecutionService?: RunpodExecutionService;
  agentResponder?: (
    input: ProviderAgentInput,
    options?: ProviderRespondOptions
  ) => Promise<string>;
}

export interface ModelSetupInput {
  providerName: ProviderName;
  model: string;
  agentId?: string;
  cliCommand?: string;
  cliArgs?: string[];
  authMode?: ProviderAuthMode;
}

export interface TelegramSetupInput {
  chatId: string;
}

export interface ExecutionTargetSetupInput {
  id: string;
  enabled?: boolean;
  datacenterId?: string;
  gpuType?: string;
  gpuCount?: number;
  templateId?: string | null;
  imageName?: string | null;
  volumeId?: string | null;
  volumeName?: string;
  volumeSizeGb?: number;
  workspaceRoot?: string;
  sshUser?: string | null;
  sshPort?: number | null;
  sshPrivateKeyPath?: string | null;
  bootstrapProfile?: ExecutionTargetConfig["bootstrapProfile"];
  maxRuntimeMinutes?: number;
  idleStopMinutes?: number | null;
  autoStopPolicy?: ExecutionTargetConfig["autoStopPolicy"];
  maxEstimatedCostUsd?: number | null;
}

export interface GpuJobInput {
  targetId: string;
  command: string;
  includePaths?: string[];
  excludePaths?: string[];
  expectedArtifacts?: string[];
  envVarNames?: string[];
  strictArtifacts?: boolean;
  maxRuntimeMinutes?: number;
  wait?: boolean;
}

export class OpenColabRuntime {
  readonly config: OpenColabConfig;

  private state: OpenColabState;
  private readonly conversations: ConversationStore;
  private readonly providerAgent: ProviderAgent;
  private readonly runpodExecutionService: RunpodExecutionService;
  private readonly gateway: TelegramGateway;

  constructor(cwd = process.cwd(), private readonly options: RuntimeOptions = {}) {
    this.config = loadConfig(cwd);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.conversations = new ConversationStore(this.config.rootDir);
    this.providerAgent = new ProviderAgent(this.config, () => this.state);
    this.runpodExecutionService =
      options.runpodExecutionService ?? new RunpodExecutionServiceImpl(this.config);

    this.gateway = new TelegramGateway(this.config, {
      getState: () => this.state,
      saveState: (next) => {
        this.state = ensureProjectAndAgent(next);
        writeProjectState(this.config, this.state);
        this.ensureActiveProjectFiles();
      },
      readConversationMemory: (chatId, limit): AgentMemoryContext =>
        this.conversations.readPromptMemory(this.resolveActiveAgentPath(), limit),
      appendConversation: (chatId, message) =>
        this.conversations.append(this.resolveActiveAgentPath(), message),
      resetConversationSession: () => this.conversations.resetSession(this.resolveActiveAgentPath()),
      respond: async (input, respondOptions) => {
        if (this.options.agentResponder) {
          return this.options.agentResponder(input, respondOptions);
        }
        return this.providerAgent.respond(input, respondOptions);
      },
      telegramSender: this.options.telegramSender,
      telegramTypingSender: this.options.telegramTypingSender,
      telegramFileSender: this.options.telegramFileSender
    });
  }

  init(): OpenColabState {
    ensureDir(this.config.stateDir);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.persist();
    this.ensureActiveProjectFiles();
    return this.state;
  }

  getState(): OpenColabState {
    return this.state;
  }

  getActiveProject(): ProjectState {
    return getActiveProject(this.state);
  }

  getActiveAgent(): AgentConfig {
    const project = this.getActiveProject();
    return getProjectActiveAgent(project);
  }

  listProjects(): ProjectState[] {
    return Object.values(this.state.projects).sort((a, b) => a.id.localeCompare(b.id));
  }

  listExecutionTargets(projectId = this.state.activeProjectId): ExecutionTargetConfig[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return Object.values(project.executionTargets).sort((a, b) => a.id.localeCompare(b.id));
  }

  getExecutionTarget(targetId: string, projectId = this.state.activeProjectId): ExecutionTargetConfig {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const target = project.executionTargets[normalizeEntityId(targetId)];
    if (!target) {
      throw new Error(`Unknown execution target in project '${project.id}': ${targetId}`);
    }
    return target;
  }

  createProject(projectId: string): OpenColabState {
    const id = normalizeEntityId(projectId);
    if (this.state.projects[id]) {
      throw new Error(`Project already exists: ${id}`);
    }

    const project = createDefaultProjectState(id);
    project.agents[project.activeAgentId] = createDefaultAgentConfig(
      id,
      project.activeAgentId,
      this.getActiveAgent().provider
    );
    this.state = {
      ...this.state,
      activeProjectId: id,
      projects: {
        ...this.state.projects,
        [id]: project
      }
    };

    this.persist();
    this.ensureActiveProjectFiles();
    return this.state;
  }

  useProject(projectId: string): OpenColabState {
    const id = normalizeEntityId(projectId);
    if (!this.state.projects[id]) {
      throw new Error(`Unknown project: ${id}`);
    }

    this.state = {
      ...this.state,
      activeProjectId: id
    };

    this.persist();
    this.ensureActiveProjectFiles();
    return this.state;
  }

  setupModel(input: ModelSetupInput): OpenColabState {
    const project = this.getActiveProject();
    const targetAgentId = input.agentId?.trim() || project.activeAgentId;
    const targetAgent = project.agents[targetAgentId];
    if (!targetAgent) {
      throw new Error(`Unknown agent in project '${project.id}': ${targetAgentId}`);
    }
    const providerDefaults = getProviderSetupDefaults(input.providerName);
    const defaultAuthMode =
      input.providerName === targetAgent.provider.name
        ? targetAgent.provider.authMode
        : providerDefaults.authMode;
    const authMode = resolveProviderAuthMode(
      input.providerName,
      input.authMode,
      defaultAuthMode
    );
    const cliCommand = input.cliCommand?.trim() || providerDefaults.cliCommand;
    const cliArgs =
      input.cliArgs && input.cliArgs.length > 0 ? input.cliArgs : providerDefaults.cliArgs;

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          agents: {
            ...project.agents,
            [targetAgent.id]: {
              ...targetAgent,
              provider: {
                name: input.providerName,
                model: input.model,
                runtime: providerDefaults.runtime,
                cliCommand,
                cliArgs,
                authMode
              }
            }
          }
        }
      }
    };

    this.persist();
    return this.state;
  }

  setupTelegram(input: TelegramSetupInput): OpenColabState {
    const chatChanged = this.state.telegram.chatId !== input.chatId;

    this.state = {
      ...this.state,
      telegram: {
        ...this.state.telegram,
        chatId: input.chatId,
        paired: chatChanged ? false : this.state.telegram.paired,
        pairedAt: chatChanged ? null : this.state.telegram.pairedAt,
        pendingPairingCode: null,
        pendingPairingExpiresAt: null
      }
    };

    this.persist();
    return this.state;
  }

  listAgents(projectId = this.state.activeProjectId): AgentConfig[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    return Object.values(project.agents).sort((a, b) => a.id.localeCompare(b.id));
  }

  configureAgent(agentId: string, agentPath?: string): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(agentId);
    const candidatePath = agentPath?.trim();
    const resolvedPath = candidatePath || buildAgentPath(project.id, id);

    const existing =
      project.agents[id] ?? createDefaultAgentConfig(project.id, id, this.getActiveAgent().provider);
    const updatedAgent: AgentConfig = {
      ...existing,
      id,
      path: resolvedPath
    };

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          activeAgentId: id,
          agents: {
            ...project.agents,
            [id]: updatedAgent
          }
        }
      }
    };

    this.persist();
    this.ensureActiveProjectFiles();
    return this.state;
  }

  useAgent(agentId: string): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(agentId);
    if (!project.agents[id]) {
      throw new Error(`Unknown agent in project '${project.id}': ${id}`);
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          activeAgentId: id
        }
      }
    };

    this.persist();
    this.ensureActiveProjectFiles();
    return this.state;
  }

  setupExecutionTarget(input: ExecutionTargetSetupInput): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(input.id);
    const existing = project.executionTargets[id] ?? createDefaultExecutionTargetConfig(id);
    const target: ExecutionTargetConfig = {
      ...existing,
      id,
      enabled: input.enabled ?? existing.enabled,
      datacenterId: input.datacenterId?.trim() || existing.datacenterId,
      gpuType: input.gpuType?.trim() || existing.gpuType,
      gpuCount: input.gpuCount ?? existing.gpuCount,
      templateId: normalizeNullableText(input.templateId, existing.templateId),
      imageName: normalizeNullableText(input.imageName, existing.imageName),
      volume: {
        ...existing.volume,
        id: normalizeNullableText(input.volumeId, existing.volume.id),
        name: input.volumeName?.trim() || existing.volume.name,
        sizeGb: input.volumeSizeGb ?? existing.volume.sizeGb
      },
      ssh: {
        ...existing.ssh,
        user: normalizeNullableText(input.sshUser, existing.ssh.user),
        port: input.sshPort ?? existing.ssh.port,
        privateKeyPath: normalizeNullableText(input.sshPrivateKeyPath, existing.ssh.privateKeyPath)
      },
      workspaceRoot: input.workspaceRoot?.trim() || existing.workspaceRoot,
      bootstrapProfile: input.bootstrapProfile ?? existing.bootstrapProfile,
      maxRuntimeMinutes: input.maxRuntimeMinutes ?? existing.maxRuntimeMinutes,
      idleStopMinutes: input.idleStopMinutes ?? existing.idleStopMinutes,
      autoStopPolicy: input.autoStopPolicy ?? existing.autoStopPolicy,
      maxEstimatedCostUsd: input.maxEstimatedCostUsd ?? existing.maxEstimatedCostUsd
    };

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          executionTargets: {
            ...project.executionTargets,
            [id]: target
          }
        }
      }
    };

    this.persist();
    writeExecutionTargetSnapshot(this.config.rootDir, this.getActiveProject(), target);
    return this.state;
  }

  removeExecutionTarget(targetId: string): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(targetId);
    if (!project.executionTargets[id]) {
      throw new Error(`Unknown execution target in project '${project.id}': ${id}`);
    }

    const nextTargets = { ...project.executionTargets };
    delete nextTargets[id];
    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          executionTargets: nextTargets
        }
      }
    };

    this.persist();
    removeExecutionTargetSnapshot(this.config.rootDir, project, id);
    return this.state;
  }

  async testExecutionTarget(targetId: string): Promise<ExecutionTargetTestResult> {
    const project = this.getActiveProject();
    const target = this.getExecutionTarget(targetId, project.id);
    return this.runpodExecutionService.testTarget(project, target);
  }

  async startGpuJob(input: GpuJobInput): Promise<ExperimentRunStatus> {
    const project = this.getActiveProject();
    const agent = this.getActiveAgent();
    const target = this.getExecutionTarget(input.targetId, project.id);
    return this.runpodExecutionService.startRun(project, agent, {
      target,
      command: input.command,
      includePaths: input.includePaths,
      excludePaths: input.excludePaths,
      expectedArtifacts: input.expectedArtifacts,
      envVarNames: input.envVarNames,
      strictArtifacts: input.strictArtifacts,
      maxRuntimeMinutes: input.maxRuntimeMinutes,
      wait: input.wait,
      requestedBy: "cli"
    } satisfies RunpodJobStartInput);
  }

  listGpuJobs(projectId = this.state.activeProjectId): ExperimentRunSummary[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return this.runpodExecutionService.listRuns(project);
  }

  readGpuJobStatus(runId: string): ExperimentRunStatus {
    const project = this.getActiveProject();
    const status = this.runpodExecutionService.readLocalStatus(project, runId);
    if (!status) {
      throw new Error(`Unknown GPU run: ${runId}`);
    }
    return status;
  }

  readGpuJobManifest(runId: string): ExperimentRunManifest {
    const project = this.getActiveProject();
    const manifest = this.runpodExecutionService.readLocalManifest(project, runId);
    if (!manifest) {
      throw new Error(`Unknown GPU run: ${runId}`);
    }
    return manifest;
  }

  async reconcileGpuJob(runId: string): Promise<ExperimentRunStatus> {
    const project = this.getActiveProject();
    return this.runpodExecutionService.reconcileRun(project, runId);
  }

  async fetchGpuJobOutputs(runId: string): Promise<ExperimentRunStatus> {
    const project = this.getActiveProject();
    return this.runpodExecutionService.fetchRunOutputs(project, runId);
  }

  async cancelGpuJob(runId: string): Promise<ExperimentRunStatus> {
    const project = this.getActiveProject();
    return this.runpodExecutionService.cancelRun(project, runId);
  }

  async startPairing(): Promise<{ code: string; expiresAt: string; sent: boolean }> {
    return this.gateway.startPairing();
  }

  completePairing(code: string): { pairedAt: string } {
    return this.gateway.completePairing(code);
  }

  async handleTelegramWebhook(body: unknown): Promise<GatewayResult> {
    return this.gateway.handleWebhook(body);
  }

  private ensureActiveProjectFiles(): void {
    const project = getActiveProject(this.state);
    const agent = getProjectActiveAgent(project);
    if (!agent) {
      return;
    }

    ensureProjectExperimentDirs(this.config.rootDir, project);
    for (const target of Object.values(project.executionTargets)) {
      writeExecutionTargetSnapshot(this.config.rootDir, project, target);
    }
    ensureAgentFiles(this.config.rootDir, agent);
  }

  private resolveActiveAgentPath(): string {
    const project = getActiveProject(this.state);
    const agent = getProjectActiveAgent(project);
    return agent?.path ?? project.path;
  }

  private persist(): void {
    this.state = ensureProjectAndAgent(this.state);
    writeProjectState(this.config, this.state);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.ensureActiveProjectFiles();
  }
}

export function createRuntime(cwd = process.cwd(), options: RuntimeOptions = {}): OpenColabRuntime {
  return new OpenColabRuntime(cwd, options);
}

function normalizeEntityId(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Identifier is required");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid identifier '${trimmed}'. Use only letters, numbers, underscore, or hyphen.`
    );
  }

  return trimmed;
}

function normalizeNullableText(value: string | null | undefined, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value === null ? "" : value.trim();
  return normalized ? normalized : null;
}
