/**
 * Workflow XML normalizer.
 * Parses workflow XML and produces a strict in-memory WorkflowDefinition,
 * collecting validation issues for IDs, references, loop bounds, duplicate
 * step IDs, and unsupported tags.
 */
import type {
  WorkflowAgentStep,
  WorkflowDecisionChoice,
  WorkflowDecisionStep,
  WorkflowDefinition,
  WorkflowHumanGateStep,
  WorkflowInputDefinition,
  WorkflowLoop,
  WorkflowMergeStep,
  WorkflowStep,
  WorkflowStepBase,
  WorkflowStepKind,
  WorkflowTerminateStatus,
  WorkflowTerminateStep,
  WorkflowValidationIssue,
  WorkflowValidationResult
} from "../types.js";
import {
  findChild,
  findChildren,
  getElementText,
  isElement,
  listElementChildren,
  parseXml,
  XmlSyntaxError,
  type XmlElement
} from "./xml.js";

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const SUPPORTED_STEP_TYPES = new Set<WorkflowStepKind>([
  "agent",
  "decision",
  "human_gate",
  "merge",
  "terminate"
]);
const SUPPORTED_GATE_ACTIONS = new Set([
  "approve",
  "stop",
  "retry",
  "edit",
  "branch"
]);
const SUPPORTED_TERMINATE_STATUS = new Set<WorkflowTerminateStatus>([
  "success",
  "failed",
  "stopped"
]);
const SUPPORTED_LOOP_BOUNDS = ["maxIterations", "maxSteps", "maxRuntimeMinutes"] as const;

interface InternalLoop extends WorkflowLoop {
  startStepId: string;
  endStepId: string;
  childStepIds: string[];
}

export function parseAndValidateWorkflow(
  xmlSource: string
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  let root: XmlElement;
  try {
    root = parseXml(xmlSource);
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      return {
        ok: false,
        definition: null,
        issues: [
          {
            severity: "error",
            message: error.message
          }
        ]
      };
    }
    return {
      ok: false,
      definition: null,
      issues: [
        {
          severity: "error",
          message: `Failed to parse workflow XML: ${(error as Error).message}`
        }
      ]
    };
  }

  if (root.tag !== "workflow") {
    return {
      ok: false,
      definition: null,
      issues: [
        {
          severity: "error",
          message: `Root element must be <workflow>, got <${root.tag}>.`
        }
      ]
    };
  }

  const id = (root.attributes.id ?? "").trim();
  const version = (root.attributes.version ?? "1").trim() || "1";
  if (!id) {
    issues.push({
      severity: "error",
      message: "<workflow> requires an id attribute."
    });
  } else if (!ID_PATTERN.test(id)) {
    issues.push({
      severity: "error",
      message: `Workflow id '${id}' must start with a letter and use only letters, digits, underscore, or hyphen.`
    });
  }

  const descriptionElement = findChild(root, "description");
  const description = descriptionElement
    ? getElementText(descriptionElement).trim() || null
    : null;

  const inputs: WorkflowInputDefinition[] = [];
  const inputNames = new Set<string>();
  for (const inputEl of findChildren(root, "input")) {
    const inputName = (inputEl.attributes.name ?? "").trim();
    if (!inputName) {
      issues.push({
        severity: "error",
        message: "Workflow <input> requires a name."
      });
      continue;
    }
    if (!NAME_PATTERN.test(inputName)) {
      issues.push({
        severity: "error",
        message: `Workflow input name '${inputName}' is invalid.`
      });
      continue;
    }
    if (inputNames.has(inputName)) {
      issues.push({
        severity: "error",
        message: `Workflow input '${inputName}' is declared more than once.`
      });
      continue;
    }
    inputNames.add(inputName);
    const required = !parseBooleanAttribute(inputEl.attributes.optional, false);
    inputs.push({
      name: inputName,
      description: (inputEl.attributes.description ?? "").trim() || null,
      required
    });
  }

  const stepsById = new Map<string, WorkflowStep>();
  const stepOrder: string[] = [];
  const loops: Record<string, WorkflowLoop> = {};
  const outputNames = new Map<string, string>();

  const knownOutputs = new Set<string>();
  for (const input of inputs) {
    knownOutputs.add(`input.${input.name}`);
  }

  const stepBranchTargets: Array<{
    stepId: string;
    referencedStepId: string;
  }> = [];

  for (const child of listElementChildren(root)) {
    if (
      child.tag === "input" ||
      child.tag === "description"
    ) {
      continue;
    }

    if (child.tag === "step") {
      const step = parseStep(child, null, issues);
      if (step) {
        registerStep(step, stepsById, stepOrder, outputNames, knownOutputs, issues);
      }
      continue;
    }

    if (child.tag === "loop") {
      parseLoop(child, null, loops, stepsById, stepOrder, outputNames, knownOutputs, issues);
      continue;
    }

    issues.push({
      severity: "error",
      message: `Unsupported workflow child element <${child.tag}>.`
    });
  }

  if (stepOrder.length === 0) {
    issues.push({
      severity: "error",
      message: "Workflow must declare at least one step."
    });
  }

  collectBranchTargets(stepsById, stepBranchTargets);
  for (const reference of stepBranchTargets) {
    if (!stepsById.has(reference.referencedStepId)) {
      issues.push({
        severity: "error",
        message: `Step '${reference.stepId}' references unknown next step '${reference.referencedStepId}'.`,
        stepId: reference.stepId
      });
    }
  }

  validatePromptReferences(stepsById, knownOutputs, issues);

  const hasError = issues.some((issue) => issue.severity === "error");
  if (hasError) {
    return { ok: false, definition: null, issues };
  }

  const entryStepId = stepOrder[0]!;
  const stepsRecord: Record<string, WorkflowStep> = {};
  for (const [stepId, step] of stepsById) {
    stepsRecord[stepId] = step;
  }

  const definition: WorkflowDefinition = {
    id,
    version,
    description,
    inputs,
    loops,
    steps: stepsRecord,
    stepOrder,
    entryStepId
  };

  return { ok: true, definition, issues };
}

function parseStep(
  element: XmlElement,
  loopId: string | null,
  issues: WorkflowValidationIssue[]
): WorkflowStep | null {
  const stepId = (element.attributes.id ?? "").trim();
  const type = (element.attributes.type ?? "").trim() as WorkflowStepKind;
  if (!stepId) {
    issues.push({
      severity: "error",
      message: `<step> on line ${element.line} requires an id.`
    });
    return null;
  }
  if (!ID_PATTERN.test(stepId)) {
    issues.push({
      severity: "error",
      message: `Step id '${stepId}' is invalid.`,
      stepId
    });
    return null;
  }
  if (!type || !SUPPORTED_STEP_TYPES.has(type)) {
    issues.push({
      severity: "error",
      message: `Step '${stepId}' has unsupported type '${type || "(missing)"}'.`,
      stepId
    });
    return null;
  }

  const base: WorkflowStepBase = {
    id: stepId,
    kind: type,
    loopId
  };

  switch (type) {
    case "agent":
      return parseAgentStep(element, base, issues);
    case "decision":
      return parseDecisionStep(element, base, issues);
    case "human_gate":
      return parseHumanGateStep(element, base, issues);
    case "merge":
      return parseMergeStep(element, base, issues);
    case "terminate":
      return parseTerminateStep(element, base, issues);
    default:
      issues.push({
        severity: "error",
        message: `Step '${stepId}' has unknown type '${type}'.`,
        stepId
      });
      return null;
  }
}

function parseAgentStep(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): WorkflowAgentStep | null {
  const agentId = (element.attributes.agent ?? "").trim();
  if (!agentId) {
    issues.push({
      severity: "error",
      message: `Step '${base.id}' must declare an agent.`,
      stepId: base.id
    });
    return null;
  }
  if (!NAME_PATTERN.test(agentId)) {
    issues.push({
      severity: "error",
      message: `Step '${base.id}' references invalid agent id '${agentId}'.`,
      stepId: base.id
    });
    return null;
  }
  const promptEl = findChild(element, "prompt");
  if (!promptEl) {
    issues.push({
      severity: "error",
      message: `Agent step '${base.id}' requires a <prompt>.`,
      stepId: base.id
    });
    return null;
  }
  const prompt = getElementText(promptEl).trim();
  if (!prompt) {
    issues.push({
      severity: "error",
      message: `Agent step '${base.id}' has an empty prompt.`,
      stepId: base.id
    });
    return null;
  }
  const outputName = parseOutputName(element, base, issues);

  rejectUnknownChildren(
    element,
    new Set(["prompt", "output"]),
    base.id,
    issues
  );

  return {
    ...base,
    kind: "agent",
    agentId,
    prompt,
    outputName
  };
}

function parseDecisionStep(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): WorkflowDecisionStep | null {
  const agentId = (element.attributes.agent ?? "").trim();
  if (!agentId) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' must declare an agent.`,
      stepId: base.id
    });
    return null;
  }
  if (!NAME_PATTERN.test(agentId)) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' references invalid agent id '${agentId}'.`,
      stepId: base.id
    });
    return null;
  }
  const promptEl = findChild(element, "prompt");
  if (!promptEl) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' requires a <prompt>.`,
      stepId: base.id
    });
    return null;
  }
  const prompt = getElementText(promptEl).trim();
  if (!prompt) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' has an empty prompt.`,
      stepId: base.id
    });
    return null;
  }
  const outputName = parseOutputName(element, base, issues);
  const onInvalidAttr = (element.attributes.onInvalid ?? "pause").trim();
  if (onInvalidAttr !== "pause" && onInvalidAttr !== "fail") {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' has invalid onInvalid='${onInvalidAttr}', expected 'pause' or 'fail'.`,
      stepId: base.id
    });
    return null;
  }
  const onInvalid = onInvalidAttr as "pause" | "fail";

  const choicesEl = findChild(element, "choices");
  if (!choicesEl) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' requires a <choices> block.`,
      stepId: base.id
    });
    return null;
  }

  const choices: WorkflowDecisionChoice[] = [];
  const choiceNames = new Set<string>();
  for (const child of listElementChildren(choicesEl)) {
    if (child.tag !== "choice") {
      issues.push({
        severity: "error",
        message: `<choices> in step '${base.id}' contains unsupported child <${child.tag}>.`,
        stepId: base.id
      });
      continue;
    }
    const name = (child.attributes.name ?? "").trim();
    if (!name) {
      issues.push({
        severity: "error",
        message: `Choice in step '${base.id}' is missing name.`,
        stepId: base.id
      });
      continue;
    }
    if (choiceNames.has(name)) {
      issues.push({
        severity: "error",
        message: `Choice '${name}' in step '${base.id}' is declared more than once.`,
        stepId: base.id
      });
      continue;
    }
    choiceNames.add(name);
    const next = (child.attributes.next ?? "").trim() || null;
    const terminateAttr = (child.attributes.terminate ?? "").trim();
    const gateAttr = (child.attributes.gate ?? "").trim();
    let terminate: WorkflowTerminateStatus | null = null;
    if (terminateAttr) {
      if (!SUPPORTED_TERMINATE_STATUS.has(terminateAttr as WorkflowTerminateStatus)) {
        issues.push({
          severity: "error",
          message: `Choice '${name}' in step '${base.id}' has invalid terminate='${terminateAttr}'.`,
          stepId: base.id
        });
        continue;
      }
      terminate = terminateAttr as WorkflowTerminateStatus;
    }
    let gate: "human" | null = null;
    if (gateAttr) {
      if (gateAttr !== "human") {
        issues.push({
          severity: "error",
          message: `Choice '${name}' in step '${base.id}' has invalid gate='${gateAttr}'.`,
          stepId: base.id
        });
        continue;
      }
      gate = "human";
    }
    const declaredTargets = [next, terminate, gate].filter(Boolean).length;
    if (declaredTargets !== 1) {
      issues.push({
        severity: "error",
        message: `Choice '${name}' in step '${base.id}' must set exactly one of next, terminate, or gate.`,
        stepId: base.id
      });
      continue;
    }
    choices.push({
      name,
      next,
      terminate,
      gate
    });
  }

  if (choices.length === 0) {
    issues.push({
      severity: "error",
      message: `Decision step '${base.id}' must declare at least one choice.`,
      stepId: base.id
    });
    return null;
  }

  rejectUnknownChildren(
    element,
    new Set(["prompt", "output", "choices"]),
    base.id,
    issues
  );

  return {
    ...base,
    kind: "decision",
    agentId,
    prompt,
    outputName,
    choices,
    onInvalid
  };
}

function parseHumanGateStep(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): WorkflowHumanGateStep | null {
  const promptEl = findChild(element, "prompt");
  const prompt = promptEl ? getElementText(promptEl).trim() : "";
  if (!prompt) {
    issues.push({
      severity: "error",
      message: `Human gate '${base.id}' requires a non-empty <prompt>.`,
      stepId: base.id
    });
    return null;
  }
  const allowAttr = (element.attributes.allow ?? "approve,stop").trim();
  const allowRaw = allowAttr
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allow: WorkflowHumanGateStep["allow"] = [];
  for (const value of allowRaw) {
    if (!SUPPORTED_GATE_ACTIONS.has(value)) {
      issues.push({
        severity: "error",
        message: `Human gate '${base.id}' has unsupported allow value '${value}'.`,
        stepId: base.id
      });
      continue;
    }
    if (!allow.includes(value as WorkflowHumanGateStep["allow"][number])) {
      allow.push(value as WorkflowHumanGateStep["allow"][number]);
    }
  }
  if (allow.length === 0) {
    issues.push({
      severity: "error",
      message: `Human gate '${base.id}' must allow at least one action.`,
      stepId: base.id
    });
    return null;
  }
  rejectUnknownChildren(element, new Set(["prompt"]), base.id, issues);
  return {
    ...base,
    kind: "human_gate",
    prompt,
    allow
  };
}

function parseMergeStep(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): WorkflowMergeStep | null {
  const inputs: string[] = [];
  for (const child of findChildren(element, "input")) {
    const name = (child.attributes.name ?? "").trim();
    if (!name) {
      issues.push({
        severity: "error",
        message: `Merge step '${base.id}' has an <input> with no name.`,
        stepId: base.id
      });
      continue;
    }
    inputs.push(name);
  }
  if (inputs.length === 0) {
    issues.push({
      severity: "error",
      message: `Merge step '${base.id}' must declare at least one <input>.`,
      stepId: base.id
    });
    return null;
  }
  const outputName = parseOutputName(element, base, issues);
  if (!outputName) {
    issues.push({
      severity: "error",
      message: `Merge step '${base.id}' requires <output name="..." />.`,
      stepId: base.id
    });
    return null;
  }
  const separator = element.attributes.separator ?? "\n\n";
  rejectUnknownChildren(element, new Set(["input", "output"]), base.id, issues);
  return {
    ...base,
    kind: "merge",
    inputs,
    outputName,
    separator
  };
}

function parseTerminateStep(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): WorkflowTerminateStep | null {
  const statusAttr = (element.attributes.status ?? "success").trim();
  if (!SUPPORTED_TERMINATE_STATUS.has(statusAttr as WorkflowTerminateStatus)) {
    issues.push({
      severity: "error",
      message: `Terminate step '${base.id}' has invalid status='${statusAttr}'.`,
      stepId: base.id
    });
    return null;
  }
  const messageEl = findChild(element, "message");
  const message = messageEl ? getElementText(messageEl).trim() || null : null;
  rejectUnknownChildren(element, new Set(["message"]), base.id, issues);
  return {
    ...base,
    kind: "terminate",
    status: statusAttr as WorkflowTerminateStatus,
    message
  };
}

function parseOutputName(
  element: XmlElement,
  base: WorkflowStepBase,
  issues: WorkflowValidationIssue[]
): string | null {
  const outputEl = findChild(element, "output");
  if (!outputEl) {
    return null;
  }
  const name = (outputEl.attributes.name ?? "").trim();
  if (!name) {
    issues.push({
      severity: "error",
      message: `Step '${base.id}' <output> is missing a name attribute.`,
      stepId: base.id
    });
    return null;
  }
  if (!NAME_PATTERN.test(name)) {
    issues.push({
      severity: "error",
      message: `Step '${base.id}' output name '${name}' is invalid.`,
      stepId: base.id
    });
    return null;
  }
  return name;
}

function parseLoop(
  element: XmlElement,
  parentLoopId: string | null,
  loops: Record<string, WorkflowLoop>,
  stepsById: Map<string, WorkflowStep>,
  stepOrder: string[],
  outputNames: Map<string, string>,
  knownOutputs: Set<string>,
  issues: WorkflowValidationIssue[]
): void {
  const loopId = (element.attributes.id ?? "").trim();
  if (!loopId) {
    issues.push({
      severity: "error",
      message: `<loop> on line ${element.line} requires an id.`
    });
    return;
  }
  if (!ID_PATTERN.test(loopId)) {
    issues.push({
      severity: "error",
      message: `Loop id '${loopId}' is invalid.`,
      loopId
    });
    return;
  }
  if (loops[loopId]) {
    issues.push({
      severity: "error",
      message: `Loop id '${loopId}' is declared more than once.`,
      loopId
    });
    return;
  }
  const bounds = parseLoopBounds(element, loopId, issues);
  if (!bounds) {
    return;
  }

  const childStepIds: string[] = [];
  for (const child of listElementChildren(element)) {
    if (child.tag === "step") {
      const step = parseStep(child, loopId, issues);
      if (step) {
        if (registerStep(step, stepsById, stepOrder, outputNames, knownOutputs, issues)) {
          childStepIds.push(step.id);
        }
      }
      continue;
    }
    issues.push({
      severity: "error",
      message: `Loop '${loopId}' contains unsupported child <${child.tag}>.`,
      loopId
    });
  }

  if (childStepIds.length === 0) {
    issues.push({
      severity: "error",
      message: `Loop '${loopId}' must contain at least one step.`,
      loopId
    });
    return;
  }

  const loop: InternalLoop = {
    id: loopId,
    parentLoopId,
    maxIterations: bounds.maxIterations,
    maxSteps: bounds.maxSteps,
    maxRuntimeMinutes: bounds.maxRuntimeMinutes,
    startStepId: childStepIds[0]!,
    endStepId: childStepIds[childStepIds.length - 1]!,
    childStepIds
  };
  loops[loopId] = loop;
}

function parseLoopBounds(
  element: XmlElement,
  loopId: string,
  issues: WorkflowValidationIssue[]
): {
  maxIterations: number | null;
  maxSteps: number | null;
  maxRuntimeMinutes: number | null;
} | null {
  let bounded = false;
  let maxIterations: number | null = null;
  let maxSteps: number | null = null;
  let maxRuntimeMinutes: number | null = null;

  for (const attribute of SUPPORTED_LOOP_BOUNDS) {
    const raw = element.attributes[attribute];
    if (raw === undefined) {
      continue;
    }
    const value = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({
        severity: "error",
        message: `Loop '${loopId}' has invalid ${attribute}='${raw}'.`,
        loopId
      });
      return null;
    }
    bounded = true;
    if (attribute === "maxIterations") {
      maxIterations = value;
    } else if (attribute === "maxSteps") {
      maxSteps = value;
    } else if (attribute === "maxRuntimeMinutes") {
      maxRuntimeMinutes = value;
    }
  }

  if (!bounded) {
    issues.push({
      severity: "error",
      message: `Loop '${loopId}' must declare maxIterations, maxSteps, or maxRuntimeMinutes.`,
      loopId
    });
    return null;
  }

  return { maxIterations, maxSteps, maxRuntimeMinutes };
}

function registerStep(
  step: WorkflowStep,
  stepsById: Map<string, WorkflowStep>,
  stepOrder: string[],
  outputNames: Map<string, string>,
  knownOutputs: Set<string>,
  issues: WorkflowValidationIssue[]
): boolean {
  if (stepsById.has(step.id)) {
    issues.push({
      severity: "error",
      message: `Step id '${step.id}' is declared more than once.`,
      stepId: step.id
    });
    return false;
  }
  stepsById.set(step.id, step);
  stepOrder.push(step.id);
  knownOutputs.add(`${step.id}.output`);
  const named = stepHasOutputName(step) ? step.outputName : null;
  if (named) {
    const existing = outputNames.get(named);
    if (existing && existing !== step.id) {
      issues.push({
        severity: "error",
        message: `Output name '${named}' from step '${step.id}' is already produced by step '${existing}'.`,
        stepId: step.id
      });
    } else {
      outputNames.set(named, step.id);
      knownOutputs.add(named);
    }
  }
  return true;
}

function stepHasOutputName(
  step: WorkflowStep
): step is WorkflowAgentStep | WorkflowDecisionStep | WorkflowMergeStep {
  return (
    step.kind === "agent" ||
    step.kind === "decision" ||
    step.kind === "merge"
  );
}

function collectBranchTargets(
  stepsById: Map<string, WorkflowStep>,
  targets: Array<{ stepId: string; referencedStepId: string }>
): void {
  for (const step of stepsById.values()) {
    if (step.kind === "decision") {
      for (const choice of step.choices) {
        if (choice.next) {
          targets.push({ stepId: step.id, referencedStepId: choice.next });
        }
      }
    }
  }
}

function validatePromptReferences(
  stepsById: Map<string, WorkflowStep>,
  knownOutputs: Set<string>,
  issues: WorkflowValidationIssue[]
): void {
  const variablePattern = /\$\{([^}]+)\}/g;
  for (const step of stepsById.values()) {
    if (step.kind !== "agent" && step.kind !== "decision") {
      continue;
    }
    const prompt = step.prompt;
    let match: RegExpExecArray | null;
    variablePattern.lastIndex = 0;
    while ((match = variablePattern.exec(prompt)) !== null) {
      const expression = match[1].trim();
      if (!expression) {
        issues.push({
          severity: "error",
          message: `Step '${step.id}' has empty \${} reference in prompt.`,
          stepId: step.id
        });
        continue;
      }
      if (
        !knownOutputs.has(expression) &&
        !knownOutputs.has(toCanonicalReference(expression))
      ) {
        issues.push({
          severity: "warning",
          message: `Step '${step.id}' prompt references unknown value '\${${expression}}'.`,
          stepId: step.id
        });
      }
    }
  }
}

function toCanonicalReference(expression: string): string {
  // Normalize `step_id.output` and `input.name` references.
  return expression;
}

function parseBooleanAttribute(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function rejectUnknownChildren(
  element: XmlElement,
  allowed: Set<string>,
  stepId: string,
  issues: WorkflowValidationIssue[]
): void {
  for (const child of element.children) {
    if (!isElement(child)) {
      continue;
    }
    if (!allowed.has(child.tag)) {
      issues.push({
        severity: "error",
        message: `Step '${stepId}' contains unsupported child <${child.tag}>.`,
        stepId
      });
    }
  }
}
