/**
 * Workflow storage helpers.
 * Manages the project-scoped workflow directory layout, run folder
 * scaffolding, and append-only event/state files described in
 * docs/workflows.md.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveAgentDirectory } from "../agent.js";
import type { OpenColabConfig } from "../config.js";
import type {
  ProjectState,
  WorkflowDecisionAction,
  WorkflowDecisionChoice,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowStep,
  WorkflowStepRecord,
  WorkflowSummary
} from "../types.js";
import { ensureDir, nowIso, writeJsonAtomic } from "../utils.js";

const WORKFLOW_FILE_NAME = "workflow.xml";
const RUN_STATE_FILE = "state.json";
const RUN_STATUS_FILE = "status.json";
const RUN_EVENTS_FILE = "events.jsonl";
const RUN_README = "RUN.md";

export function resolveProjectWorkflowsDir(
  config: OpenColabConfig,
  project: ProjectState
): string {
  const projectDir = resolveAgentDirectory(config.rootDir, project.path);
  return path.join(projectDir, "workflows");
}

export function resolveWorkflowDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): string {
  return path.join(resolveProjectWorkflowsDir(config, project), workflowId);
}

export function resolveWorkflowXmlPath(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): string {
  return path.join(
    resolveWorkflowDir(config, project, workflowId),
    WORKFLOW_FILE_NAME
  );
}

export function resolveWorkflowRunsDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): string {
  return path.join(
    resolveWorkflowDir(config, project, workflowId),
    "runs"
  );
}

export function resolveWorkflowRunDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): string {
  return path.join(
    resolveWorkflowRunsDir(config, project, workflowId),
    runId
  );
}

export function listWorkflowIds(
  config: OpenColabConfig,
  project: ProjectState
): string[] {
  const root = resolveProjectWorkflowsDir(config, project);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(root, entry.name, WORKFLOW_FILE_NAME))
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export interface WorkflowXmlReadResult {
  xml: string;
  path: string;
  updatedAt: string;
}

export function readWorkflowXml(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): WorkflowXmlReadResult | null {
  const xmlPath = resolveWorkflowXmlPath(config, project, workflowId);
  if (!fs.existsSync(xmlPath)) {
    return null;
  }
  const xml = fs.readFileSync(xmlPath, "utf8");
  const stat = fs.statSync(xmlPath);
  return {
    xml,
    path: xmlPath,
    updatedAt: stat.mtime.toISOString()
  };
}

export function writeWorkflowXml(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  xml: string
): string {
  const xmlPath = resolveWorkflowXmlPath(config, project, workflowId);
  ensureDir(path.dirname(xmlPath));
  fs.writeFileSync(xmlPath, xml.endsWith("\n") ? xml : `${xml}\n`, "utf8");
  return xmlPath;
}

export function deleteWorkflow(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): boolean {
  const dir = resolveWorkflowDir(config, project, workflowId);
  if (!fs.existsSync(dir)) {
    return false;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function buildWorkflowSummary(
  config: OpenColabConfig,
  project: ProjectState,
  definition: WorkflowDefinition,
  workflowId: string
): WorkflowSummary {
  const xmlPath = resolveWorkflowXmlPath(config, project, workflowId);
  let updatedAt: string | null = null;
  try {
    if (fs.existsSync(xmlPath)) {
      updatedAt = fs.statSync(xmlPath).mtime.toISOString();
    }
  } catch {
    updatedAt = null;
  }
  return {
    id: workflowId,
    projectId: project.id,
    version: definition.version,
    description: definition.description,
    path: xmlPath,
    updatedAt,
    inputs: definition.inputs,
    stepCount: definition.stepOrder.length
  };
}

export function listRunIds(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string
): string[] {
  const runsDir = resolveWorkflowRunsDir(config, project, workflowId);
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(runsDir, entry.name, RUN_STATE_FILE))
    )
    .map((entry) => entry.name);
}

export function readRunState(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): WorkflowRunState | null {
  const file = path.join(
    resolveWorkflowRunDir(config, project, workflowId, runId),
    RUN_STATE_FILE
  );
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as WorkflowRunState;
  } catch {
    return null;
  }
}

export function writeRunState(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  state: WorkflowRunState
): void {
  const dir = resolveWorkflowRunDir(config, project, workflowId, state.runId);
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, RUN_STATE_FILE), state);
  writeRunMarkdown(dir, state);
}

export function readRunStatus(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): WorkflowRunStatus | null {
  const file = path.join(
    resolveWorkflowRunDir(config, project, workflowId, runId),
    RUN_STATUS_FILE
  );
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as WorkflowRunStatus;
  } catch {
    return null;
  }
}

export function writeRunStatus(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  status: WorkflowRunStatus
): void {
  const dir = resolveWorkflowRunDir(
    config,
    project,
    workflowId,
    status.runId
  );
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, RUN_STATUS_FILE), status);
}

export function appendRunEvent(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string,
  event: WorkflowEvent
): void {
  const dir = resolveWorkflowRunDir(config, project, workflowId, runId);
  ensureDir(dir);
  const file = path.join(dir, RUN_EVENTS_FILE);
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

export function readRunEvents(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): WorkflowEvent[] {
  const dir = resolveWorkflowRunDir(config, project, workflowId, runId);
  const file = path.join(dir, RUN_EVENTS_FILE);
  if (!fs.existsSync(file)) {
    return [];
  }
  const raw = fs.readFileSync(file, "utf8");
  const events: WorkflowEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as WorkflowEvent);
    } catch {
      // Skip malformed lines without failing the whole read.
    }
  }
  return events;
}

export function ensureStepDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string,
  stepIdentifier: string
): string {
  const dir = path.join(
    resolveWorkflowRunDir(config, project, workflowId, runId),
    "steps",
    stepIdentifier
  );
  ensureDir(dir);
  return dir;
}

export function ensureInputDir(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string
): string {
  const dir = path.join(
    resolveWorkflowRunDir(config, project, workflowId, runId),
    "inputs"
  );
  ensureDir(dir);
  return dir;
}

export function buildRunSummary(state: WorkflowRunState): WorkflowRunSummary {
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    projectId: state.projectId,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    initiator: state.initiator,
    currentStepId: state.currentStepId,
    iteration: state.iteration,
    lastEventMessage: null
  };
}

export function newRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "");
  return `run_${stamp}_${randomSuffix(6)}`;
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function writeRunMarkdown(dir: string, state: WorkflowRunState): void {
  const lines = [
    "---",
    `workflow_id: ${state.workflowId}`,
    `run_id: ${state.runId}`,
    `project_id: ${state.projectId}`,
    `status: ${state.status}`,
    `created: ${state.createdAt}`,
    `updated: ${state.updatedAt}`,
    `initiator: ${state.initiator}`,
    `current_step: ${state.currentStepId ?? ""}`,
    `iteration: ${state.iteration}`,
    "---",
    "",
    `# Workflow run ${state.runId}`,
    "",
    `Status: ${state.status}`,
    "",
    "Use `events.jsonl` for the append-only event log and `state.json` for",
    "execution state. Step inputs and outputs are under `steps/`."
  ];
  fs.writeFileSync(path.join(dir, RUN_README), `${lines.join("\n")}\n`, "utf8");
}

export function applyStepRecord(
  state: WorkflowRunState,
  record: WorkflowStepRecord
): WorkflowRunState {
  return {
    ...state,
    stepHistory: [...state.stepHistory, record]
  };
}

export function buildDecisionPath(
  config: OpenColabConfig,
  project: ProjectState,
  workflowId: string,
  runId: string,
  stepIdentifier: string
): string {
  return path.join(
    ensureStepDir(config, project, workflowId, runId, stepIdentifier),
    "decision.xml"
  );
}

export interface DecisionWriteContext {
  action: WorkflowDecisionAction;
  choiceName: string | null;
  next: string | null;
  reason: string | null;
}

export function writeDecisionXml(
  filePath: string,
  context: DecisionWriteContext
): void {
  const attrs: string[] = [`action="${escapeXml(context.action)}"`];
  if (context.choiceName) {
    attrs.push(`choice="${escapeXml(context.choiceName)}"`);
  }
  if (context.next) {
    attrs.push(`next="${escapeXml(context.next)}"`);
  }
  const reasonAttr = context.reason
    ? `\n  reason="${escapeXml(context.reason)}"`
    : "";
  const xml = `<workflow-decision\n  ${attrs.join(
    "\n  "
  )}${reasonAttr}\n/>\n`;
  fs.writeFileSync(filePath, xml, "utf8");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface StepMeta {
  stepId: string;
  iteration: number;
  startedAt: string;
  finishedAt: string;
  agentId: string | null;
  decision: DecisionWriteContext | null;
}

export function writeStepMeta(
  stepDir: string,
  meta: StepMeta
): void {
  writeJsonAtomic(path.join(stepDir, "meta.json"), meta);
}

export function stepIdentifier(stepId: string, iteration: number): string {
  return iteration <= 1 ? stepId : `${stepId}__iter-${iteration}`;
}

export function findChoiceByNext(
  step: WorkflowStep,
  reference: string
): WorkflowDecisionChoice | null {
  if (step.kind !== "decision") {
    return null;
  }
  for (const choice of step.choices) {
    if (choice.next === reference) {
      return choice;
    }
  }
  return null;
}

export function createInitialRunState(input: {
  workflowId: string;
  projectId: string;
  runId: string;
  initiator: string;
  inputs: Record<string, string>;
  entryStepId: string;
}): WorkflowRunState {
  const now = nowIso();
  return {
    runId: input.runId,
    workflowId: input.workflowId,
    projectId: input.projectId,
    status: "queued",
    initiator: input.initiator,
    initialInputs: input.inputs,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    currentStepId: input.entryStepId,
    nextStepId: input.entryStepId,
    iteration: 0,
    loopIterations: {},
    values: buildInitialValues(input.inputs),
    stepHistory: [],
    stopRequested: false,
    pendingGate: null,
    error: null
  };
}

function buildInitialValues(inputs: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    values[`input.${key}`] = value;
  }
  return values;
}

export function summarizeRun(
  state: WorkflowRunState,
  lastEvent: WorkflowEvent | null
): WorkflowRunSummary {
  return {
    ...buildRunSummary(state),
    lastEventMessage: lastEvent?.message ?? null
  };
}
