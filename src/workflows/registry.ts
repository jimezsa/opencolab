/**
 * In-process registry for live workflow runs.
 * Tracks active abort controllers, status snapshots, and event subscribers so
 * the CLI, web server, and Telegram surfaces can observe a running workflow
 * without each transport polling disk independently.
 */
import type {
  TaskProgressEvent,
  WorkflowEvent,
  WorkflowRunStatus
} from "../types.js";

export type WorkflowEventListener = (event: WorkflowEvent) => void;
export type WorkflowStatusListener = (status: WorkflowRunStatus) => void;
export type WorkflowProgressListener = (event: TaskProgressEvent) => void;

export interface ActiveRunEntry {
  runId: string;
  workflowId: string;
  projectId: string;
  abort: AbortController;
  status: WorkflowRunStatus | null;
  recentEvents: WorkflowEvent[];
  eventListeners: Set<WorkflowEventListener>;
  statusListeners: Set<WorkflowStatusListener>;
  progressListeners: Set<WorkflowProgressListener>;
  stopRequested: boolean;
  pauseRequested: boolean;
  paused: boolean;
  completed: boolean;
}

const ACTIVE_RUNS = new Map<string, ActiveRunEntry>();
const MAX_EVENT_BACKLOG = 200;

export function registerRun(input: {
  runId: string;
  workflowId: string;
  projectId: string;
  abort: AbortController;
}): ActiveRunEntry {
  const entry: ActiveRunEntry = {
    runId: input.runId,
    workflowId: input.workflowId,
    projectId: input.projectId,
    abort: input.abort,
    status: null,
    recentEvents: [],
    eventListeners: new Set(),
    statusListeners: new Set(),
    progressListeners: new Set(),
    stopRequested: false,
    pauseRequested: false,
    paused: false,
    completed: false
  };
  ACTIVE_RUNS.set(input.runId, entry);
  return entry;
}

export function getActiveRun(runId: string): ActiveRunEntry | null {
  return ACTIVE_RUNS.get(runId) ?? null;
}

export function getActiveRuns(): ActiveRunEntry[] {
  return [...ACTIVE_RUNS.values()];
}

export function updateRunStatus(runId: string, status: WorkflowRunStatus): void {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return;
  }
  entry.status = status;
  if (status.status === "paused") {
    entry.paused = true;
  }
  if (
    status.status === "complete" ||
    status.status === "failed" ||
    status.status === "stopped"
  ) {
    entry.completed = true;
  }
  for (const listener of entry.statusListeners) {
    safeRun(() => listener(status));
  }
}

export function pushRunEvent(runId: string, event: WorkflowEvent): void {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return;
  }
  entry.recentEvents.push(event);
  if (entry.recentEvents.length > MAX_EVENT_BACKLOG) {
    entry.recentEvents.splice(0, entry.recentEvents.length - MAX_EVENT_BACKLOG);
  }
  for (const listener of entry.eventListeners) {
    safeRun(() => listener(event));
  }
}

export function pushRunProgress(runId: string, event: TaskProgressEvent): void {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return;
  }
  for (const listener of entry.progressListeners) {
    safeRun(() => listener(event));
  }
}

export function markPauseRequested(runId: string): boolean {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return false;
  }
  entry.pauseRequested = true;
  return true;
}

export function clearPauseRequested(runId: string): void {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) return;
  entry.pauseRequested = false;
}

export function markStopRequested(runId: string): boolean {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return false;
  }
  entry.stopRequested = true;
  if (!entry.abort.signal.aborted) {
    entry.abort.abort();
  }
  return true;
}

export function removeRun(runId: string): void {
  const entry = ACTIVE_RUNS.get(runId);
  if (!entry) {
    return;
  }
  entry.eventListeners.clear();
  entry.statusListeners.clear();
  entry.progressListeners.clear();
  ACTIVE_RUNS.delete(runId);
}

export function gcCompletedRuns(maxAgeMs = 30 * 60_000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [runId, entry] of ACTIVE_RUNS) {
    if (!entry.completed) {
      continue;
    }
    if (entry.eventListeners.size > 0 || entry.statusListeners.size > 0) {
      continue;
    }
    const lastEventAt = entry.recentEvents[entry.recentEvents.length - 1]?.at;
    const lastMs = lastEventAt ? Date.parse(lastEventAt) : Date.now();
    if (Number.isFinite(lastMs) && lastMs < cutoff) {
      ACTIVE_RUNS.delete(runId);
    }
  }
}

function safeRun(callback: () => void): void {
  try {
    callback();
  } catch {
    // listener errors should never break runtime; surface via callsites if needed.
  }
}

// Test-only helpers.
export const __workflowRegistryInternals = {
  ACTIVE_RUNS
};
