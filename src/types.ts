/**
 * Shared OpenColab type definitions.
 * Defines persisted state, gateway payloads, and core runtime contracts.
 */
export interface AgentFiles {
  agents: string;
  bootstrap: string;
  identity: string;
  alma: string;
  tools: string;
  user: string;
  todo: string;
  memory: string;
}

export interface AgentConfig {
  id: string;
  path: string;
  files: AgentFiles;
  provider: ProviderConfig;
}

export type ExecutionBackend = "runpod";
export type ExecutionTargetCloudType = "secure";
export type ExecutionTargetVolumeMode = "network_volume";
export type ExecutionTargetSshMode = "public_ip";
export type ExecutionTargetBootstrapProfile = "python-ml" | "pytorch-cu12" | "minimal-shell";
export type ExecutionTargetAutoStopPolicy = "stop_on_completion" | "keep_warm";

export interface ExecutionTargetVolumeConfig {
  mode: ExecutionTargetVolumeMode;
  id: string | null;
  name: string;
  sizeGb: number;
}

export interface ExecutionTargetSshConfig {
  mode: ExecutionTargetSshMode;
  user: string | null;
  port: number | null;
  privateKeyPath: string | null;
}

export interface ExecutionTargetConfig {
  id: string;
  backend: ExecutionBackend;
  enabled: boolean;
  datacenterId: string;
  preferredDatacenterIds: string[];
  cloudType: ExecutionTargetCloudType;
  gpuType: string;
  preferredGpuTypes: string[];
  gpuCount: number;
  templateId: string | null;
  imageName: string | null;
  volume: ExecutionTargetVolumeConfig;
  ssh: ExecutionTargetSshConfig;
  workspaceRoot: string;
  bootstrapProfile: ExecutionTargetBootstrapProfile;
  maxRuntimeMinutes: number;
  idleStopMinutes: number | null;
  autoStopPolicy: ExecutionTargetAutoStopPolicy;
  maxEstimatedCostUsd: number | null;
}

export type ProviderName = "openai" | "anthropic" | "gemini" | "minimax" | "xai";
export type ProviderAuthMode = "api_key" | "oauth";
export type ProviderRuntime = "codex" | "claude" | "gemini" | "pi";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  runtime: ProviderRuntime;
  cliCommand: string;
  cliArgs: string[];
  authMode: ProviderAuthMode;
}

export interface TelegramConfig {
  chatId: string | null;
  paired: boolean;
  pairedAt: string | null;
  pendingPairingCode: string | null;
  pendingPairingExpiresAt: string | null;
}

export interface ProjectState {
  id: string;
  path: string;
  activeAgentId: string;
  agents: Record<string, AgentConfig>;
  executionTargets: Record<string, ExecutionTargetConfig>;
}

export interface OpenColabState {
  version: 1;
  updatedAt: string;
  activeProjectId: string;
  projects: Record<string, ProjectState>;
  telegram: TelegramConfig;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface AgentMemoryContext {
  workingMemory: ConversationMessage[];
  previousDaySummary: string;
}

export type TaskProgressKind =
  | "started"
  | "milestone"
  | "progress"
  | "warning"
  | "needs_input"
  | "completed";

export interface TaskProgressEvent {
  kind: TaskProgressKind;
  message: string;
  stage?: string;
  current?: number;
  total?: number;
  slot?: string;
  ephemeral?: boolean;
}

export type TelegramFileKind =
  | "document"
  | "photo"
  | "audio"
  | "video"
  | "voice"
  | "video_note"
  | "animation"
  | "sticker";

export interface TelegramFilePayload {
  kind: TelegramFileKind;
  fileId: string;
  fileUniqueId?: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  telegramFilePath?: string;
  localPath?: string;
}

export interface TelegramOutboundFile {
  kind: TelegramFileKind;
  file: string;
  caption?: string;
}

export interface TelegramInlineButton {
  text: string;
  callbackData: string;
}

export type TelegramInlineKeyboard = TelegramInlineButton[][];

export interface TelegramMessageOptions {
  inlineKeyboard?: TelegramInlineKeyboard;
}

export interface TelegramInbound {
  kind: "message" | "callback_query";
  chatId: string;
  sender: string;
  commandText: string;
  text: string;
  files: TelegramFilePayload[];
  callbackQueryId?: string;
  callbackData?: string;
  callbackMessageId?: string;
}

export interface GatewayResult {
  ok: boolean;
  action:
    | "ignored"
    | "unauthorized_chat"
    | "pairing_required"
    | "agent_error"
    | "agent_response"
    | "management_command";
  response: string;
  sent: boolean;
}

export type ExperimentRunState =
  | "draft"
  | "validating"
  | "provisioning"
  | "waiting_for_ssh"
  | "syncing"
  | "bootstrapping"
  | "running"
  | "running_unreachable"
  | "fetching"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "cleanup_failed";

export interface ExperimentRunSyncPlan {
  workingRoot: string;
  includePaths: string[];
  excludePaths: string[];
  remoteWorkspaceRoot: string;
  remoteWorkingDir: string;
  fileCount: number;
  totalBytes: number;
}

export interface ExperimentRunManifest {
  runId: string;
  projectId: string;
  agentId: string;
  targetId: string;
  backend: ExecutionBackend;
  requestedBy: "cli" | "agent";
  createdAt: string;
  command: string;
  envVarNames: string[];
  expectedArtifacts: string[];
  strictArtifacts: boolean;
  maxRuntimeMinutes: number;
  sourceRevision: string | null;
  sync: ExperimentRunSyncPlan;
  targetSnapshot: ExecutionTargetConfig;
}

export interface ExperimentRunPodStatus {
  id: string | null;
  name: string | null;
  desiredStatus: string | null;
  datacenterId: string | null;
  gpuType: string | null;
  publicIp: string | null;
  sshPort: number | null;
  volumeId: string | null;
  lastObservedAt: string | null;
}

export interface ExperimentRunRemoteStatus {
  remoteWorkingDir: string | null;
  remoteRunDir: string | null;
  launchScriptPath: string | null;
  bootstrapScriptPath: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  bootstrapLogPath: string | null;
  pidFilePath: string | null;
  exitCodeFilePath: string | null;
  launchPid: number | null;
  exitCode: number | null;
}

export interface ExperimentRunLocalLogs {
  stdout: string | null;
  stderr: string | null;
  bootstrap: string | null;
  poller: string | null;
}

export interface ExperimentRunStatus {
  runId: string;
  projectId: string;
  agentId: string;
  targetId: string;
  backend: ExecutionBackend;
  state: ExperimentRunState;
  stage: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  warnings: string[];
  error: string | null;
  pod: ExperimentRunPodStatus;
  remote: ExperimentRunRemoteStatus;
  logs: ExperimentRunLocalLogs;
  fetchedArtifacts: string[];
  missingArtifacts: string[];
  progressEvents: TaskProgressEvent[];
}

export interface ExperimentRunSummary {
  runId: string;
  targetId: string;
  state: ExperimentRunState;
  createdAt: string;
  updatedAt: string;
  command: string;
}

export interface ExperimentRunExecResult {
  runId: string;
  targetId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecutionTargetTestResult {
  ok: boolean;
  targetId: string;
  backend: ExecutionBackend;
  warnings: string[];
  details: string[];
}

export interface ExecutionTargetAvailabilityCandidate {
  datacenterId: string;
  datacenterName: string | null;
  datacenterLocation: string | null;
  gpuType: string;
  stockStatus: string | null;
  available: boolean;
  podApiCompatible: boolean;
  storageSupport: "supported" | "failed" | "unknown";
  storageWarning: string | null;
}

export interface ExecutionTargetAvailabilityResult {
  ok: boolean;
  targetId: string;
  backend: ExecutionBackend;
  checkedAt: string;
  bestCandidate: ExecutionTargetAvailabilityCandidate | null;
  candidates: ExecutionTargetAvailabilityCandidate[];
  warnings: string[];
}
