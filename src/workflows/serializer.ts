/**
 * Workflow XML serializer.
 * Inverse of parseAndValidateWorkflow. Emits canonical XML that the parser can
 * read back without semantic drift. Whitespace formatting is normalized; ids,
 * attributes, and references are preserved verbatim.
 */
import type {
  WorkflowAgentStep,
  WorkflowDecisionStep,
  WorkflowDefinition,
  WorkflowHumanGateStep,
  WorkflowLoop,
  WorkflowMergeStep,
  WorkflowTerminateStep
} from "../types.js";

const INDENT = "  ";

export function serializeWorkflow(definition: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(
    `<workflow id="${escapeAttr(definition.id)}" version="${escapeAttr(definition.version)}">`
  );
  if (definition.description) {
    lines.push(
      `${INDENT}<description>${escapeText(definition.description)}</description>`
    );
  }
  for (const input of definition.inputs) {
    const attrs: string[] = [`name="${escapeAttr(input.name)}"`];
    if (input.description) {
      attrs.push(`description="${escapeAttr(input.description)}"`);
    }
    if (!input.required) {
      attrs.push(`optional="true"`);
    }
    lines.push(`${INDENT}<input ${attrs.join(" ")} />`);
  }

  const groups = groupByLoop(definition);
  for (const group of groups) {
    if (group.kind === "step") {
      lines.push(...serializeStep(definition, group.stepId, 1));
    } else {
      lines.push(...serializeLoop(definition, group.loop, 1));
    }
  }

  lines.push(`</workflow>`);
  return `${lines.join("\n")}\n`;
}

interface FlatGroup {
  kind: "step";
  stepId: string;
}
interface LoopGroup {
  kind: "loop";
  loop: WorkflowLoop;
}
type Group = FlatGroup | LoopGroup;

function groupByLoop(definition: WorkflowDefinition): Group[] {
  const groups: Group[] = [];
  const emittedLoops = new Set<string>();
  for (const stepId of definition.stepOrder) {
    const step = definition.steps[stepId];
    if (!step) continue;
    if (!step.loopId) {
      groups.push({ kind: "step", stepId });
      continue;
    }
    if (emittedLoops.has(step.loopId)) continue;
    const loop = definition.loops[step.loopId];
    if (!loop) {
      groups.push({ kind: "step", stepId });
      continue;
    }
    emittedLoops.add(loop.id);
    groups.push({ kind: "loop", loop });
  }
  return groups;
}

function serializeLoop(
  definition: WorkflowDefinition,
  loop: WorkflowLoop,
  depth: number
): string[] {
  const pad = INDENT.repeat(depth);
  const attrs: string[] = [`id="${escapeAttr(loop.id)}"`];
  if (loop.maxIterations != null) {
    attrs.push(`maxIterations="${loop.maxIterations}"`);
  }
  if (loop.maxSteps != null) {
    attrs.push(`maxSteps="${loop.maxSteps}"`);
  }
  if (loop.maxRuntimeMinutes != null) {
    attrs.push(`maxRuntimeMinutes="${loop.maxRuntimeMinutes}"`);
  }
  const lines: string[] = [`${pad}<loop ${attrs.join(" ")}>`];
  for (const childId of loop.childStepIds) {
    lines.push(...serializeStep(definition, childId, depth + 1));
  }
  lines.push(`${pad}</loop>`);
  return lines;
}

function serializeStep(
  definition: WorkflowDefinition,
  stepId: string,
  depth: number
): string[] {
  const step = definition.steps[stepId];
  if (!step) return [];
  switch (step.kind) {
    case "agent":
      return serializeAgentStep(step, depth);
    case "decision":
      return serializeDecisionStep(step, depth);
    case "human_gate":
      return serializeHumanGateStep(step, depth);
    case "merge":
      return serializeMergeStep(step, depth);
    case "terminate":
      return serializeTerminateStep(step, depth);
    default: {
      const exhaustive: never = step;
      void exhaustive;
      return [];
    }
  }
}

function serializeAgentStep(step: WorkflowAgentStep, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const lines: string[] = [];
  lines.push(
    `${pad}<step id="${escapeAttr(step.id)}" type="agent" agent="${escapeAttr(step.agentId)}">`
  );
  lines.push(`${inner}<prompt>${escapeText(step.prompt)}</prompt>`);
  if (step.outputName) {
    lines.push(`${inner}<output name="${escapeAttr(step.outputName)}" />`);
  }
  lines.push(`${pad}</step>`);
  return lines;
}

function serializeDecisionStep(
  step: WorkflowDecisionStep,
  depth: number
): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const innerInner = INDENT.repeat(depth + 2);
  const lines: string[] = [];
  const attrs: string[] = [
    `id="${escapeAttr(step.id)}"`,
    `type="decision"`,
    `agent="${escapeAttr(step.agentId)}"`
  ];
  if (step.onInvalid && step.onInvalid !== "pause") {
    attrs.push(`onInvalid="${escapeAttr(step.onInvalid)}"`);
  }
  lines.push(`${pad}<step ${attrs.join(" ")}>`);
  lines.push(`${inner}<prompt>${escapeText(step.prompt)}</prompt>`);
  if (step.outputName) {
    lines.push(`${inner}<output name="${escapeAttr(step.outputName)}" />`);
  }
  lines.push(`${inner}<choices>`);
  for (const choice of step.choices) {
    const choiceAttrs: string[] = [`name="${escapeAttr(choice.name)}"`];
    if (choice.next) choiceAttrs.push(`next="${escapeAttr(choice.next)}"`);
    if (choice.terminate)
      choiceAttrs.push(`terminate="${escapeAttr(choice.terminate)}"`);
    if (choice.gate) choiceAttrs.push(`gate="${escapeAttr(choice.gate)}"`);
    lines.push(`${innerInner}<choice ${choiceAttrs.join(" ")} />`);
  }
  lines.push(`${inner}</choices>`);
  lines.push(`${pad}</step>`);
  return lines;
}

function serializeHumanGateStep(
  step: WorkflowHumanGateStep,
  depth: number
): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const allow = step.allow.join(",");
  return [
    `${pad}<step id="${escapeAttr(step.id)}" type="human_gate" allow="${escapeAttr(allow)}">`,
    `${inner}<prompt>${escapeText(step.prompt)}</prompt>`,
    `${pad}</step>`
  ];
}

function serializeMergeStep(step: WorkflowMergeStep, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const attrs: string[] = [`id="${escapeAttr(step.id)}"`, `type="merge"`];
  if (step.separator && step.separator !== "\n\n") {
    attrs.push(`separator="${escapeAttr(step.separator)}"`);
  }
  const lines: string[] = [`${pad}<step ${attrs.join(" ")}>`];
  for (const inputName of step.inputs) {
    lines.push(`${inner}<input name="${escapeAttr(inputName)}" />`);
  }
  lines.push(`${inner}<output name="${escapeAttr(step.outputName)}" />`);
  lines.push(`${pad}</step>`);
  return lines;
}

function serializeTerminateStep(
  step: WorkflowTerminateStep,
  depth: number
): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const lines: string[] = [
    `${pad}<step id="${escapeAttr(step.id)}" type="terminate" status="${escapeAttr(step.status)}">`
  ];
  if (step.message) {
    lines.push(`${inner}<message>${escapeText(step.message)}</message>`);
  }
  lines.push(`${pad}</step>`);
  return lines;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
