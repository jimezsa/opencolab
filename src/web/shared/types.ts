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
