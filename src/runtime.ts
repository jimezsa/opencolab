/**
 * Runtime orchestration layer.
 * Coordinates state persistence, gateway integration, agent execution, and setup actions.
 */
import fs from "node:fs";
import { ensureAgentFiles, ensureProjectAndTeamFile, resolveAgentDirectory } from "./agent.js";
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
  cloneOpenColabState,
  createDefaultExecutionTargetConfig,
  createDefaultManualSshProfile,
  createDefaultAgentConfig,
  createDefaultProjectState,
  DEFAULT_AGENT_ID,
  ensureProjectAndAgent,
  getActiveAgent as getProjectActiveAgent,
  getActiveProject,
  mergeProjectStateChanges,
  readProjectState,
  writeProjectState
} from "./project-config.js";
import {
  getProviderDefaultReasoningEffort,
  getProviderSetupDefaults,
  resolveProviderAuthMode,
  resolveProviderReasoningEffort
} from "./provider.js";
import {
  RunpodExecutionServiceImpl,
  type RunpodExecutionService,
  type RunpodJobStartInput
} from "./gpu-providers/runpod/index.js";
import { ManualSshService } from "./manual-ssh.js";
import {
  buildAgentFailureMessage,
  buildAssistantRecoveryLog,
  defaultTelegramMessageEditor,
  defaultTelegramStatusMessageCreator,
  type TelegramCallbackAnswerer,
  type TelegramDraftSender,
  type TelegramMessageEditor,
  type TelegramStatusMessageCreator,
  TelegramGateway,
  type TelegramFileSender,
  type TelegramSender,
  type TelegramTypingSender,
  isProviderTimeoutError
} from "./gateway.js";
import { createTelegramWorkflowNotifierFactory } from "./telegram-workflow-notifier.js";
import { resolveRuntimeRootDir } from "./install.js";
import type {
  AgentMemoryContext,
  AgentConfig,
  ConversationMessage,
  ExecutionTargetAvailabilityResult,
  ExecutionTargetConfig,
  ExecutionTargetTestResult,
  ExperimentRunExecResult,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary,
  GatewayResult,
  ManualSshInteractiveAccess,
  ManualSshProfile,
  ManualSshProfileTestResult,
  ManualSshSession,
  ManualSshSessionReadResult,
  OpenColabState,
  ProjectState,
  ProviderAuthMode,
  ProviderName,
  ProviderReasoningEffort,
  TaskProgressEvent,
  TaskProgressKind,
  TelegramFilePayload,
  WorkflowApprovalDecision,
  WorkflowEvent,
  WorkflowRunStatus,
  WorkflowRunState,
  WorkflowRunSummary,
  WorkflowSummary,
  WorkflowValidationResult
} from "./types.js";
import { ensureDir, nowIso } from "./utils.js";
import {
  WorkflowService,
  type WorkflowDeleteResult,
  type WorkflowDetail,
  type WorkflowMetadataPatch,
  type WorkflowStartRunInput,
  type WorkflowStartRunResult,
  type WorkflowTemplateDescriptor,
  type WorkflowTemplateId,
  type WorkflowXmlDocument
} from "./workflows/index.js";
import type { WebWorkflowGraph } from "./web/shared/types.js";

type HeartbeatNotifyMode = "quiet" | "digest" | "live";

const DEFAULT_HEARTBEAT_MESSAGE = "continue";
const MAX_HEARTBEAT_MESSAGE_CHARS = 1_000;

interface HeartbeatSettings {
  delayMs: number | null;
  notifyMode: HeartbeatNotifyMode;
  message: string;
}

interface HeartbeatProgressState {
  lastMeaningfulMessage: string | null;
  needsInputMessage: string | null;
}

type HeartbeatDigestResult =
  | {
      outcome: "completed";
      response: string;
      progressState: HeartbeatProgressState;
    }
  | {
      outcome: "failed" | "timed_out";
      error: unknown;
      progressState: HeartbeatProgressState;
    };

export interface RuntimeOptions {
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
  telegramCallbackAnswerer?: TelegramCallbackAnswerer;
  /** @deprecated Telegram live status now uses persistent editable messages in all chat types. */
  telegramDraftSender?: TelegramDraftSender;
  telegramStatusMessageCreator?: TelegramStatusMessageCreator;
  telegramMessageEditor?: TelegramMessageEditor;
  runpodExecutionService?: RunpodExecutionService;
  manualSshService?: ManualSshService;
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
  reasoningEffort?: ProviderReasoningEffort;
}

export interface TelegramSetupInput {
  chatId: string;
}

export interface ExecutionTargetSetupInput {
  id: string;
  enabled?: boolean;
  datacenterId?: string;
  preferredDatacenterIds?: string[];
  gpuType?: string;
  preferredGpuTypes?: string[];
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

export interface GpuJobExecInput {
  runId: string;
  command: string;
}

export interface ManualSshProfileSetupInput {
  id: string;
  podId?: string | null;
  host?: string | null;
  port?: number | null;
  user?: string | null;
  privateKeyPath?: string | null;
  sshConfigHost?: string | null;
  workspaceRoot?: string;
  interactiveAccess?: ManualSshInteractiveAccess;
}

export interface ManualSshSessionStartInput {
  profileId?: string;
  agentId?: string;
}

export interface ManualSshSessionWriteInput {
  sessionId: string;
  input: string;
  appendNewline?: boolean;
}

export interface WebChatTurnInput {
  projectId: string;
  agentId: string;
  text: string;
  files: TelegramFilePayload[];
}

export interface WebChatTurnOptions {
  signal: AbortSignal;
  onProgress: (event: TaskProgressEvent) => void | Promise<void>;
}

export class OpenColabRuntime {
  readonly config: OpenColabConfig;

  private state: OpenColabState;
  private lastDiskState: OpenColabState;
  private readonly heartbeatInFlight = new Set<string>();
  private readonly conversations: ConversationStore;
  private readonly providerAgent: ProviderAgent;
  private readonly runpodExecutionService: RunpodExecutionService;
  private readonly manualSshService: ManualSshService;
  private readonly gateway: TelegramGateway;
  private readonly workflowServices = new Map<string, WorkflowService>();

  constructor(cwd = resolveRuntimeRootDir(), private readonly options: RuntimeOptions = {}) {
    this.config = loadConfig(cwd);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.lastDiskState = cloneOpenColabState(this.state);
    this.conversations = new ConversationStore(this.config.rootDir);
    this.providerAgent = new ProviderAgent(this.config, () => this.getState());
    this.runpodExecutionService =
      options.runpodExecutionService ?? new RunpodExecutionServiceImpl(this.config);
    this.manualSshService = options.manualSshService ?? new ManualSshService(this.config);

    this.gateway = new TelegramGateway(this.config, {
      getState: () => this.refreshStateFromDisk(),
      saveState: (next) => {
        this.state = ensureProjectAndAgent(next);
        this.persist();
      },
      readConversationMemory: (chatId, limit): AgentMemoryContext =>
        this.conversations.readPromptMemory(this.resolveActiveAgentPath(), limit),
      appendConversation: (chatId, message) =>
        this.conversations.append(this.resolveActiveAgentPath(), message),
      resetConversationSession: () => this.conversations.resetSession(this.resolveActiveAgentPath()),
      onAgentTurnStarted: (projectId, agentId) => {
        this.clearPendingHeartbeatForTurnStart(projectId, agentId);
      },
      onAgentTurnFinished: (projectId, agentId, outcome) => {
        this.recordHeartbeatOutcome(projectId, agentId, outcome);
      },
      respond: async (input, respondOptions) => {
        if (this.options.agentResponder) {
          return this.options.agentResponder(input, respondOptions);
        }
        return this.providerAgent.respond(input, respondOptions);
      },
      telegramSender: this.options.telegramSender,
      telegramTypingSender: this.options.telegramTypingSender,
      telegramFileSender: this.options.telegramFileSender,
      telegramCallbackAnswerer: this.options.telegramCallbackAnswerer,
      telegramDraftSender: this.options.telegramDraftSender,
      telegramStatusMessageCreator: this.options.telegramStatusMessageCreator,
      telegramMessageEditor: this.options.telegramMessageEditor
    });
  }

  init(): OpenColabState {
    const hasExistingState = fs.existsSync(this.config.projectConfigPath);
    ensureDir(this.config.stateDir);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.lastDiskState = cloneOpenColabState(this.state);
    this.persist();
    if (!hasExistingState) {
      ensureProjectAndTeamFile(this.config.rootDir, this.getActiveProject().path);
    }
    this.ensureActiveProjectFiles();
    return this.state;
  }

  getState(): OpenColabState {
    return this.refreshStateFromDisk();
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

  listManualSshProfiles(projectId = this.state.activeProjectId): ManualSshProfile[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return Object.values(project.manualSshProfiles).sort((a, b) => a.id.localeCompare(b.id));
  }

  getManualSshProfile(profileId?: string, projectId = this.state.activeProjectId): ManualSshProfile {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const resolvedId = this.resolveManualSshProfileId(project, profileId);
    const profile = project.manualSshProfiles[resolvedId];
    if (!profile) {
      throw new Error(`Unknown manual SSH profile in project '${project.id}': ${resolvedId}`);
    }
    return profile;
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
    ensureProjectAndTeamFile(this.config.rootDir, project.path);
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
    const fallbackReasoningEffort =
      input.providerName === targetAgent.provider.name && input.model === targetAgent.provider.model
        ? targetAgent.provider.reasoningEffort
        : getProviderDefaultReasoningEffort(input.providerName, input.model);
    const reasoningEffort = resolveProviderReasoningEffort(
      input.providerName,
      input.model,
      input.reasoningEffort,
      fallbackReasoningEffort
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
                authMode,
                reasoningEffort
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
        pendingPairingExpiresAt: null,
        lastChatType: chatChanged ? null : this.state.telegram.lastChatType,
        lastMessageThreadId: chatChanged ? null : this.state.telegram.lastMessageThreadId,
        lastInteractionAt: chatChanged ? null : this.state.telegram.lastInteractionAt
      }
    };

    this.persist();
    return this.state;
  }

  markTelegramPaired(chatId: string): OpenColabState {
    const chatChanged = this.state.telegram.chatId !== chatId;

    this.state = {
      ...this.state,
      telegram: {
        ...this.state.telegram,
        chatId,
        paired: true,
        pairedAt: nowIso(),
        pendingPairingCode: null,
        pendingPairingExpiresAt: null,
        lastChatType: chatChanged ? null : this.state.telegram.lastChatType,
        lastMessageThreadId: chatChanged
          ? null
          : this.state.telegram.lastMessageThreadId,
        lastInteractionAt: chatChanged
          ? null
          : this.state.telegram.lastInteractionAt
      }
    };

    this.persist();
    return this.state;
  }

  setTelegramWorkflowNotifications(enabled: boolean): OpenColabState {
    this.state = {
      ...this.state,
      telegram: {
        ...this.state.telegram,
        notifyWorkflowProgress: enabled
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
    const preferredDatacenterIds = normalizeOrderedValues(
      input.preferredDatacenterIds,
      input.datacenterId,
      existing.preferredDatacenterIds,
      existing.datacenterId
    );
    const preferredGpuTypes = normalizeOrderedValues(
      input.preferredGpuTypes,
      input.gpuType,
      existing.preferredGpuTypes,
      existing.gpuType
    );
    const target: ExecutionTargetConfig = {
      ...existing,
      id,
      enabled: input.enabled ?? existing.enabled,
      datacenterId: preferredDatacenterIds[0] ?? existing.datacenterId,
      preferredDatacenterIds,
      gpuType: preferredGpuTypes[0] ?? existing.gpuType,
      preferredGpuTypes,
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

  saveManualSshProfile(input: ManualSshProfileSetupInput): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(input.id);
    const existing = project.manualSshProfiles[id] ?? createDefaultManualSshProfile(id);
    const timestamp = nowIso();
    const profile: ManualSshProfile = {
      ...existing,
      id,
      podId: normalizeNullableText(input.podId, existing.podId),
      host: normalizeNullableText(input.host, existing.host),
      port: input.port ?? existing.port,
      user: normalizeNullableText(input.user, existing.user) ?? "root",
      privateKeyPath: normalizeNullableText(input.privateKeyPath, existing.privateKeyPath),
      sshConfigHost: normalizeNullableText(input.sshConfigHost, existing.sshConfigHost),
      workspaceRoot: input.workspaceRoot?.trim() || existing.workspaceRoot,
      interactiveAccess: input.interactiveAccess ?? existing.interactiveAccess,
      createdAt: existing.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (!profile.podId && !profile.host && !profile.sshConfigHost) {
      throw new Error(
        "Manual SSH profiles require at least one Pod id, direct host, or SSH config host alias."
      );
    }
    if (!profile.sshConfigHost && profile.host && !profile.port) {
      throw new Error("Manual SSH profiles with a direct host also require an SSH port.");
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          manualSshProfiles: {
            ...project.manualSshProfiles,
            [id]: profile
          }
        }
      }
    };

    this.persist();
    return this.state;
  }

  removeManualSshProfile(profileId: string): OpenColabState {
    const project = this.getActiveProject();
    const resolvedId = this.resolveManualSshProfileId(project, profileId);
    if (!project.manualSshProfiles[resolvedId]) {
      throw new Error(`Unknown manual SSH profile in project '${project.id}': ${resolvedId}`);
    }

    const nextProfiles = { ...project.manualSshProfiles };
    delete nextProfiles[resolvedId];
    const nextDefaults = { ...project.agentRemoteDefaults };
    for (const [agentId, defaults] of Object.entries(nextDefaults)) {
      if (defaults.manualSshProfileId === resolvedId) {
        nextDefaults[agentId] = {
          ...defaults,
          manualSshProfileId: null
        };
      }
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          manualSshProfiles: nextProfiles,
          agentRemoteDefaults: nextDefaults
        }
      }
    };

    this.persist();
    return this.state;
  }

  setManualSshProfileDefault(profileId: string, agentId?: string): OpenColabState {
    const project = this.getActiveProject();
    const resolvedId = this.resolveManualSshProfileId(project, profileId);
    const resolvedAgentId = agentId ? normalizeEntityId(agentId) : this.getActiveAgent().id;
    if (!project.agents[resolvedAgentId]) {
      throw new Error(`Unknown agent in project '${project.id}': ${resolvedAgentId}`);
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          agentRemoteDefaults: {
            ...project.agentRemoteDefaults,
            [resolvedAgentId]: {
              manualSshProfileId: resolvedId
            }
          }
        }
      }
    };

    this.persist();
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

  async checkExecutionTargetAvailability(targetId: string): Promise<ExecutionTargetAvailabilityResult> {
    const project = this.getActiveProject();
    const target = this.getExecutionTarget(targetId, project.id);
    return this.runpodExecutionService.checkTargetAvailability(project, target);
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

  async execGpuJobCommand(input: GpuJobExecInput): Promise<ExperimentRunExecResult> {
    const project = this.getActiveProject();
    return this.runpodExecutionService.execRunCommand(project, input.runId, input.command);
  }

  async testManualSshProfile(profileId?: string): Promise<ManualSshProfileTestResult> {
    const project = this.getActiveProject();
    const profile = this.getManualSshProfile(profileId, project.id);
    const resolved = await this.persistResolvedManualSshProfile(project, profile.id);
    const result = await this.manualSshService.testProfile(resolved);
    if (result.ok) {
      this.saveManualSshProfile({
        id: resolved.id,
        podId: resolved.podId,
        host: resolved.host,
        port: resolved.port,
        user: resolved.user,
        privateKeyPath: resolved.privateKeyPath,
        sshConfigHost: resolved.sshConfigHost,
        workspaceRoot: resolved.workspaceRoot,
        interactiveAccess: resolved.interactiveAccess
      });
      const refreshedProject = this.getActiveProject();
      const refreshedProfile = refreshedProject.manualSshProfiles[resolved.id];
      if (refreshedProfile) {
        refreshedProfile.lastValidatedAt = nowIso();
        refreshedProfile.updatedAt = nowIso();
        this.persist();
      }
    }
    return result;
  }

  async startManualSshSession(input: ManualSshSessionStartInput = {}): Promise<ManualSshSession> {
    const project = this.getActiveProject();
    const agent = input.agentId ? this.requireProjectAgent(project, input.agentId) : this.getActiveAgent();
    const profileId = this.resolveManualSshProfileId(project, input.profileId, agent.id);
    const profile = await this.persistResolvedManualSshProfile(project, profileId);
    return this.manualSshService.startSession(project, agent, profile);
  }

  listManualSshSessions(projectId = this.state.activeProjectId): ManualSshSession[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return this.manualSshService.listSessions(project);
  }

  readManualSshSession(sessionId: string, offset?: number): ManualSshSessionReadResult {
    const project = this.getActiveProject();
    return this.manualSshService.readSession(project, sessionId, offset);
  }

  writeManualSshSession(input: ManualSshSessionWriteInput): ManualSshSession {
    const project = this.getActiveProject();
    return this.manualSshService.writeSession(
      project,
      input.sessionId,
      input.input,
      input.appendNewline ?? true
    );
  }

  async stopManualSshSession(sessionId: string): Promise<ManualSshSession> {
    const project = this.getActiveProject();
    return this.manualSshService.stopSession(project, sessionId);
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

  resolveProjectAgentPair(projectId: string, agentId: string): { project: ProjectState; agent: AgentConfig } {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const agent = project.agents[agentId];
    if (!agent) {
      throw new Error(`Unknown agent in project '${projectId}': ${agentId}`);
    }
    return { project, agent };
  }

  isAgentBusyOnGateway(projectId: string, agentId: string): boolean {
    return this.gateway.isAgentBusy(projectId, agentId);
  }

  webChatActiveSessionId(projectId: string, agentId: string): string {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    return this.conversations.getActiveSessionId(agent.path);
  }

  webChatListSessionIds(projectId: string, agentId: string): string[] {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    return this.conversations.listSessionIds(agent.path);
  }

  webChatReadSessionMessages(
    projectId: string,
    agentId: string,
    sessionId: string
  ): ConversationMessage[] {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    return this.conversations.readSessionMessages(agent.path, sessionId);
  }

  webChatActivateSession(projectId: string, agentId: string, sessionId: string): boolean {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    return this.conversations.activateSession(agent.path, sessionId);
  }

  webChatResetSession(projectId: string, agentId: string): string {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    ensureAgentFiles(this.config.rootDir, agent);
    return this.conversations.resetSession(agent.path);
  }

  webChatAppend(
    projectId: string,
    agentId: string,
    message: ConversationMessage
  ): void {
    const { agent } = this.resolveProjectAgentPair(projectId, agentId);
    this.conversations.append(agent.path, message);
  }

  async runWebChatTurn(
    input: WebChatTurnInput,
    options: WebChatTurnOptions
  ): Promise<string> {
    const { project, agent } = this.resolveProjectAgentPair(input.projectId, input.agentId);
    ensureAgentFiles(this.config.rootDir, agent);
    const memory = this.conversations.readPromptMemory(agent.path, 8);
    const responder = this.options.agentResponder
      ? (req: ProviderAgentInput, opts?: ProviderRespondOptions) => this.options.agentResponder!(req, opts)
      : (req: ProviderAgentInput, opts?: ProviderRespondOptions) =>
          this.providerAgent.respondFor(project, agent, req, opts);
    return responder(
      {
        chatId: "",
        sender: "web-chat",
        text: input.text,
        files: input.files,
        memory
      },
      {
        signal: options.signal,
        onProgress: options.onProgress
      }
    );
  }

  listWorkflows(projectId = this.state.activeProjectId): WorkflowSummary[] {
    return this.workflowServiceFor(projectId).listWorkflows();
  }

  getWorkflowDetail(
    workflowId: string,
    projectId = this.state.activeProjectId
  ): WorkflowDetail | null {
    return this.workflowServiceFor(projectId).getWorkflowDetail(workflowId);
  }

  validateWorkflow(
    workflowId: string,
    projectId = this.state.activeProjectId
  ): WorkflowValidationResult {
    return this.workflowServiceFor(projectId).validateWorkflow(workflowId);
  }

  createWorkflow(
    input: {
      workflowId: string;
      template?: WorkflowTemplateId;
      xml?: string;
    },
    projectId = this.state.activeProjectId
  ): { workflowId: string; xmlPath: string } {
    return this.workflowServiceFor(projectId).createWorkflow(input);
  }

  listWorkflowTemplates(
    projectId = this.state.activeProjectId
  ): WorkflowTemplateDescriptor[] {
    return this.workflowServiceFor(projectId).listTemplates();
  }

  readWorkflowXml(
    workflowId: string,
    projectId = this.state.activeProjectId
  ): WorkflowXmlDocument | null {
    return this.workflowServiceFor(projectId).readXml(workflowId);
  }

  updateWorkflowXml(
    workflowId: string,
    xml: string,
    projectId = this.state.activeProjectId
  ): WorkflowXmlDocument {
    return this.workflowServiceFor(projectId).updateXml(workflowId, xml);
  }

  validateWorkflowXml(
    xml: string,
    projectId = this.state.activeProjectId
  ): WorkflowValidationResult {
    return this.workflowServiceFor(projectId).validateXml(xml);
  }

  patchWorkflowMetadata(
    workflowId: string,
    patch: WorkflowMetadataPatch,
    projectId = this.state.activeProjectId
  ): WorkflowXmlDocument {
    return this.workflowServiceFor(projectId).applyMetadataPatch(
      workflowId,
      patch
    );
  }

  duplicateWorkflow(
    sourceWorkflowId: string,
    newWorkflowId: string,
    projectId = this.state.activeProjectId
  ): { workflowId: string; xmlPath: string } {
    return this.workflowServiceFor(projectId).duplicateWorkflow(
      sourceWorkflowId,
      newWorkflowId
    );
  }

  deleteWorkflow(
    workflowId: string,
    options: { cascade?: boolean } = {},
    projectId = this.state.activeProjectId
  ): WorkflowDeleteResult {
    return this.workflowServiceFor(projectId).deleteWorkflow(workflowId, options);
  }

  getWorkflowGraph(
    workflowId: string,
    projectId = this.state.activeProjectId
  ): WebWorkflowGraph | null {
    return this.workflowServiceFor(projectId).getGraph(workflowId);
  }

  pauseWorkflowRun(
    runId: string,
    projectId = this.state.activeProjectId
  ): WorkflowRunStatus | null {
    return this.workflowServiceFor(projectId).pauseRun(runId);
  }

  startWorkflowRun(
    input: WorkflowStartRunInput,
    projectId = this.state.activeProjectId
  ): WorkflowStartRunResult {
    return this.workflowServiceFor(projectId).startRun(input);
  }

  stopWorkflowRun(
    runId: string,
    projectId = this.state.activeProjectId
  ): WorkflowRunStatus | null {
    return this.workflowServiceFor(projectId).stopRun(runId);
  }

  resumeWorkflowRun(
    runId: string,
    projectId = this.state.activeProjectId
  ): { runId: string; status: WorkflowRunState["status"] } {
    return this.workflowServiceFor(projectId).resumeRun(runId);
  }

  approveWorkflowGate(
    runId: string,
    decision: WorkflowApprovalDecision,
    projectId = this.state.activeProjectId
  ): { runId: string; status: WorkflowRunState["status"] } {
    return this.workflowServiceFor(projectId).approveRun(runId, decision);
  }

  getWorkflowRun(
    workflowId: string,
    runId: string,
    projectId = this.state.activeProjectId
  ): WorkflowRunState | null {
    return this.workflowServiceFor(projectId).getRunState(workflowId, runId);
  }

  getWorkflowRunStatus(
    workflowId: string,
    runId: string,
    projectId = this.state.activeProjectId
  ): WorkflowRunStatus | null {
    return this.workflowServiceFor(projectId).getRunStatus(workflowId, runId);
  }

  resolveWorkflowRun(
    runId: string,
    projectId = this.state.activeProjectId
  ): { workflowId: string; runState: WorkflowRunState } | null {
    return this.workflowServiceFor(projectId).resolveRun(runId);
  }

  listWorkflowRuns(
    workflowId?: string,
    projectId = this.state.activeProjectId
  ): WorkflowRunSummary[] {
    return this.workflowServiceFor(projectId).listRunSummaries(workflowId);
  }

  listWorkflowRunEvents(
    workflowId: string,
    runId: string,
    projectId = this.state.activeProjectId
  ): WorkflowEvent[] {
    return this.workflowServiceFor(projectId).listRunEvents(workflowId, runId);
  }

  private workflowServiceFor(projectId: string): WorkflowService {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const existing = this.workflowServices.get(projectId);
    if (existing) {
      return existing;
    }
    const notifierFactory = createTelegramWorkflowNotifierFactory({
      getState: () => this.state,
      statusMessageCreator:
        this.options.telegramStatusMessageCreator ??
        defaultTelegramStatusMessageCreator,
      messageEditor:
        this.options.telegramMessageEditor ?? defaultTelegramMessageEditor
    });
    const service = new WorkflowService(
      this.config,
      () => {
        const refreshed = this.state.projects[projectId];
        if (!refreshed) {
          throw new Error(`Project '${projectId}' is no longer available.`);
        }
        return refreshed;
      },
      async (project, agent, input, options) => {
        if (this.options.agentResponder) {
          return this.options.agentResponder(input, options);
        }
        return this.providerAgent.respondFor(project, agent, input, options);
      },
      notifierFactory
    );
    this.workflowServices.set(projectId, service);
    return service;
  }

  async runHeartbeatTick(now = new Date()): Promise<boolean> {
    let didWork = false;

    for (const project of Object.values(this.state.projects)) {
      const pending = project.heartbeat.pending;
      if (!pending) {
        continue;
      }

      const agent = project.agents[pending.agentId];
      if (!agent || project.activeAgentId !== pending.agentId) {
        didWork = this.clearPendingHeartbeat(project.id) || didWork;
        continue;
      }

      if (this.readHeartbeatDelayMs(agent) === null) {
        didWork = this.clearPendingHeartbeat(project.id) || didWork;
        continue;
      }

      const wakeAtMs = Date.parse(pending.wakeAt);
      if (Number.isNaN(wakeAtMs)) {
        didWork = this.clearPendingHeartbeat(project.id) || didWork;
        continue;
      }
      if (wakeAtMs > now.getTime()) {
        continue;
      }
      if (this.gateway.isAgentBusy(project.id, agent.id) || this.isHeartbeatRunning(project.id, agent.id)) {
        continue;
      }

      await this.runHeartbeatTurn(project.id, agent.id);
      didWork = true;
    }

    return didWork;
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

  private refreshStateFromDisk(): OpenColabState {
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.lastDiskState = cloneOpenColabState(this.state);
    return this.state;
  }

  private persist(): void {
    const diskState = ensureProjectAndAgent(readProjectState(this.config));
    const merged = mergeProjectStateChanges(this.lastDiskState, diskState, this.state);
    writeProjectState(this.config, merged);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.lastDiskState = cloneOpenColabState(this.state);
    this.ensureActiveProjectFiles();
  }

  private async runHeartbeatTurn(projectId: string, agentId: string): Promise<void> {
    const project = this.state.projects[projectId];
    if (!project || project.activeAgentId !== agentId) {
      this.clearPendingHeartbeat(projectId);
      return;
    }

    const agent = project.agents[agentId];
    if (!agent) {
      this.clearPendingHeartbeat(projectId);
      return;
    }

    const key = this.agentTurnKey(projectId, agentId);
    if (this.heartbeatInFlight.has(key)) {
      return;
    }

    this.heartbeatInFlight.add(key);
    this.clearPendingHeartbeat(projectId);
    ensureAgentFiles(this.config.rootDir, agent);
    const heartbeatSettings = this.readHeartbeatSettings(agent);
    const heartbeatMessage = heartbeatSettings.message;
    const liveStatus =
      heartbeatSettings.notifyMode === "live"
        ? this.gateway.openHeartbeatLiveStatus(projectId, agentId, agent.provider)
        : null;

    const memory = this.conversations.readPromptMemory(agent.path, 8);
    const progressState = createHeartbeatProgressState();
    this.conversations.append(agent.path, {
      role: "user",
      content: heartbeatMessage,
      at: nowIso()
    });

    try {
      const response = await this.respondWithAgentContext(
        project,
        agent,
        {
          chatId: "",
          sender: "heartbeat",
          text: heartbeatMessage,
          files: [],
          memory
        },
        {
          signal: liveStatus?.signal,
          onProgress: async (event) => {
            recordHeartbeatProgress(progressState, event.message, event.kind);
            await liveStatus?.onProgress(event);
          }
        }
      );
      await liveStatus?.close();
      if (liveStatus?.stopRequested) {
        return;
      }
      this.conversations.append(agent.path, {
        role: "assistant",
        content: response,
        at: nowIso()
      });
      this.recordHeartbeatOutcome(projectId, agentId, "completed");
      await this.maybeSendHeartbeatDigest(agent, heartbeatSettings.notifyMode, {
        outcome: "completed",
        response,
        progressState
      });
    } catch (error) {
      await liveStatus?.close();
      if (liveStatus?.stopRequested) {
        return;
      }
      this.conversations.append(agent.path, {
        role: "assistant",
        content: buildAssistantRecoveryLog(
          error,
          agent.provider,
          this.config.providerCliTimeoutMs
        ),
        at: nowIso()
      });
      const outcome = isProviderTimeoutError(error) ? "timed_out" : "failed";
      this.recordHeartbeatOutcome(projectId, agentId, outcome);
      await this.maybeSendHeartbeatDigest(agent, heartbeatSettings.notifyMode, {
        outcome,
        error,
        progressState
      });
    } finally {
      await liveStatus?.close();
      this.heartbeatInFlight.delete(key);
    }
  }

  private async respondWithAgentContext(
    project: ProjectState,
    agent: AgentConfig,
    input: ProviderAgentInput,
    respondOptions?: ProviderRespondOptions
  ): Promise<string> {
    if (this.options.agentResponder) {
      return this.options.agentResponder(input, respondOptions);
    }
    return this.providerAgent.respondFor(project, agent, input, respondOptions);
  }

  private readHeartbeatDelayMs(agent: AgentConfig): number | null {
    return this.readHeartbeatSettings(agent).delayMs;
  }

  private readHeartbeatSettings(agent: AgentConfig): HeartbeatSettings {
    const heartbeatPath = `${resolveAgentDirectory(this.config.rootDir, agent.path)}/HEARTBEAT.md`;
    if (!fs.existsSync(heartbeatPath)) {
      return {
        delayMs: null,
        notifyMode: "quiet",
        message: DEFAULT_HEARTBEAT_MESSAGE
      };
    }

    let delayMs: number | null = null;
    let notifyMode: HeartbeatNotifyMode = "quiet";
    let message = DEFAULT_HEARTBEAT_MESSAGE;
    let sawMessage = false;
    const lines = fs.readFileSync(heartbeatPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const notifyMatch = /^notify:\s*(quiet|digest|live)\s*$/i.exec(line);
      if (notifyMatch) {
        const normalizedNotify = notifyMatch[1].toLowerCase();
        notifyMode =
          normalizedNotify === "live"
            ? "live"
            : normalizedNotify === "digest"
              ? "digest"
              : "quiet";
        continue;
      }
      const messageMatch = /^message:\s*(.*)$/i.exec(line);
      if (messageMatch && !sawMessage) {
        sawMessage = true;
        const candidate = messageMatch[1].trim();
        if (candidate && candidate.length <= MAX_HEARTBEAT_MESSAGE_CHARS) {
          message = candidate;
        }
        continue;
      }
      const match = /^after:\s*(\d+)\s*([mh])$/i.exec(line);
      if (!match) {
        continue;
      }

      const value = Number(match[1]);
      if (!Number.isInteger(value) || value <= 0) {
        return {
          delayMs: null,
          notifyMode,
          message
        };
      }
      delayMs = match[2].toLowerCase() === "h" ? value * 60 * 60_000 : value * 60_000;
    }

    return {
      delayMs,
      notifyMode,
      message
    };
  }

  private async maybeSendHeartbeatDigest(
    agent: AgentConfig,
    notifyMode: HeartbeatNotifyMode,
    result: HeartbeatDigestResult
  ): Promise<void> {
    if (notifyMode !== "digest" && notifyMode !== "live") {
      return;
    }

    const digest = buildHeartbeatDigest(agent.id, result);
    if (!digest) {
      return;
    }

    await this.gateway.sendHeartbeatDigest(digest);
  }

  private clearPendingHeartbeatForTurnStart(projectId: string, agentId: string): void {
    const project = this.state.projects[projectId];
    if (!project || project.heartbeat.pending?.agentId !== agentId) {
      return;
    }
    this.clearPendingHeartbeat(projectId);
  }

  private recordHeartbeatOutcome(
    projectId: string,
    agentId: string,
    outcome: "completed" | "stopped" | "timed_out" | "failed",
    now = new Date()
  ): void {
    const project = this.state.projects[projectId];
    if (!project) {
      return;
    }
    if (project.activeAgentId !== agentId) {
      this.clearPendingHeartbeat(projectId);
      return;
    }
    if (outcome === "failed") {
      return;
    }
    this.armHeartbeat(projectId, agentId, now);
  }

  private armHeartbeat(projectId: string, agentId: string, now: Date): void {
    const project = this.state.projects[projectId];
    const agent = project?.agents[agentId];
    if (!project || !agent || project.activeAgentId !== agentId) {
      this.clearPendingHeartbeat(projectId);
      return;
    }

    const delayMs = this.readHeartbeatDelayMs(agent);
    if (delayMs === null) {
      this.clearPendingHeartbeat(projectId);
      return;
    }

    this.updateProjectHeartbeat(projectId, {
      agentId,
      wakeAt: new Date(now.getTime() + delayMs).toISOString()
    });
  }

  private clearPendingHeartbeat(projectId: string): boolean {
    return this.updateProjectHeartbeat(projectId, null);
  }

  private updateProjectHeartbeat(projectId: string, pending: ProjectState["heartbeat"]["pending"]): boolean {
    const project = this.state.projects[projectId];
    if (!project) {
      return false;
    }

    const current = project.heartbeat.pending;
    const unchanged =
      current?.agentId === pending?.agentId &&
      current?.wakeAt === pending?.wakeAt &&
      Boolean(current) === Boolean(pending);
    if (unchanged) {
      return false;
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          heartbeat: {
            pending
          }
        }
      }
    };
    this.persist();
    return true;
  }

  private isHeartbeatRunning(projectId: string, agentId: string): boolean {
    return this.heartbeatInFlight.has(this.agentTurnKey(projectId, agentId));
  }

  private agentTurnKey(projectId: string, agentId: string): string {
    return `${projectId}:${agentId}`;
  }

  private requireProjectAgent(project: ProjectState, agentId: string): AgentConfig {
    const resolvedAgentId = normalizeEntityId(agentId);
    const agent = project.agents[resolvedAgentId];
    if (!agent) {
      throw new Error(`Unknown agent in project '${project.id}': ${resolvedAgentId}`);
    }
    return agent;
  }

  private resolveManualSshProfileId(
    project: ProjectState,
    profileId?: string,
    agentId = this.getActiveAgent().id
  ): string {
    if (profileId?.trim()) {
      return normalizeEntityId(profileId);
    }

    const preferred = project.agentRemoteDefaults[agentId]?.manualSshProfileId;
    if (preferred) {
      return preferred;
    }

    const profileIds = Object.keys(project.manualSshProfiles);
    if (profileIds.length === 1) {
      return profileIds[0];
    }

    if (profileIds.length === 0) {
      throw new Error(`Project '${project.id}' has no saved manual SSH profiles.`);
    }

    throw new Error(
      `Project '${project.id}' has multiple manual SSH profiles. Pass --profile-id or set a default first.`
    );
  }

  private async persistResolvedManualSshProfile(
    project: ProjectState,
    profileId: string
  ): Promise<ManualSshProfile> {
    const current = project.manualSshProfiles[profileId];
    if (!current) {
      throw new Error(`Unknown manual SSH profile in project '${project.id}': ${profileId}`);
    }

    const resolved = await this.manualSshService.resolveProfile(current);
    if (!manualSshProfilesEqual(current, resolved.profile)) {
      this.state = {
        ...this.state,
        projects: {
          ...this.state.projects,
          [project.id]: {
            ...project,
            manualSshProfiles: {
              ...project.manualSshProfiles,
              [profileId]: resolved.profile
            }
          }
        }
      };
      this.persist();
    }
    return this.getManualSshProfile(profileId, project.id);
  }
}

export function createRuntime(cwd = resolveRuntimeRootDir(), options: RuntimeOptions = {}): OpenColabRuntime {
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

function normalizeOrderedValues(
  values: string[] | undefined,
  singleValue: string | undefined,
  existingValues: string[],
  fallbackValue: string
): string[] {
  const ordered = new Set<string>();
  const sourceValues =
    values && values.length > 0
      ? values
      : singleValue?.trim()
        ? [singleValue]
        : existingValues.length > 0
          ? existingValues
          : [fallbackValue];

  for (const value of sourceValues) {
    const normalized = value.trim();
    if (normalized) {
      ordered.add(normalized);
    }
  }

  if (ordered.size === 0) {
    const fallback = fallbackValue.trim();
    if (fallback) {
      ordered.add(fallback);
    }
  }

  return [...ordered];
}

function createHeartbeatProgressState(): HeartbeatProgressState {
  return {
    lastMeaningfulMessage: null,
    needsInputMessage: null
  };
}

function recordHeartbeatProgress(
  state: HeartbeatProgressState,
  message: string,
  kind: TaskProgressKind
): void {
  const normalized = normalizeHeartbeatSummary(message, 400);
  if (!normalized) {
    return;
  }

  if (kind !== "progress") {
    state.lastMeaningfulMessage = normalized;
  }
  if (kind === "needs_input") {
    state.needsInputMessage = normalized;
  }
}

function buildHeartbeatDigest(agentId: string, result: HeartbeatDigestResult): string | null {
  if (result.outcome === "completed") {
    const summary = summarizeHeartbeatResponse(result.response);
    const needsInputSummary =
      result.progressState.needsInputMessage ??
      (looksLikeHeartbeatNeedsInput(summary) ? summary : null);
    if (needsInputSummary) {
      return formatHeartbeatDigest(agentId, "Heartbeat follow-up needs input.", needsInputSummary);
    }
    if (!isMeaningfulHeartbeatSummary(summary)) {
      return null;
    }
    return formatHeartbeatDigest(agentId, "Heartbeat follow-up completed.", summary);
  }

  const detail = normalizeHeartbeatSummary(
    buildAgentFailureMessage(result.error, result.progressState.lastMeaningfulMessage),
    700
  );
  if (!detail) {
    return null;
  }

  return formatHeartbeatDigest(
    agentId,
    result.outcome === "timed_out"
      ? "Heartbeat follow-up timed out."
      : "Heartbeat follow-up failed.",
    detail
  );
}

function formatHeartbeatDigest(agentId: string, heading: string, detail: string): string {
  return `${agentId}\n\n${heading}\n${detail}`;
}

function summarizeHeartbeatResponse(response: string): string {
  const withoutDirectives = String(response ?? "")
    .replace(/^\s*@telegram-file\s+\{.*\}\s*$/gmu, "")
    .trim();
  if (!withoutDirectives) {
    return "";
  }

  const firstParagraph =
    withoutDirectives
      .split(/\n\s*\n/u)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? withoutDirectives;
  return normalizeHeartbeatSummary(firstParagraph, 500);
}

function normalizeHeartbeatSummary(value: string, limit: number): string {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(limit - 3, 0))}...`;
}

function isMeaningfulHeartbeatSummary(summary: string): boolean {
  if (!summary) {
    return false;
  }
  if (/^\(empty response from .+ cli\)$/iu.test(summary)) {
    return false;
  }
  if (/^continue[.!?]*$/iu.test(summary)) {
    return false;
  }
  return true;
}

function looksLikeHeartbeatNeedsInput(summary: string): boolean {
  if (!summary) {
    return false;
  }
  return (
    /\bneed(?:s)? input\b/iu.test(summary) ||
    /\bplease confirm\b/iu.test(summary) ||
    /\bconfirm whether\b/iu.test(summary) ||
    /\bwhich should\b/iu.test(summary) ||
    /^should i\b/iu.test(summary)
  );
}

function manualSshProfilesEqual(left: ManualSshProfile, right: ManualSshProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
