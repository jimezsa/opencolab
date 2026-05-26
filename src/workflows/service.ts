/**
 * Workflow service.
 * Transport-neutral facade for creating workflows, validating them, starting
 * runs, observing status, and approving human gates. Owns the live registry
 * and the per-run AbortController. CLI and web handlers route through this
 * service instead of touching the runner or storage directly.
 */
import path from "node:path";
import type { OpenColabConfig } from "../config.js";
import type {
  ProjectState,
  WorkflowApprovalDecision,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowRunStatusKind,
  WorkflowRunSummary,
  WorkflowStep,
  WorkflowSummary,
  WorkflowValidationResult
} from "../types.js";
import { ensureDir, nowIso } from "../utils.js";
import { parseAndValidateWorkflow } from "./parser.js";
import {
  type ActiveRunEntry,
  getActiveRun,
  getActiveRuns,
  markStopRequested,
  pushRunEvent,
  pushRunProgress,
  registerRun,
  removeRun,
  updateRunStatus
} from "./registry.js";
import {
  type WorkflowAgentResponder,
  type WorkflowRunCallbacks,
  WorkflowRunner
} from "./runner.js";
import {
  appendRunEvent,
  buildWorkflowSummary,
  ensureStepDir,
  listRunIds,
  listWorkflowIds,
  readRunEvents,
  readRunState,
  readRunStatus,
  readWorkflowXml,
  resolveWorkflowDir,
  resolveWorkflowXmlPath,
  stepIdentifier,
  summarizeRun,
  writeRunState,
  writeWorkflowXml
} from "./storage.js";

export const WORKFLOW_TEMPLATE_BLANK = `<workflow id="blank" version="1">
  <description>Replace with a description of what this workflow does.</description>
  <input name="task" description="Main task or request for the workflow." />

  <step id="draft" type="agent" agent="professor">
    <prompt>Address \${input.task}. Provide a first complete answer.</prompt>
    <output name="draft_output" />
  </step>
</workflow>
`;

export const WORKFLOW_TEMPLATE_REVIEW_LOOP = `<workflow id="review-loop" version="1">
  <description>Draft, review, and judge until the judge stops or a human takes over.</description>
  <input name="task" description="The main task for the workflow." />

  <step id="draft" type="agent" agent="professor">
    <prompt>Produce an initial answer for \${input.task}.</prompt>
    <output name="draft_output" />
  </step>

  <loop id="review_loop" maxIterations="3">
    <step id="review" type="agent" agent="professor">
      <prompt>Review \${draft_output} and suggest improvements.</prompt>
      <output name="review_output" />
    </step>

    <step id="judge" type="decision" agent="professor">
      <prompt>
        Compare the original task '\${input.task}', the draft \${draft_output}, and the review \${review_output}.
        Decide whether the workflow should continue iterating, stop, or ask the human.
      </prompt>
      <choices>
        <choice name="continue" next="draft" />
        <choice name="stop" terminate="success" />
        <choice name="human" gate="human" />
      </choices>
    </step>
  </loop>
</workflow>
`;

export const WORKFLOW_TEMPLATE_JUDGE_AND_RETRY = `<workflow id="judge-and-retry" version="1">
  <description>Draft, judge, and retry once if the judge calls for a redo.</description>
  <input name="task" description="The main task for the workflow." />

  <step id="draft" type="agent" agent="professor">
    <prompt>Produce a thoughtful answer for \${input.task}.</prompt>
    <output name="draft_output" />
  </step>

  <step id="judge" type="decision" agent="professor">
    <prompt>
      Compare \${input.task} with \${draft_output}. If the answer fully addresses the task, stop.
      Otherwise retry the draft.
    </prompt>
    <choices>
      <choice name="retry" next="draft" />
      <choice name="stop" terminate="success" />
    </choices>
  </step>
</workflow>
`;

export type WorkflowTemplateId = "blank" | "review-loop" | "judge-and-retry";

const TEMPLATES: Record<WorkflowTemplateId, string> = {
  blank: WORKFLOW_TEMPLATE_BLANK,
  "review-loop": WORKFLOW_TEMPLATE_REVIEW_LOOP,
  "judge-and-retry": WORKFLOW_TEMPLATE_JUDGE_AND_RETRY
};

export interface WorkflowDetail extends WorkflowSummary {
  steps: Array<{
    id: string;
    kind: string;
    agentId: string | null;
    loopId: string | null;
  }>;
  loops: Array<{
    id: string;
    parentLoopId: string | null;
    maxIterations: number | null;
    maxSteps: number | null;
    maxRuntimeMinutes: number | null;
  }>;
  xmlPath: string;
}

export interface WorkflowStartRunInput {
  workflowId: string;
  input: Record<string, string>;
  initiator?: string;
}

export interface WorkflowStartRunResult {
  runId: string;
  workflowId: string;
  projectId: string;
}

export interface WorkflowApprovalResult {
  runId: string;
  status: WorkflowRunStatusKind;
}

export class WorkflowService {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly projectAccessor: () => ProjectState,
    private readonly agentResponder: WorkflowAgentResponder
  ) {}

  listWorkflows(): WorkflowSummary[] {
    const project = this.projectAccessor();
    const ids = listWorkflowIds(this.config, project);
    const summaries: WorkflowSummary[] = [];
    for (const workflowId of ids) {
      const validation = this.validateWorkflow(workflowId);
      if (validation.definition) {
        summaries.push(
          buildWorkflowSummary(
            this.config,
            project,
            validation.definition,
            workflowId
          )
        );
      }
    }
    return summaries;
  }

  validateWorkflow(workflowId: string): WorkflowValidationResult {
    const project = this.projectAccessor();
    const xml = readWorkflowXml(this.config, project, workflowId);
    if (!xml) {
      return {
        ok: false,
        definition: null,
        issues: [
          {
            severity: "error",
            message: `Workflow '${workflowId}' was not found in project '${project.id}'.`
          }
        ]
      };
    }
    const result = parseAndValidateWorkflow(xml.xml);
    if (result.definition && result.definition.id !== workflowId) {
      result.issues.push({
        severity: "warning",
        message: `Workflow file id '${result.definition.id}' does not match folder id '${workflowId}'.`
      });
    }
    return result;
  }

  getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    const project = this.projectAccessor();
    const validation = this.validateWorkflow(workflowId);
    if (!validation.definition) {
      return null;
    }
    const summary = buildWorkflowSummary(
      this.config,
      project,
      validation.definition,
      workflowId
    );
    return {
      ...summary,
      steps: Object.values(validation.definition.steps)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((step) => ({
          id: step.id,
          kind: step.kind,
          agentId: step.kind === "agent" || step.kind === "decision" ? step.agentId : null,
          loopId: step.loopId
        })),
      loops: Object.values(validation.definition.loops).map((loop) => ({
        id: loop.id,
        parentLoopId: loop.parentLoopId,
        maxIterations: loop.maxIterations,
        maxSteps: loop.maxSteps,
        maxRuntimeMinutes: loop.maxRuntimeMinutes
      })),
      xmlPath: resolveWorkflowXmlPath(this.config, project, workflowId)
    };
  }

  createWorkflow(input: {
    workflowId: string;
    template?: WorkflowTemplateId;
    xml?: string;
  }): { workflowId: string; xmlPath: string } {
    const project = this.projectAccessor();
    if (!isValidWorkflowId(input.workflowId)) {
      throw new Error(
        `Invalid workflow id '${input.workflowId}'. Use letters, digits, underscore, or hyphen.`
      );
    }
    const existing = readWorkflowXml(this.config, project, input.workflowId);
    if (existing) {
      throw new Error(
        `Workflow '${input.workflowId}' already exists in project '${project.id}'.`
      );
    }
    const xmlSource = input.xml ?? TEMPLATES[input.template ?? "blank"];
    const xmlWithId = xmlSource.replace(
      /<workflow\s+id="[^"]*"/,
      `<workflow id="${input.workflowId}"`
    );
    const validation = parseAndValidateWorkflow(xmlWithId);
    if (!validation.ok) {
      const messages = validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ");
      throw new Error(`Cannot create workflow: ${messages || "validation failed."}`);
    }
    const xmlPath = writeWorkflowXml(this.config, project, input.workflowId, xmlWithId);
    return { workflowId: input.workflowId, xmlPath };
  }

  getRunState(workflowId: string, runId: string): WorkflowRunState | null {
    return readRunState(this.config, this.projectAccessor(), workflowId, runId);
  }

  getRunStatus(workflowId: string, runId: string): WorkflowRunStatus | null {
    const live = getActiveRun(runId);
    if (live?.status && live.workflowId === workflowId) {
      return live.status;
    }
    return readRunStatus(this.config, this.projectAccessor(), workflowId, runId);
  }

  getRunStatusByRunId(runId: string): WorkflowRunStatus | null {
    const live = getActiveRun(runId);
    if (live?.status) {
      return live.status;
    }
    const project = this.projectAccessor();
    for (const workflowId of listWorkflowIds(this.config, project)) {
      const status = readRunStatus(this.config, project, workflowId, runId);
      if (status) {
        return status;
      }
    }
    return null;
  }

  resolveRun(runId: string): {
    workflowId: string;
    runState: WorkflowRunState;
  } | null {
    const project = this.projectAccessor();
    const live = getActiveRun(runId);
    if (live) {
      const state = readRunState(this.config, project, live.workflowId, runId);
      if (state) {
        return { workflowId: live.workflowId, runState: state };
      }
    }
    for (const workflowId of listWorkflowIds(this.config, project)) {
      const state = readRunState(this.config, project, workflowId, runId);
      if (state) {
        return { workflowId, runState: state };
      }
    }
    return null;
  }

  listRunSummaries(workflowId?: string): WorkflowRunSummary[] {
    const project = this.projectAccessor();
    const targetWorkflows = workflowId
      ? [workflowId]
      : listWorkflowIds(this.config, project);
    const summaries: WorkflowRunSummary[] = [];
    for (const id of targetWorkflows) {
      for (const runId of listRunIds(this.config, project, id)) {
        const state = readRunState(this.config, project, id, runId);
        if (!state) {
          continue;
        }
        const events = readRunEvents(this.config, project, id, runId);
        summaries.push(summarizeRun(state, events[events.length - 1] ?? null));
      }
    }
    summaries.sort((a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)
    );
    return summaries;
  }

  listRunEvents(workflowId: string, runId: string): WorkflowEvent[] {
    return readRunEvents(this.config, this.projectAccessor(), workflowId, runId);
  }

  startRun(input: WorkflowStartRunInput): WorkflowStartRunResult {
    const project = this.projectAccessor();
    const validation = this.validateWorkflow(input.workflowId);
    if (!validation.definition) {
      const errors = validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ");
      throw new Error(
        `Workflow '${input.workflowId}' is not runnable: ${errors || "validation failed."}`
      );
    }
    const definition = validation.definition;
    this.ensureInputsSatisfied(definition, input.input);
    this.ensureAgentsExist(project, definition);

    const runner = new WorkflowRunner(
      this.config,
      project,
      this.agentResponder
    );
    const state = runner.initRun({
      workflowId: input.workflowId,
      definition,
      inputs: input.input,
      initiator: input.initiator ?? "cli"
    });
    const controller = new AbortController();
    const entry = registerRun({
      runId: state.runId,
      workflowId: input.workflowId,
      projectId: project.id,
      abort: controller
    });
    const callbacks: WorkflowRunCallbacks = {
      onStatusUpdate: (status) => {
        updateRunStatus(entry.runId, status);
      },
      onEvent: (event) => {
        pushRunEvent(entry.runId, event);
      },
      onProgress: (event) => {
        pushRunProgress(entry.runId, event);
      }
    };
    void this.executeRun(runner, state, definition, entry, controller, callbacks);
    return {
      runId: state.runId,
      workflowId: input.workflowId,
      projectId: project.id
    };
  }

  stopRun(runId: string): WorkflowRunStatus | null {
    const project = this.projectAccessor();
    const resolved = this.resolveRun(runId);
    if (!resolved) {
      return null;
    }
    appendRunEvent(this.config, project, resolved.workflowId, runId, {
      at: nowIso(),
      kind: "stop_requested",
      message: `Stop requested for run ${runId}.`
    });
    const live = getActiveRun(runId);
    if (live) {
      markStopRequested(runId);
    } else {
      // Persist stop intent so resume cannot accidentally restart.
      const next: WorkflowRunState = {
        ...resolved.runState,
        stopRequested: true,
        status:
          resolved.runState.status === "running" ||
          resolved.runState.status === "paused" ||
          resolved.runState.status === "queued"
            ? "stopped"
            : resolved.runState.status,
        updatedAt: nowIso(),
        finishedAt: resolved.runState.finishedAt ?? nowIso()
      };
      writeRunState(this.config, project, resolved.workflowId, next);
    }
    return this.getRunStatus(resolved.workflowId, runId);
  }

  approveRun(
    runId: string,
    decision: WorkflowApprovalDecision
  ): WorkflowApprovalResult {
    const project = this.projectAccessor();
    const resolved = this.resolveRun(runId);
    if (!resolved) {
      throw new Error(`Unknown workflow run: ${runId}`);
    }
    const validation = this.validateWorkflow(resolved.workflowId);
    if (!validation.definition) {
      throw new Error(
        `Workflow '${resolved.workflowId}' is no longer valid; cannot resume run ${runId}.`
      );
    }
    const definition = validation.definition;
    if (resolved.runState.status !== "paused" || !resolved.runState.pendingGate) {
      throw new Error(
        `Run ${runId} is not currently waiting at a human gate.`
      );
    }
    const gate = definition.steps[resolved.runState.pendingGate.stepId];
    if (!gate) {
      throw new Error(
        `Pending gate step '${resolved.runState.pendingGate.stepId}' is not defined in workflow '${resolved.workflowId}'.`
      );
    }
    const updated = applyApproval(
      resolved.runState,
      definition,
      decision,
      gate
    );
    appendRunEvent(this.config, project, resolved.workflowId, runId, {
      at: nowIso(),
      kind: "approval_recorded",
      message: `Human approval '${decision.kind}' recorded for run ${runId}.`
    });
    writeRunState(this.config, project, resolved.workflowId, updated);
    if (decision.kind === "stop") {
      const stopped: WorkflowRunState = {
        ...updated,
        status: "stopped",
        finishedAt: nowIso(),
        currentStepId: null,
        nextStepId: null
      };
      writeRunState(this.config, project, resolved.workflowId, stopped);
      return { runId, status: "stopped" };
    }
    return this.resumeRun(runId, updated.workflowId);
  }

  resumeRun(runId: string, workflowId?: string): WorkflowApprovalResult {
    const project = this.projectAccessor();
    const resolved = workflowId
      ? {
          workflowId,
          runState: readRunState(this.config, project, workflowId, runId)
        }
      : this.resolveRun(runId);
    if (!resolved || !resolved.runState) {
      throw new Error(`Unknown workflow run: ${runId}`);
    }
    const validation = this.validateWorkflow(resolved.workflowId);
    if (!validation.definition) {
      throw new Error(
        `Workflow '${resolved.workflowId}' is no longer valid; cannot resume run ${runId}.`
      );
    }
    const state: WorkflowRunState = {
      ...resolved.runState,
      status: "running",
      pendingGate: null,
      stopRequested: false,
      updatedAt: nowIso()
    };
    writeRunState(this.config, project, resolved.workflowId, state);
    const runner = new WorkflowRunner(
      this.config,
      project,
      this.agentResponder
    );
    const controller = new AbortController();
    const entry = registerRun({
      runId,
      workflowId: resolved.workflowId,
      projectId: project.id,
      abort: controller
    });
    const callbacks: WorkflowRunCallbacks = {
      onStatusUpdate: (status) => {
        updateRunStatus(entry.runId, status);
      },
      onEvent: (event) => {
        pushRunEvent(entry.runId, event);
      },
      onProgress: (event) => {
        pushRunProgress(entry.runId, event);
      }
    };
    appendRunEvent(this.config, project, resolved.workflowId, runId, {
      at: nowIso(),
      kind: "resume_requested",
      message: `Resume requested for run ${runId}.`
    });
    void this.executeRun(
      runner,
      state,
      validation.definition,
      entry,
      controller,
      callbacks
    );
    return { runId, status: "running" };
  }

  private async executeRun(
    runner: WorkflowRunner,
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    entry: ActiveRunEntry,
    controller: AbortController,
    callbacks: WorkflowRunCallbacks
  ): Promise<void> {
    try {
      const finalState = await runner.execute(state, definition, {
        signal: controller.signal,
        callbacks
      });
      if (finalState.status === "paused") {
        entry.paused = true;
      } else {
        entry.completed = true;
      }
    } catch (error) {
      entry.completed = true;
      appendRunEvent(
        this.config,
        this.projectAccessor(),
        state.workflowId,
        state.runId,
        {
          at: nowIso(),
          kind: "run_failed",
          message: `Workflow runner crashed: ${(error as Error).message}`
        }
      );
    } finally {
      if (entry.completed && entry.eventListeners.size === 0 && entry.statusListeners.size === 0) {
        removeRun(entry.runId);
      }
    }
  }

  private ensureInputsSatisfied(
    definition: WorkflowDefinition,
    input: Record<string, string>
  ): void {
    for (const declared of definition.inputs) {
      if (!declared.required) {
        continue;
      }
      const value = input[declared.name];
      if (value === undefined || String(value).trim().length === 0) {
        throw new Error(
          `Workflow '${definition.id}' requires input '${declared.name}'.`
        );
      }
    }
  }

  private ensureAgentsExist(
    project: ProjectState,
    definition: WorkflowDefinition
  ): void {
    for (const step of Object.values(definition.steps)) {
      if (step.kind !== "agent" && step.kind !== "decision") {
        continue;
      }
      const agentId = step.agentId;
      if (!project.agents[agentId]) {
        throw new Error(
          `Workflow '${definition.id}' references agent '${agentId}' which is not configured in project '${project.id}'.`
        );
      }
    }
  }
}

function applyApproval(
  state: WorkflowRunState,
  definition: WorkflowDefinition,
  decision: WorkflowApprovalDecision,
  gate: WorkflowStep
): WorkflowRunState {
  const next: WorkflowRunState = {
    ...state,
    pendingGate: null,
    updatedAt: nowIso()
  };
  if (decision.kind === "stop") {
    next.status = "stopped";
    next.finishedAt = nowIso();
    next.currentStepId = null;
    next.nextStepId = null;
    return next;
  }
  if (decision.kind === "edit") {
    next.initialInputs = { ...state.initialInputs, ...decision.values };
    next.values = {
      ...state.values,
      ...Object.fromEntries(
        Object.entries(decision.values).map(([key, value]) => [`input.${key}`, value])
      )
    };
  }
  if (decision.kind === "branch") {
    next.nextStepId = decision.next;
    return next;
  }
  if (decision.kind === "retry") {
    next.nextStepId = gate.id;
    return next;
  }
  // continue
  if (gate.kind === "human_gate") {
    // Fall through to the next step in the workflow's order.
    next.nextStepId = nextStepInOrder(definition, gate.id);
    return next;
  }
  // Decision gate that paused due to invalid output: retry the same step.
  next.nextStepId = gate.id;
  return next;
}

function nextStepInOrder(
  definition: WorkflowDefinition,
  currentStepId: string
): string | null {
  const index = definition.stepOrder.indexOf(currentStepId);
  if (index < 0 || index === definition.stepOrder.length - 1) {
    return null;
  }
  return definition.stepOrder[index + 1] ?? null;
}

function isValidWorkflowId(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
}

export function listActiveRunSummaries(): Array<{
  runId: string;
  workflowId: string;
  projectId: string;
}> {
  return getActiveRuns().map((entry) => ({
    runId: entry.runId,
    workflowId: entry.workflowId,
    projectId: entry.projectId
  }));
}

// Re-exports for callers that need finer-grained control without importing
// from the internal modules directly.
export {
  getActiveRun,
  pushRunEvent as registryPushEvent,
  updateRunStatus as registryUpdateStatus
};

// Convenience helpers used by tests and integrations.
export function ensureWorkflowRunDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): string {
  const dir = resolveWorkflowDir(config, project, workflowId);
  const runDir = path.join(dir, "runs", runId);
  ensureDir(runDir);
  return runDir;
}

export function ensureWorkflowStepDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string,
  stepId: string,
  iteration: number
): string {
  return ensureStepDir(
    config,
    project,
    workflowId,
    runId,
    stepIdentifier(stepId, iteration)
  );
}

