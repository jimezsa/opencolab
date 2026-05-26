/**
 * Shared DTOs for the OpenColab web layer.
 * Imported by both the web server (src/web/server) and the web client (src/web/client).
 */

export interface WebProviderInfo {
  name: string;
  model: string;
  authMode: string;
  reasoningEffort: string | null;
}

export interface WebHeartbeatPending {
  agentId: string;
  wakeAt: string;
}

export interface WebActiveSelection {
  projectId: string;
  agentId: string;
}

export interface WebOverview {
  active: WebActiveSelection;
  projectCount: number;
  agentCount: number;
  recentSessions: WebConversationSummary[];
  recentArtifacts: WebArtifactSummary[];
  recentGpuRuns: WebGpuRunSummary[];
  health: WebHealthStatus;
  generatedAt: string;
}

export interface WebProjectSummary {
  id: string;
  path: string;
  active: boolean;
  name: string | null;
  description: string | null;
  emoji: string | null;
  agentCount: number;
  artifactCount: number;
  runCount: number;
  recentActivityAt: string | null;
}

export interface WebProjectDetail {
  id: string;
  path: string;
  active: boolean;
  name: string | null;
  description: string | null;
  emoji: string | null;
  goal: string | null;
  focus: string | null;
  projectAndTeam: string | null;
  agents: WebAgentSummary[];
  recentSessions: WebConversationSummary[];
  recentArtifacts: WebArtifactSummary[];
  recentGpuRuns: WebGpuRunSummary[];
}

export interface WebAgentSummary {
  id: string;
  projectId: string;
  path: string;
  active: boolean;
  provider: WebProviderInfo;
  todoSummary: string | null;
  heartbeat: WebHeartbeatPending | null;
}

export interface WebAgentDetail extends WebAgentSummary {
  todo: string;
  memory: string;
  heartbeatRaw: string;
  recentSessions: WebConversationSummary[];
}

export interface WebConversationSummary {
  sessionId: string;
  projectId: string;
  agentId: string;
  date: string;
  active: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface WebConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface WebConversationDetail {
  sessionId: string;
  projectId: string;
  agentId: string;
  date: string;
  active: boolean;
  messages: WebConversationMessage[];
}

export type WebArtifactKind =
  | "paper"
  | "figure"
  | "diagram"
  | "findings"
  | "latex"
  | "compiled-pdf"
  | "experiment-log"
  | "metric"
  | "telegram"
  | "other";

export interface WebArtifactSummary {
  id: string;
  projectId: string;
  kind: WebArtifactKind;
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface WebGpuRunSummary {
  runId: string;
  projectId: string;
  targetId: string;
  state: string;
  command: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  fetchedArtifacts: string[];
  message: string | null;
}

export interface WebProviderHealth {
  name: string;
  hasCredential: boolean;
  authMode: string;
}

export interface WebHealthStatus {
  gateway: {
    ok: boolean;
    port: number;
    rootDir: string;
    runtimeMode: "mock" | "real";
  };
  telegram: {
    paired: boolean;
    pendingPairing: boolean;
    chatPresent: boolean;
  };
  providers: WebProviderHealth[];
  build: {
    version: string | null;
    packaged: boolean;
  };
}

export interface WebError {
  error: string;
}

export type WebResearchScope = "project" | "agent";

export type WebResearchStatus =
  | "running"
  | "complete"
  | "failed"
  | "abandoned"
  | "unknown";

export interface WebResearchCorpus {
  papers: number;
  summaries: number;
  diagrams: number;
}

export interface WebResearchRun {
  id: string;
  scope: WebResearchScope;
  projectId: string;
  agentId: string | null;
  folder: string;
  skill: string;
  topic: string;
  question: string | null;
  status: WebResearchStatus;
  created: string | null;
  updated: string | null;
  corpus: WebResearchCorpus;
  deliverables: string[];
  findingsPath: string | null;
  hasRunMd: boolean;
  warnings: string[];
}

export type WebResearchFileKind =
  | "pdf"
  | "markdown"
  | "image-png"
  | "image-svg"
  | "image-other"
  | "json"
  | "text"
  | "other";

export interface WebResearchFile {
  path: string;
  name: string;
  kind: WebResearchFileKind;
  size: number;
  modified: string;
  pairedSummary: string | null;
}

export interface WebResearchRunDetail extends WebResearchRun {
  tree: WebResearchFile[];
  runMd: {
    frontmatter: Record<string, unknown>;
    body: string;
  };
}

export type WebChatTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "timed_out";

export type WebChatAttachmentKind =
  | "pdf"
  | "markdown"
  | "image"
  | "text"
  | "archive"
  | "audio"
  | "video"
  | "other";

export type WebChatProgressKind =
  | "started"
  | "milestone"
  | "progress"
  | "warning"
  | "needs_input"
  | "completed";

export interface WebChatProgressEvent {
  kind: WebChatProgressKind;
  message: string;
  stage?: string;
  current?: number;
  total?: number;
  slot?: string;
  at: string;
}

export interface WebChatAttachment {
  id: string;
  name: string;
  kind: WebChatAttachmentKind;
  mimeType: string | null;
  sizeBytes: number;
  relativePath: string;
  previewUrl: string;
  rawUrl: string;
  source: "upload" | "returned";
}

export interface WebChatAgentOption {
  id: string;
  projectId: string;
  active: boolean;
  busy: boolean;
  provider: WebProviderInfo;
  todoSummary: string | null;
}

export interface WebChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  attachments: WebChatAttachment[];
}

export interface WebChatTurn {
  turnId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  status: WebChatTurnStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastProgress: string | null;
  progress: WebChatProgressEvent[];
  returnedFiles: WebChatAttachment[];
  error: string | null;
  durationMs: number | null;
}

export interface WebChatSessionSummary {
  sessionId: string;
  projectId: string;
  agentId: string;
  active: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface WebChatSessionDetail {
  projectId: string;
  agentId: string;
  sessionId: string;
  active: boolean;
  messages: WebChatMessage[];
  runningTurn: WebChatTurn | null;
}

export interface WebChatSendRequest {
  agentId: string;
  sessionId?: string;
  message: string;
  uploadIds?: string[];
}

export interface WebChatSendResponse {
  turnId: string;
  sessionId: string;
  status: WebChatTurnStatus;
}

export interface WebChatUploadResponse {
  uploads: WebChatAttachment[];
}

export interface WebChatNewSessionResponse {
  sessionId: string;
}

export type WebWorkflowStepKind =
  | "agent"
  | "decision"
  | "human_gate"
  | "merge"
  | "terminate";

export type WebWorkflowRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "stopped";

export type WebWorkflowRunPhase =
  | "validating"
  | "preparing_input"
  | "running_agent"
  | "parsing_decision"
  | "waiting_for_human"
  | "writing_outputs"
  | "choosing_next_step"
  | "completed";

export interface WebWorkflowInput {
  name: string;
  description: string | null;
  required: boolean;
}

export interface WebWorkflowSummary {
  id: string;
  projectId: string;
  version: string;
  description: string | null;
  updatedAt: string | null;
  stepCount: number;
  inputs: WebWorkflowInput[];
}

export interface WebWorkflowStepSummary {
  id: string;
  kind: WebWorkflowStepKind;
  agentId: string | null;
  loopId: string | null;
}

export interface WebWorkflowLoopSummary {
  id: string;
  parentLoopId: string | null;
  maxIterations: number | null;
  maxSteps: number | null;
  maxRuntimeMinutes: number | null;
}

export interface WebWorkflowDetail extends WebWorkflowSummary {
  steps: WebWorkflowStepSummary[];
  loops: WebWorkflowLoopSummary[];
  xmlPath: string;
  runs: WebWorkflowRunSummary[];
}

export interface WebWorkflowRunSummary {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WebWorkflowRunStatus;
  initiator: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  currentStepId: string | null;
  iteration: number;
  lastEventMessage: string | null;
}

export interface WebWorkflowRunProgress {
  current: number;
  total: number | null;
}

export interface WebWorkflowPendingGate {
  stepId: string;
  prompt: string;
  allow: Array<"approve" | "stop" | "retry" | "edit" | "branch">;
}

export interface WebWorkflowRunStatusDto {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WebWorkflowRunStatus;
  currentStepId: string | null;
  currentStepType: WebWorkflowStepKind | null;
  currentAgentId: string | null;
  currentAgentLabel: string | null;
  currentPhase: WebWorkflowRunPhase;
  iteration: number;
  maxIterations: number | null;
  startedAt: string;
  updatedAt: string;
  lastEventMessage: string | null;
  progress: WebWorkflowRunProgress;
  pendingGate: WebWorkflowPendingGate | null;
  error: string | null;
}

export interface WebWorkflowStepRecord {
  stepId: string;
  kind: WebWorkflowStepKind;
  agentId: string | null;
  iteration: number;
  startedAt: string;
  finishedAt: string | null;
  outputName: string | null;
  decisionAction: string | null;
  decisionChoice: string | null;
  durationMs: number | null;
}

export interface WebWorkflowRunDetail {
  runId: string;
  workflowId: string;
  projectId: string;
  status: WebWorkflowRunStatus;
  initiator: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  initialInputs: Record<string, string>;
  values: Record<string, string>;
  stepHistory: WebWorkflowStepRecord[];
  pendingGate: WebWorkflowPendingGate | null;
  error: string | null;
}

export interface WebWorkflowEvent {
  at: string;
  kind: string;
  message: string;
  stepId: string | null;
  agentId: string | null;
  iteration: number | null;
}

export interface WebWorkflowStartRequest {
  input?: Record<string, string>;
  inputText?: string;
  initiator?: string;
}

export interface WebWorkflowStartResponse {
  runId: string;
  workflowId: string;
  status: WebWorkflowRunStatus;
}

export interface WebWorkflowStopResponse {
  runId: string;
  status: WebWorkflowRunStatus;
}

export interface WebWorkflowApprovalRequest {
  decision: "continue" | "stop" | "retry" | "edit" | "branch";
  next?: string;
  values?: Record<string, string>;
}
