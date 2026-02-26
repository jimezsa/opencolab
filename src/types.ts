export type Provider = "openai" | "anthropic" | "google";
export type AgentRole = "professor" | "student" | "reviewer";
export type IsolationMode = "host" | "docker";
export type RunStatus =
  | "created"
  | "planning"
  | "running"
  | "review"
  | "waiting_approval"
  | "approved"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

export type TaskStatus = "queued" | "running" | "ok" | "error" | "timeout";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type MeetingType = "kickoff" | "mid_run" | "final_synthesis";

export type EventType =
  | "run.created"
  | "run.status_changed"
  | "plan.created"
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "review.completed"
  | "approval.requested"
  | "approval.updated"
  | "chat.message"
  | "meeting.created"
  | "telegram.message"
  | "paper.updated";

export interface AgentTemplate {
  templateId: string;
  provider: Provider;
  cliCommand: string;
  defaultArgs: string[];
  defaultEnv: Record<string, string>;
}

export interface AgentInstance {
  agentId: string;
  templateId: string;
  role: AgentRole;
  workspacePath: string;
  maxRuntimeSec: number;
  retryLimit: number;
  isolationMode: IsolationMode;
  enabled: boolean;
}

export interface AgentInput {
  runId: string;
  taskId: string;
  prompt: string;
  workspacePath: string;
  contextFiles: string[];
}

export interface AgentOutput {
  status: "ok" | "error" | "timeout";
  stdout: string;
  stderr: string;
  outputFiles: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
}

export interface RunStartInput {
  projectName: string;
  goal: string;
}

export interface PlannedTask {
  title: string;
  prompt: string;
}
