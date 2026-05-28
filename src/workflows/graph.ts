/**
 * Workflow graph extractor.
 * Turns a parsed WorkflowDefinition (plus optional run status) into a
 * normalized node/edge graph for the web client. Keeps node and edge ids
 * stable across reloads so client-side layouts can be deterministic.
 */
import type {
  ProjectState,
  WorkflowDecisionStep,
  WorkflowDefinition,
  WorkflowLoop,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowValidationIssue
} from "../types.js";
import type {
  WebWorkflowGraph,
  WebWorkflowGraphAgent,
  WebWorkflowGraphEdge,
  WebWorkflowGraphEdgeKind,
  WebWorkflowGraphLoop,
  WebWorkflowGraphNode,
  WebWorkflowGraphNodeKind,
  WebWorkflowGraphNodeStatus,
  WebWorkflowValidationIssue,
  WebProviderInfo
} from "../web/shared/types.js";

export const INPUT_NODE_ID = "__input";

export interface GraphExtractionOptions {
  status?: WorkflowRunStatus | null;
  project?: ProjectState | null;
}

export function extractWorkflowGraph(
  workflowId: string,
  definition: WorkflowDefinition,
  issues: WorkflowValidationIssue[],
  options: GraphExtractionOptions = {}
): WebWorkflowGraph {
  const status = options.status ?? null;
  const project = options.project ?? null;
  const nodes: WebWorkflowGraphNode[] = [];
  const edges: WebWorkflowGraphEdge[] = [];

  if (definition.inputs.length > 0) {
    const inputLabels = definition.inputs
      .map((input) => input.name + (input.required ? "" : "?"))
      .join(", ");
    nodes.push({
      id: INPUT_NODE_ID,
      kind: "input",
      label: "Inputs",
      subtitle: inputLabels || null,
      agent: null,
      loopId: null,
      status: "idle"
    });
    if (definition.entryStepId) {
      edges.push({
        id: edgeId(INPUT_NODE_ID, definition.entryStepId, "sequence"),
        source: INPUT_NODE_ID,
        target: definition.entryStepId,
        kind: "sequence",
        label: null
      });
    }
  }

  for (const stepId of definition.stepOrder) {
    const step = definition.steps[stepId];
    if (!step) continue;
    nodes.push(buildStepNode(step, definition, status, project));
  }

  // Sequence edges within stepOrder, respecting loop containment.
  for (let i = 0; i < definition.stepOrder.length - 1; i += 1) {
    const currentId = definition.stepOrder[i]!;
    const nextId = definition.stepOrder[i + 1]!;
    const current = definition.steps[currentId];
    const next = definition.steps[nextId];
    if (!current || !next) continue;
    if (current.kind === "terminate") continue;
    if (current.kind === "decision") continue;
    // Crossing loop boundary triggers a loop-back edge instead of plain sequence
    // when the current step is the last step of a loop and next is outside.
    edges.push({
      id: edgeId(currentId, nextId, "sequence"),
      source: currentId,
      target: nextId,
      kind: "sequence",
      label: null
    });
  }

  // Loop-back edges: each loop's last step flows back to its first step
  // unless the last step is a decision/terminate (which encode their own flow).
  for (const loop of Object.values(definition.loops)) {
    if (!loop.childStepIds.length) continue;
    const last = definition.steps[loop.endStepId];
    if (!last) continue;
    if (last.kind === "terminate" || last.kind === "decision") {
      continue;
    }
    edges.push({
      id: edgeId(loop.endStepId, loop.startStepId, "loop"),
      source: loop.endStepId,
      target: loop.startStepId,
      kind: "loop",
      label: `loop ${loop.id}`
    });
  }

  // Decision branches.
  for (const step of Object.values(definition.steps)) {
    if (step.kind !== "decision") continue;
    addDecisionEdges(step, definition, edges);
  }

  const loops = Object.values(definition.loops).map(toGraphLoop);

  return {
    workflowId,
    version: definition.version,
    description: definition.description,
    nodes,
    edges,
    loops,
    validation: issues.map(toIssueDto)
  };
}

function addDecisionEdges(
  step: WorkflowDecisionStep,
  definition: WorkflowDefinition,
  edges: WebWorkflowGraphEdge[]
): void {
  for (const choice of step.choices) {
    if (choice.next) {
      const inLoop = step.loopId && definition.steps[choice.next]?.loopId === step.loopId;
      const kind: WebWorkflowGraphEdgeKind = inLoop && isBackwardEdge(step.id, choice.next, definition)
        ? "loop"
        : "choice";
      edges.push({
        id: edgeId(step.id, choice.next, kind, choice.name),
        source: step.id,
        target: choice.next,
        kind,
        label: choice.name
      });
      continue;
    }
    if (choice.gate === "human") {
      // No real target; render as a self-loop labelled "human gate" so users see it.
      edges.push({
        id: edgeId(step.id, step.id, "gate", choice.name),
        source: step.id,
        target: step.id,
        kind: "gate",
        label: choice.name
      });
      continue;
    }
    // terminate or unresolved choices have no edge to add.
  }
}

function isBackwardEdge(
  sourceId: string,
  targetId: string,
  definition: WorkflowDefinition
): boolean {
  const sourceIndex = definition.stepOrder.indexOf(sourceId);
  const targetIndex = definition.stepOrder.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return false;
  return targetIndex <= sourceIndex;
}

function buildStepNode(
  step: WorkflowStep,
  definition: WorkflowDefinition,
  status: WorkflowRunStatus | null,
  project: ProjectState | null
): WebWorkflowGraphNode {
  const kind: WebWorkflowGraphNodeKind = stepKindToNodeKind(step.kind);
  let agent: WebWorkflowGraphAgent | null = null;
  if (step.kind === "agent" || step.kind === "decision") {
    agent = resolveAgent(step.agentId, project);
  }
  return {
    id: step.id,
    kind,
    label: step.id,
    subtitle: buildStepSubtitle(step, definition),
    agent,
    loopId: step.loopId,
    status: stepStatus(step.id, status)
  };
}

function stepKindToNodeKind(kind: WorkflowStepKind): WebWorkflowGraphNodeKind {
  return kind;
}

function buildStepSubtitle(
  step: WorkflowStep,
  definition: WorkflowDefinition
): string | null {
  switch (step.kind) {
    case "agent":
      return `agent · ${step.agentId}`;
    case "decision": {
      const branchNames = step.choices.map((choice) => choice.name).join(", ");
      return `decision · ${step.agentId}${branchNames ? ` · ${branchNames}` : ""}`;
    }
    case "human_gate":
      return `human gate · ${step.allow.join(", ")}`;
    case "merge":
      return `merge · ${step.inputs.join(", ")}`;
    case "terminate":
      return `terminate · ${step.status}`;
    default: {
      void definition;
      return null;
    }
  }
}

function resolveAgent(
  agentId: string,
  project: ProjectState | null
): WebWorkflowGraphAgent {
  if (!project) {
    return { id: agentId, provider: null, missing: false };
  }
  const agent = project.agents[agentId];
  if (!agent) {
    return { id: agentId, provider: null, missing: true };
  }
  const provider: WebProviderInfo = {
    name: agent.provider.name,
    model: agent.provider.model,
    authMode: agent.provider.authMode ?? "",
    reasoningEffort: agent.provider.reasoningEffort ?? null
  };
  return { id: agentId, provider, missing: false };
}

function stepStatus(
  stepId: string,
  status: WorkflowRunStatus | null
): WebWorkflowGraphNodeStatus {
  if (!status) return "idle";
  if (status.currentStepId !== stepId) {
    if (status.status === "complete") return "complete";
    return "idle";
  }
  switch (status.status) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "complete":
      return "complete";
    case "queued":
      return "queued";
    default:
      return "idle";
  }
}

function toGraphLoop(loop: WorkflowLoop): WebWorkflowGraphLoop {
  return {
    id: loop.id,
    parentLoopId: loop.parentLoopId,
    childStepIds: [...loop.childStepIds],
    maxIterations: loop.maxIterations,
    maxSteps: loop.maxSteps,
    maxRuntimeMinutes: loop.maxRuntimeMinutes
  };
}

function toIssueDto(issue: WorkflowValidationIssue): WebWorkflowValidationIssue {
  return {
    severity: issue.severity,
    message: issue.message,
    stepId: issue.stepId ?? null,
    loopId: issue.loopId ?? null
  };
}

function edgeId(
  source: string,
  target: string,
  kind: WebWorkflowGraphEdgeKind,
  suffix?: string
): string {
  const safeSuffix = suffix ? `:${suffix}` : "";
  return `${kind}:${source}->${target}${safeSuffix}`;
}
