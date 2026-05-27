/**
 * Workflow run notifier surface.
 * A notifier observes a single workflow run via the registry's event/status/progress
 * streams and forwards readable updates to an external surface (Telegram, Slack, etc.).
 * The workflow service asks a NotifierFactory for one notifier per run; if the factory
 * returns null the run executes silently.
 */
import type {
  TaskProgressEvent,
  WorkflowEvent,
  WorkflowRunStatus
} from "../types.js";

export interface WorkflowRunNotifier {
  onEvent?(event: WorkflowEvent): void;
  onProgress?(event: TaskProgressEvent): void;
  onStatus?(status: WorkflowRunStatus): void;
  close(): Promise<void> | void;
}

export interface WorkflowRunNotifierContext {
  runId: string;
  workflowId: string;
  projectId: string;
}

export type WorkflowRunNotifierFactory = (
  context: WorkflowRunNotifierContext
) =>
  | Promise<WorkflowRunNotifier | null>
  | WorkflowRunNotifier
  | null;
