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
export type ManualSshProfileMode = "manual_pod";
export type ManualSshInteractiveAccess = "disabled" | "opt_in";

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

export interface ManualSshProfile {
  id: string;
  backend: ExecutionBackend;
  mode: ManualSshProfileMode;
  podId: string | null;
  host: string | null;
  port: number | null;
  user: string | null;
  privateKeyPath: string | null;
  sshConfigHost: string | null;
  workspaceRoot: string;
  interactiveAccess: ManualSshInteractiveAccess;
  lastValidatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AgentRemoteDefaults {
  manualSshProfileId: string | null;
}

export interface HeartbeatPending {
  agentId: string;
  wakeAt: string;
}

export interface ProjectHeartbeatState {
  pending: HeartbeatPending | null;
}

export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "minimax"
  | "xai"
  | "openrouter"
  | "kimi";
export type ProviderAuthMode = "api_key" | "oauth";
export type ProviderRuntime = "codex" | "claude" | "gemini" | "pi";
export type ProviderReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  runtime: ProviderRuntime;
  cliCommand: string;
  cliArgs: string[];
  authMode: ProviderAuthMode;
  reasoningEffort?: ProviderReasoningEffort;
}

export interface TelegramConfig {
  chatId: string | null;
  paired: boolean;
  pairedAt: string | null;
  pendingPairingCode: string | null;
  pendingPairingExpiresAt: string | null;
  lastChatType: TelegramChatType | null;
  lastMessageThreadId: string | null;
  lastInteractionAt: string | null;
  notifyWorkflowProgress: boolean;
}

export interface ProjectState {
  id: string;
  path: string;
  activeAgentId: string;
  agents: Record<string, AgentConfig>;
  heartbeat: ProjectHeartbeatState;
  manualSshProfiles: Record<string, ManualSshProfile>;
  agentRemoteDefaults: Record<string, AgentRemoteDefaults>;
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
  messageThreadId?: string;
}

export type TelegramChatType =
  | "private"
  | "group"
  | "supergroup"
  | "channel"
  | "unknown";

export interface TelegramInbound {
  kind: "message" | "callback_query";
  chatId: string;
  chatType: TelegramChatType;
  sender: string;
  commandText: string;
  text: string;
  files: TelegramFilePayload[];
  messageThreadId?: string;
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
    | "agent_stopped"
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

export interface ManualSshProfileTestResult {
  ok: boolean;
  profileId: string;
  backend: ExecutionBackend;
  warnings: string[];
  details: string[];
  resolvedHost: string | null;
  resolvedPort: number | null;
  resolvedUser: string | null;
  refreshedFromRunpod: boolean;
}

export type ManualSshSessionState =
  | "starting"
  | "running"
  | "degraded"
  | "stopping"
  | "stopped"
  | "failed";

export interface ManualSshSession {
  sessionId: string;
  projectId: string;
  agentId: string;
  profileId: string;
  backend: ExecutionBackend;
  state: ManualSshSessionState;
  message: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  workerPid: number | null;
  sshPid: number | null;
  resolvedHost: string | null;
  resolvedPort: number | null;
  resolvedUser: string | null;
  transcriptPath: string;
  inboxPath: string;
  cursor: number;
  error: string | null;
}

export interface ManualSshSessionReadResult {
  sessionId: string;
  profileId: string;
  state: ManualSshSessionState;
  offset: number;
  nextOffset: number;
  output: string;
  transcriptPath: string;
}

export type WorkflowStepKind =
  | "agent"
  | "decision"
  | "human_gate"
  | "merge"
  | "terminate";

export type WorkflowDecisionAction =
  | "continue"
  | "stop"
  | "branch"
  | "needs_human"
  | "fail";

export type WorkflowTerminateStatus = "success" | "failed" | "stopped";

export interface WorkflowStepBase {
  id: string;
  kind: WorkflowStepKind;
  loopId: string | null;
}

export interface WorkflowAgentStep extends WorkflowStepBase {
  kind: "agent";
  agentId: string;
  prompt: string;
  outputName: string | null;
}

export interface WorkflowDecisionChoice {
  name: string;
  next: string | null;
  terminate: WorkflowTerminateStatus | null;
  gate: "human" | null;
}

export interface WorkflowDecisionStep extends WorkflowStepBase {
  kind: "decision";
  agentId: string;
  prompt: string;
  outputName: string | null;
  choices: WorkflowDecisionChoice[];
  onInvalid: "pause" | "fail";
}

export interface WorkflowHumanGateStep extends WorkflowStepBase {
  kind: "human_gate";
  prompt: string;
  allow: Array<"approve" | "stop" | "retry" | "edit" | "branch">;
}

export interface WorkflowMergeStep extends WorkflowStepBase {
  kind: "merge";
  inputs: string[];
  outputName: string;
  separator: string;
}

export interface WorkflowTerminateStep extends WorkflowStepBase {
  kind: "terminate";
  status: WorkflowTerminateStatus;
  message: string | null;
}

export type WorkflowStep =
  | WorkflowAgentStep
  | WorkflowDecisionStep
  | WorkflowHumanGateStep
  | WorkflowMergeStep
  | WorkflowTerminateStep;

export interface WorkflowLoop {
  id: string;
  parentLoopId: string | null;
  maxIterations: number | null;
  maxSteps: number | null;
  maxRuntimeMinutes: number | null;
  startStepId: string;
  endStepId: string;
  childStepIds: string[];
}

export interface WorkflowInputDefinition {
  name: string;
  description: string | null;
  required: boolean;
}

export interface WorkflowDefinition {
  id: string;
  version: string;
  description: string | null;
  inputs: WorkflowInputDefinition[];
  loops: Record<string, WorkflowLoop>;
  steps: Record<string, WorkflowStep>;
  stepOrder: string[];
  entryStepId: string;
}

export interface WorkflowValidationIssue {
  severity: "error" | "warning";
  message: string;
  stepId?: string;
  loopId?: string;
}

export interface WorkflowValidationResult {
  ok: boolean;
  definition: WorkflowDefinition | null;
  issues: WorkflowValidationIssue[];
}

export interface WorkflowSummary {
  id: string;
  projectId: string;
  version: string;
  description: string | null;
  path: string;
  updatedAt: string | null;
  inputs: WorkflowInputDefinition[];
  stepCount: number;
}

export type WorkflowRunStatusKind =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "stopped";

export type WorkflowRunPhase =
  | "validating"
  | "preparing_input"
  | "running_agent"
  | "parsing_decision"
  | "waiting_for_human"
  | "writing_outputs"
  | "choosing_next_step"
  | "completed";

export interface WorkflowRunProgress {
  current: number;
  total: number | null;
}

export interface WorkflowRunStatus {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WorkflowRunStatusKind;
  currentStepId: string | null;
  currentStepType: WorkflowStepKind | null;
  currentAgentId: string | null;
  currentAgentLabel?: string;
  currentPhase: WorkflowRunPhase;
  iteration: number;
  maxIterations?: number;
  startedAt: string;
  updatedAt: string;
  lastEventMessage: string | null;
  progress: WorkflowRunProgress;
  pendingGate: {
    stepId: string;
    prompt: string;
    allow: Array<"approve" | "stop" | "retry" | "edit" | "branch">;
  } | null;
  error: string | null;
}

export type WorkflowEventKind =
  | "validation_started"
  | "validation_failed"
  | "run_started"
  | "step_started"
  | "step_completed"
  | "agent_started"
  | "agent_completed"
  | "decision_parsing"
  | "decision_chosen"
  | "loop_iteration"
  | "human_gate_paused"
  | "human_gate_resumed"
  | "merge_completed"
  | "stop_requested"
  | "resume_requested"
  | "approval_recorded"
  | "run_completed"
  | "run_failed"
  | "run_stopped";

export interface WorkflowEvent {
  at: string;
  kind: WorkflowEventKind;
  message: string;
  stepId?: string;
  agentId?: string;
  iteration?: number;
  data?: Record<string, unknown>;
}

export interface WorkflowStepRecord {
  stepId: string;
  kind: WorkflowStepKind;
  agentId: string | null;
  iteration: number;
  startedAt: string;
  finishedAt: string | null;
  outputName: string | null;
  promptPath: string | null;
  outputPath: string | null;
  decisionPath: string | null;
  metaPath: string | null;
  decisionAction: WorkflowDecisionAction | null;
  decisionChoice: string | null;
  durationMs: number | null;
}

export interface WorkflowRunState {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WorkflowRunStatusKind;
  initiator: string;
  initialInputs: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  currentStepId: string | null;
  nextStepId: string | null;
  iteration: number;
  loopIterations: Record<string, number>;
  values: Record<string, string>;
  stepHistory: WorkflowStepRecord[];
  stopRequested: boolean;
  pendingGate: {
    stepId: string;
    prompt: string;
    allow: Array<"approve" | "stop" | "retry" | "edit" | "branch">;
    pausedAt: string;
  } | null;
  error: string | null;
}

export interface WorkflowRunSummary {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WorkflowRunStatusKind;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  initiator: string;
  currentStepId: string | null;
  iteration: number;
  lastEventMessage: string | null;
}

export interface WorkflowStartInput {
  workflowId: string;
  input: Record<string, string>;
  initiator?: string;
}

export type WorkflowApprovalDecision =
  | { kind: "continue" }
  | { kind: "stop" }
  | { kind: "retry" }
  | { kind: "edit"; values: Record<string, string> }
  | { kind: "branch"; next: string };
