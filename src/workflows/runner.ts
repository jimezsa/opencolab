/**
 * Sequential workflow runner.
 * Drives one workflow run at a time, persisting state, status, events, and
 * per-step files. Holds no shared global state; the runtime owns scheduling
 * and the live registry, while this class owns step-by-step execution.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenColabConfig } from "../config.js";
import type {
  ProviderAgentInput,
  ProviderRespondOptions
} from "../provider-agent.js";
import type {
  AgentConfig,
  ProjectState,
  TaskProgressEvent,
  WorkflowAgentStep,
  WorkflowDecisionChoice,
  WorkflowDecisionStep,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventKind,
  WorkflowHumanGateStep,
  WorkflowMergeStep,
  WorkflowRunPhase,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowStepRecord,
  WorkflowTerminateStep
} from "../types.js";
import { ensureDir, nowIso } from "../utils.js";
import {
  appendRunEvent,
  buildDecisionPath,
  createInitialRunState,
  ensureInputDir,
  ensureStepDir,
  newRunId,
  stepIdentifier,
  writeDecisionXml,
  writeRunState,
  writeRunStatus,
  writeStepMeta
} from "./storage.js";

const PHASE_FOR_KIND: Record<WorkflowStepKind, WorkflowRunPhase> = {
  agent: "running_agent",
  decision: "running_agent",
  human_gate: "waiting_for_human",
  merge: "writing_outputs",
  terminate: "completed"
};

export type WorkflowAgentResponder = (
  project: ProjectState,
  agent: AgentConfig,
  input: ProviderAgentInput,
  options?: ProviderRespondOptions
) => Promise<string>;

export interface WorkflowRunCallbacks {
  onStatusUpdate?: (status: WorkflowRunStatus) => void | Promise<void>;
  onEvent?: (event: WorkflowEvent) => void | Promise<void>;
  onProgress?: (event: TaskProgressEvent) => void | Promise<void>;
}

export interface WorkflowExecuteOptions {
  signal?: AbortSignal;
  callbacks?: WorkflowRunCallbacks;
}

export interface WorkflowStartInputDescriptor {
  workflowId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, string>;
  initiator: string;
  runId?: string;
}

export class WorkflowRunner {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly project: ProjectState,
    private readonly agentResponder: WorkflowAgentResponder
  ) {}

  initRun(input: WorkflowStartInputDescriptor): WorkflowRunState {
    const runId = input.runId ?? newRunId();
    const state = createInitialRunState({
      workflowId: input.workflowId,
      projectId: this.project.id,
      runId,
      initiator: input.initiator,
      inputs: input.inputs,
      entryStepId: input.definition.entryStepId
    });
    writeRunState(this.config, this.project, input.workflowId, state);
    this.writeInputs(input.workflowId, runId, input.inputs);
    const status: WorkflowRunStatus = buildStatus(
      state,
      input.definition,
      "validating",
      null
    );
    writeRunStatus(this.config, this.project, input.workflowId, status);
    this.appendEvent(input.workflowId, runId, {
      at: nowIso(),
      kind: "run_started",
      message: `Workflow ${input.workflowId} run ${runId} created.`
    });
    return state;
  }

  async execute(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions = {}
  ): Promise<WorkflowRunState> {
    let current = transitionState(state, {
      status: "running",
      startedAt: state.startedAt ?? nowIso()
    });
    this.persist(current, definition, "preparing_input", null);
    await this.emitStatus(current, definition, "preparing_input", options.callbacks);

    while (true) {
      if (options.signal?.aborted || current.stopRequested) {
        current = this.markStopped(current, definition, options.callbacks);
        return current;
      }

      const stepId = current.nextStepId;
      if (!stepId) {
        current = this.markCompleted(current, definition, options.callbacks);
        return current;
      }

      const step = definition.steps[stepId];
      if (!step) {
        const message = `Step '${stepId}' is not defined in workflow ${definition.id}.`;
        current = this.markFailed(current, definition, message, options.callbacks);
        return current;
      }

      const { iteration, loopIterations } = computeIteration(current, step, definition);
      current = transitionState(current, {
        currentStepId: step.id,
        iteration,
        loopIterations
      });

      const loopViolation = enforceLoopBounds(current, step, definition);
      if (loopViolation) {
        await this.handleLoopBoundExceeded(
          current,
          definition,
          step,
          loopViolation,
          options.callbacks
        );
        current = this.markFailed(current, definition, loopViolation, options.callbacks);
        return current;
      }

      const phase = PHASE_FOR_KIND[step.kind];
      current = transitionState(current, {
        currentStepId: step.id
      });
      this.persist(current, definition, phase, null);
      await this.emitStatus(current, definition, phase, options.callbacks);
      await this.recordEvent(current.workflowId, current.runId, {
        at: nowIso(),
        kind: "step_started",
        message: `Step '${step.id}' (${step.kind}) started.`,
        stepId: step.id,
        agentId: stepAgentId(step) ?? undefined,
        iteration
      }, options.callbacks);

      const handlerResult = await this.runStep(
        current,
        step,
        iteration,
        definition,
        options
      );
      current = handlerResult.state;
      if (handlerResult.terminate) {
        return current;
      }
      if (handlerResult.pause) {
        return current;
      }
    }
  }

  private async runStep(
    state: WorkflowRunState,
    step: WorkflowStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    switch (step.kind) {
      case "agent":
        return this.runAgentStep(state, step, iteration, definition, options);
      case "decision":
        return this.runDecisionStep(state, step, iteration, definition, options);
      case "human_gate":
        return this.runHumanGateStep(state, step, iteration, definition, options);
      case "merge":
        return this.runMergeStep(state, step, iteration, definition, options);
      case "terminate":
        return this.runTerminateStep(state, step, iteration, definition, options);
      default: {
        const exhaustive: never = step;
        void exhaustive;
        const message = `Unsupported step kind in step '${(step as WorkflowStep).id}'.`;
        const failed = this.markFailed(state, definition, message, options.callbacks);
        return { state: failed, terminate: true, pause: false };
      }
    }
  }

  private async runAgentStep(
    state: WorkflowRunState,
    step: WorkflowAgentStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    const agent = this.project.agents[step.agentId];
    if (!agent) {
      const message = `Agent '${step.agentId}' is not configured in project '${this.project.id}'.`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    const stepDir = ensureStepDir(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    const prompt = resolveTemplate(step.prompt, state);
    fs.writeFileSync(path.join(stepDir, "input.md"), prompt, "utf8");
    await this.emitProgress(options.callbacks, {
      kind: "milestone",
      message: `Agent ${agent.id} starting step '${step.id}' (iteration ${iteration}).`,
      stage: step.id
    });
    await this.recordEvent(state.workflowId, state.runId, {
      at: nowIso(),
      kind: "agent_started",
      message: `Agent '${agent.id}' starting step '${step.id}'.`,
      stepId: step.id,
      agentId: agent.id,
      iteration
    }, options.callbacks);
    const startedAt = nowIso();
    const startedAtMs = Date.now();
    let response: string;
    try {
      response = await this.agentResponder(
        this.project,
        agent,
        {
          chatId: "",
          sender: `workflow:${state.workflowId}:${state.runId}:${step.id}`,
          text: prompt,
          files: [],
          memory: { workingMemory: [], previousDaySummary: "" }
        },
        {
          signal: options.signal,
          onProgress: async (event) => {
            await this.emitProgress(options.callbacks, event);
          }
        }
      );
    } catch (error) {
      if (options.signal?.aborted || state.stopRequested) {
        const stopped = this.markStopped(state, definition, options.callbacks);
        return { state: stopped, terminate: true, pause: false };
      }
      const message = `Agent '${agent.id}' failed for step '${step.id}': ${(error as Error).message}`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    fs.writeFileSync(path.join(stepDir, "output.md"), response, "utf8");
    const finishedAt = nowIso();
    const durationMs = Date.now() - startedAtMs;
    const outputValue = response.trim();
    const updatedValues = { ...state.values, [`${step.id}.output`]: outputValue };
    if (step.outputName) {
      updatedValues[step.outputName] = outputValue;
    }
    const record: WorkflowStepRecord = {
      stepId: step.id,
      kind: "agent",
      agentId: agent.id,
      iteration,
      startedAt,
      finishedAt,
      outputName: step.outputName,
      promptPath: path.join(stepDir, "input.md"),
      outputPath: path.join(stepDir, "output.md"),
      decisionPath: null,
      metaPath: path.join(stepDir, "meta.json"),
      decisionAction: null,
      decisionChoice: null,
      durationMs
    };
    writeStepMeta(stepDir, {
      stepId: step.id,
      iteration,
      startedAt,
      finishedAt,
      agentId: agent.id,
      decision: null
    });
    let next = transitionState(state, {
      values: updatedValues,
      stepHistory: [...state.stepHistory, record]
    });
    next = this.advanceAfterStep(next, definition, step);
    this.persist(next, definition, "choosing_next_step", null);
    await this.emitStatus(next, definition, "choosing_next_step", options.callbacks);
    await this.recordEvent(next.workflowId, next.runId, {
      at: nowIso(),
      kind: "agent_completed",
      message: `Agent '${agent.id}' completed step '${step.id}'.`,
      stepId: step.id,
      agentId: agent.id,
      iteration
    }, options.callbacks);
    await this.recordEvent(next.workflowId, next.runId, {
      at: nowIso(),
      kind: "step_completed",
      message: `Step '${step.id}' completed.`,
      stepId: step.id,
      iteration
    }, options.callbacks);
    return { state: next, terminate: false, pause: false };
  }

  private async runDecisionStep(
    state: WorkflowRunState,
    step: WorkflowDecisionStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    const agent = this.project.agents[step.agentId];
    if (!agent) {
      const message = `Decision agent '${step.agentId}' is not configured in project '${this.project.id}'.`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    const stepDir = ensureStepDir(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    const prompt = buildDecisionPrompt(step, state);
    fs.writeFileSync(path.join(stepDir, "input.md"), prompt, "utf8");
    await this.recordEvent(state.workflowId, state.runId, {
      at: nowIso(),
      kind: "agent_started",
      message: `Decision agent '${agent.id}' starting step '${step.id}'.`,
      stepId: step.id,
      agentId: agent.id,
      iteration
    }, options.callbacks);
    const startedAt = nowIso();
    const startedAtMs = Date.now();
    let response: string;
    try {
      response = await this.agentResponder(
        this.project,
        agent,
        {
          chatId: "",
          sender: `workflow:${state.workflowId}:${state.runId}:${step.id}`,
          text: prompt,
          files: [],
          memory: { workingMemory: [], previousDaySummary: "" }
        },
        {
          signal: options.signal,
          onProgress: async (event) => {
            await this.emitProgress(options.callbacks, event);
          }
        }
      );
    } catch (error) {
      if (options.signal?.aborted || state.stopRequested) {
        const stopped = this.markStopped(state, definition, options.callbacks);
        return { state: stopped, terminate: true, pause: false };
      }
      const message = `Decision agent '${agent.id}' failed for step '${step.id}': ${(error as Error).message}`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    fs.writeFileSync(path.join(stepDir, "output.md"), response, "utf8");
    const finishedAt = nowIso();
    const durationMs = Date.now() - startedAtMs;
    this.persist(
      transitionState(state, { currentStepId: step.id }),
      definition,
      "parsing_decision",
      null
    );
    await this.emitStatus(
      transitionState(state, { currentStepId: step.id }),
      definition,
      "parsing_decision",
      options.callbacks
    );
    const parsed = parseDecisionResponse(response, step);
    const decisionFile = buildDecisionPath(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    if (!parsed.ok) {
      writeDecisionXml(decisionFile, {
        action: "fail",
        choiceName: null,
        next: null,
        reason: parsed.reason
      });
      if (step.onInvalid === "pause") {
        const paused = this.pauseForInvalidDecision(
          state,
          definition,
          step,
          iteration,
          stepDir,
          decisionFile,
          parsed.reason,
          options.callbacks
        );
        return { state: paused, terminate: false, pause: true };
      }
      const message = `Decision agent '${agent.id}' returned an invalid decision block: ${parsed.reason}`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    writeDecisionXml(decisionFile, {
      action: parsed.action,
      choiceName: parsed.choiceName,
      next: parsed.next,
      reason: parsed.reason
    });
    const outputValue = response.trim();
    const updatedValues = { ...state.values, [`${step.id}.output`]: outputValue };
    if (step.outputName) {
      updatedValues[step.outputName] = outputValue;
    }
    const record: WorkflowStepRecord = {
      stepId: step.id,
      kind: "decision",
      agentId: agent.id,
      iteration,
      startedAt,
      finishedAt,
      outputName: step.outputName,
      promptPath: path.join(stepDir, "input.md"),
      outputPath: path.join(stepDir, "output.md"),
      decisionPath: decisionFile,
      metaPath: path.join(stepDir, "meta.json"),
      decisionAction: parsed.action,
      decisionChoice: parsed.choiceName,
      durationMs
    };
    writeStepMeta(stepDir, {
      stepId: step.id,
      iteration,
      startedAt,
      finishedAt,
      agentId: agent.id,
      decision: {
        action: parsed.action,
        choiceName: parsed.choiceName,
        next: parsed.next,
        reason: parsed.reason
      }
    });
    let next = transitionState(state, {
      values: updatedValues,
      stepHistory: [...state.stepHistory, record]
    });
    await this.recordEvent(next.workflowId, next.runId, {
      at: nowIso(),
      kind: "decision_chosen",
      message: `Decision '${parsed.choiceName ?? parsed.action}' chosen by '${agent.id}' on step '${step.id}'.`,
      stepId: step.id,
      agentId: agent.id,
      iteration,
      data: {
        action: parsed.action,
        next: parsed.next,
        choice: parsed.choiceName,
        reason: parsed.reason
      }
    }, options.callbacks);

    if (parsed.action === "stop") {
      const completed = this.markCompleted(next, definition, options.callbacks);
      return { state: completed, terminate: true, pause: false };
    }
    if (parsed.action === "needs_human") {
      next = this.enterHumanGate(
        next,
        definition,
        {
          stepId: step.id,
          prompt: parsed.reason ?? `Decision step '${step.id}' requested human input.`,
          allow: ["approve", "stop", "retry", "edit", "branch"]
        },
        options.callbacks
      );
      return { state: next, terminate: false, pause: true };
    }
    if (parsed.action === "branch") {
      if (!parsed.next) {
        const message = `Decision step '${step.id}' chose branch without target.`;
        const failed = this.markFailed(next, definition, message, options.callbacks);
        return { state: failed, terminate: true, pause: false };
      }
      next = transitionState(next, { nextStepId: parsed.next });
      return { state: next, terminate: false, pause: false };
    }
    // continue
    if (parsed.next) {
      next = transitionState(next, { nextStepId: parsed.next });
    } else {
      next = this.advanceAfterStep(next, definition, step);
    }
    await this.recordEvent(next.workflowId, next.runId, {
      at: nowIso(),
      kind: "step_completed",
      message: `Decision step '${step.id}' completed.`,
      stepId: step.id,
      iteration
    }, options.callbacks);
    return { state: next, terminate: false, pause: false };
  }

  private async runHumanGateStep(
    state: WorkflowRunState,
    step: WorkflowHumanGateStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    const stepDir = ensureStepDir(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    const prompt = resolveTemplate(step.prompt, state);
    fs.writeFileSync(path.join(stepDir, "input.md"), prompt, "utf8");
    const record: WorkflowStepRecord = {
      stepId: step.id,
      kind: "human_gate",
      agentId: null,
      iteration,
      startedAt: nowIso(),
      finishedAt: null,
      outputName: null,
      promptPath: path.join(stepDir, "input.md"),
      outputPath: null,
      decisionPath: null,
      metaPath: path.join(stepDir, "meta.json"),
      decisionAction: null,
      decisionChoice: null,
      durationMs: null
    };
    writeStepMeta(stepDir, {
      stepId: step.id,
      iteration,
      startedAt: record.startedAt,
      finishedAt: record.startedAt,
      agentId: null,
      decision: null
    });
    let next = transitionState(state, {
      stepHistory: [...state.stepHistory, record]
    });
    next = this.enterHumanGate(
      next,
      definition,
      {
        stepId: step.id,
        prompt,
        allow: step.allow
      },
      options.callbacks
    );
    return { state: next, terminate: false, pause: true };
  }

  private async runMergeStep(
    state: WorkflowRunState,
    step: WorkflowMergeStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    const stepDir = ensureStepDir(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    const parts: string[] = [];
    const missing: string[] = [];
    for (const inputName of step.inputs) {
      const value = state.values[inputName];
      if (value === undefined) {
        missing.push(inputName);
        continue;
      }
      parts.push(`# ${inputName}\n\n${value}`);
    }
    if (missing.length > 0) {
      const message = `Merge step '${step.id}' is missing inputs: ${missing.join(", ")}`;
      const failed = this.markFailed(state, definition, message, options.callbacks);
      return { state: failed, terminate: true, pause: false };
    }
    const merged = parts.join(step.separator);
    fs.writeFileSync(path.join(stepDir, "input.md"), step.inputs.join(", "), "utf8");
    fs.writeFileSync(path.join(stepDir, "output.md"), merged, "utf8");
    const updatedValues = {
      ...state.values,
      [step.outputName]: merged,
      [`${step.id}.output`]: merged
    };
    const record: WorkflowStepRecord = {
      stepId: step.id,
      kind: "merge",
      agentId: null,
      iteration,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      outputName: step.outputName,
      promptPath: path.join(stepDir, "input.md"),
      outputPath: path.join(stepDir, "output.md"),
      decisionPath: null,
      metaPath: path.join(stepDir, "meta.json"),
      decisionAction: null,
      decisionChoice: null,
      durationMs: 0
    };
    writeStepMeta(stepDir, {
      stepId: step.id,
      iteration,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? record.startedAt,
      agentId: null,
      decision: null
    });
    let next = transitionState(state, {
      values: updatedValues,
      stepHistory: [...state.stepHistory, record]
    });
    next = this.advanceAfterStep(next, definition, step);
    await this.recordEvent(next.workflowId, next.runId, {
      at: nowIso(),
      kind: "merge_completed",
      message: `Merge step '${step.id}' produced output '${step.outputName}'.`,
      stepId: step.id,
      iteration
    }, options.callbacks);
    return { state: next, terminate: false, pause: false };
  }

  private async runTerminateStep(
    state: WorkflowRunState,
    step: WorkflowTerminateStep,
    iteration: number,
    definition: WorkflowDefinition,
    options: WorkflowExecuteOptions
  ): Promise<StepOutcome> {
    const stepDir = ensureStepDir(
      this.config,
      this.project,
      state.workflowId,
      state.runId,
      stepIdentifier(step.id, iteration)
    );
    const message = step.message ? resolveTemplate(step.message, state) : null;
    if (message) {
      fs.writeFileSync(path.join(stepDir, "output.md"), message, "utf8");
    }
    writeStepMeta(stepDir, {
      stepId: step.id,
      iteration,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      agentId: null,
      decision: null
    });
    let next = transitionState(state, {
      stepHistory: [
        ...state.stepHistory,
        {
          stepId: step.id,
          kind: "terminate",
          agentId: null,
          iteration,
          startedAt: nowIso(),
          finishedAt: nowIso(),
          outputName: null,
          promptPath: null,
          outputPath: message ? path.join(stepDir, "output.md") : null,
          decisionPath: null,
          metaPath: path.join(stepDir, "meta.json"),
          decisionAction: null,
          decisionChoice: null,
          durationMs: 0
        }
      ]
    });
    if (step.status === "success") {
      const completed = this.markCompleted(next, definition, options.callbacks);
      return { state: completed, terminate: true, pause: false };
    }
    if (step.status === "stopped") {
      const stopped = this.markStopped(next, definition, options.callbacks);
      return { state: stopped, terminate: true, pause: false };
    }
    const failed = this.markFailed(
      next,
      definition,
      message ?? `Workflow terminated with status '${step.status}'.`,
      options.callbacks
    );
    return { state: failed, terminate: true, pause: false };
  }

  private advanceAfterStep(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    step: WorkflowStep
  ): WorkflowRunState {
    if (step.loopId) {
      const loop = definition.loops[step.loopId];
      if (loop && loop.endStepId === step.id) {
        return transitionState(state, { nextStepId: loop.startStepId });
      }
    }
    const next = nextStepInOrder(definition, step.id);
    return transitionState(state, { nextStepId: next });
  }

  private enterHumanGate(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    gate: { stepId: string; prompt: string; allow: WorkflowHumanGateStep["allow"] },
    callbacks?: WorkflowRunCallbacks
  ): WorkflowRunState {
    const now = nowIso();
    const next = transitionState(state, {
      status: "paused",
      currentStepId: gate.stepId,
      pendingGate: {
        stepId: gate.stepId,
        prompt: gate.prompt,
        allow: gate.allow,
        pausedAt: now
      }
    });
    this.persist(next, definition, "waiting_for_human", null);
    void this.recordEvent(next.workflowId, next.runId, {
      at: now,
      kind: "human_gate_paused",
      message: `Workflow paused at human gate '${gate.stepId}'.`,
      stepId: gate.stepId
    }, callbacks);
    void this.emitStatus(next, definition, "waiting_for_human", callbacks);
    return next;
  }

  private pauseForInvalidDecision(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    step: WorkflowDecisionStep,
    iteration: number,
    stepDir: string,
    decisionFile: string,
    reason: string,
    callbacks?: WorkflowRunCallbacks
  ): WorkflowRunState {
    const record: WorkflowStepRecord = {
      stepId: step.id,
      kind: "decision",
      agentId: step.agentId,
      iteration,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      outputName: step.outputName,
      promptPath: path.join(stepDir, "input.md"),
      outputPath: path.join(stepDir, "output.md"),
      decisionPath: decisionFile,
      metaPath: path.join(stepDir, "meta.json"),
      decisionAction: "needs_human",
      decisionChoice: null,
      durationMs: null
    };
    let next = transitionState(state, {
      stepHistory: [...state.stepHistory, record]
    });
    next = this.enterHumanGate(
      next,
      definition,
      {
        stepId: step.id,
        prompt: `Decision parsing failed: ${reason}`,
        allow: ["retry", "edit", "stop", "branch"]
      },
      callbacks
    );
    return next;
  }

  private markCompleted(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    callbacks?: WorkflowRunCallbacks
  ): WorkflowRunState {
    const now = nowIso();
    const next = transitionState(state, {
      status: "complete",
      finishedAt: now,
      currentStepId: null,
      nextStepId: null
    });
    this.persist(next, definition, "completed", null);
    void this.recordEvent(next.workflowId, next.runId, {
      at: now,
      kind: "run_completed",
      message: `Workflow ${next.workflowId} run ${next.runId} completed.`
    }, callbacks);
    void this.emitStatus(next, definition, "completed", callbacks);
    return next;
  }

  private markFailed(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    error: string,
    callbacks?: WorkflowRunCallbacks
  ): WorkflowRunState {
    const now = nowIso();
    const next = transitionState(state, {
      status: "failed",
      finishedAt: now,
      currentStepId: null,
      nextStepId: null,
      error
    });
    this.persist(next, definition, "completed", error);
    void this.recordEvent(next.workflowId, next.runId, {
      at: now,
      kind: "run_failed",
      message: error
    }, callbacks);
    void this.emitStatus(next, definition, "completed", callbacks);
    return next;
  }

  private markStopped(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    callbacks?: WorkflowRunCallbacks
  ): WorkflowRunState {
    const now = nowIso();
    const next = transitionState(state, {
      status: "stopped",
      finishedAt: now,
      currentStepId: null,
      nextStepId: null
    });
    this.persist(next, definition, "completed", null);
    void this.recordEvent(next.workflowId, next.runId, {
      at: now,
      kind: "run_stopped",
      message: `Workflow ${next.workflowId} run ${next.runId} stopped.`
    }, callbacks);
    void this.emitStatus(next, definition, "completed", callbacks);
    return next;
  }

  private async handleLoopBoundExceeded(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    step: WorkflowStep,
    message: string,
    callbacks?: WorkflowRunCallbacks
  ): Promise<void> {
    await this.recordEvent(state.workflowId, state.runId, {
      at: nowIso(),
      kind: "run_failed",
      message,
      stepId: step.id,
      data: { loopId: step.loopId, iteration: state.iteration }
    }, callbacks);
    void definition;
  }

  private writeInputs(
    workflowId: string,
    runId: string,
    inputs: Record<string, string>
  ): void {
    const dir = ensureInputDir(this.config, this.project, workflowId, runId);
    const lines: string[] = [];
    for (const [key, value] of Object.entries(inputs)) {
      lines.push(`## ${key}`);
      lines.push("");
      lines.push(value);
      lines.push("");
    }
    if (lines.length === 0) {
      lines.push("_No initial inputs supplied._");
    }
    ensureDir(dir);
    fs.writeFileSync(
      path.join(dir, "initial.md"),
      `${lines.join("\n").trim()}\n`,
      "utf8"
    );
  }

  private persist(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    phase: WorkflowRunPhase,
    error: string | null
  ): void {
    writeRunState(this.config, this.project, state.workflowId, state);
    writeRunStatus(
      this.config,
      this.project,
      state.workflowId,
      buildStatus(state, definition, phase, error)
    );
  }

  private async emitStatus(
    state: WorkflowRunState,
    definition: WorkflowDefinition,
    phase: WorkflowRunPhase,
    callbacks?: WorkflowRunCallbacks
  ): Promise<void> {
    if (!callbacks?.onStatusUpdate) {
      return;
    }
    await callbacks.onStatusUpdate(buildStatus(state, definition, phase, state.error));
  }

  private async emitProgress(
    callbacks: WorkflowRunCallbacks | undefined,
    event: TaskProgressEvent
  ): Promise<void> {
    if (!callbacks?.onProgress) {
      return;
    }
    await callbacks.onProgress(event);
  }

  private async recordEvent(
    workflowId: string,
    runId: string,
    event: WorkflowEvent,
    callbacks?: WorkflowRunCallbacks
  ): Promise<void> {
    appendRunEvent(this.config, this.project, workflowId, runId, event);
    if (callbacks?.onEvent) {
      await callbacks.onEvent(event);
    }
  }

  private appendEvent(workflowId: string, runId: string, event: WorkflowEvent): void {
    appendRunEvent(this.config, this.project, workflowId, runId, event);
  }
}

interface StepOutcome {
  state: WorkflowRunState;
  terminate: boolean;
  pause: boolean;
}

function buildStatus(
  state: WorkflowRunState,
  definition: WorkflowDefinition,
  phase: WorkflowRunPhase,
  error: string | null
): WorkflowRunStatus {
  const stepId = state.currentStepId;
  const step = stepId ? definition.steps[stepId] : null;
  const loopId = step?.loopId ?? null;
  const loop = loopId ? definition.loops[loopId] : null;
  const totalSteps = Object.keys(definition.steps).length;
  const completedSteps = state.stepHistory.length;
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    projectId: state.projectId,
    status: state.status,
    currentStepId: state.currentStepId,
    currentStepType: step?.kind ?? null,
    currentAgentId: step ? stepAgentId(step) : null,
    currentAgentLabel: step && stepAgentId(step) ? stepAgentId(step)! : undefined,
    currentPhase: phase,
    iteration: state.iteration,
    maxIterations: loop?.maxIterations ?? undefined,
    startedAt: state.startedAt ?? state.createdAt,
    updatedAt: nowIso(),
    lastEventMessage: null,
    progress: {
      current: completedSteps,
      total: totalSteps
    },
    pendingGate: state.pendingGate
      ? {
          stepId: state.pendingGate.stepId,
          prompt: state.pendingGate.prompt,
          allow: state.pendingGate.allow
        }
      : null,
    error
  };
}

function transitionState(
  state: WorkflowRunState,
  patch: Partial<WorkflowRunState>
): WorkflowRunState {
  const now = nowIso();
  return {
    ...state,
    ...patch,
    updatedAt: now
  };
}

function computeIteration(
  state: WorkflowRunState,
  step: WorkflowStep,
  definition: WorkflowDefinition
): { iteration: number; loopIterations: Record<string, number> } {
  if (!step.loopId) {
    return { iteration: state.iteration, loopIterations: state.loopIterations };
  }
  const loop = definition.loops[step.loopId];
  if (!loop) {
    return { iteration: state.iteration, loopIterations: state.loopIterations };
  }
  const previous = state.loopIterations[loop.id] ?? 0;
  if (step.id === loop.startStepId) {
    const nextIteration = previous + 1;
    return {
      iteration: nextIteration,
      loopIterations: { ...state.loopIterations, [loop.id]: nextIteration }
    };
  }
  return {
    iteration: previous,
    loopIterations: state.loopIterations
  };
}

function enforceLoopBounds(
  state: WorkflowRunState,
  step: WorkflowStep,
  definition: WorkflowDefinition
): string | null {
  if (!step.loopId) {
    return null;
  }
  const loop = definition.loops[step.loopId];
  if (!loop) {
    return null;
  }
  const iteration = state.loopIterations[loop.id] ?? state.iteration;
  if (loop.maxIterations !== null && iteration > loop.maxIterations) {
    return `Loop '${loop.id}' exceeded maxIterations=${loop.maxIterations}.`;
  }
  if (loop.maxSteps !== null) {
    const stepCount = state.stepHistory.filter(
      (entry) => entry.stepId && loop.childStepIds.includes(entry.stepId)
    ).length;
    if (stepCount > loop.maxSteps) {
      return `Loop '${loop.id}' exceeded maxSteps=${loop.maxSteps}.`;
    }
  }
  if (loop.maxRuntimeMinutes !== null && state.startedAt) {
    const startedAtMs = Date.parse(state.startedAt);
    if (Number.isFinite(startedAtMs)) {
      const elapsedMin = (Date.now() - startedAtMs) / 60000;
      if (elapsedMin > loop.maxRuntimeMinutes) {
        return `Loop '${loop.id}' exceeded maxRuntimeMinutes=${loop.maxRuntimeMinutes}.`;
      }
    }
  }
  return null;
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

function stepAgentId(step: WorkflowStep): string | null {
  if (step.kind === "agent" || step.kind === "decision") {
    return step.agentId;
  }
  return null;
}

function resolveTemplate(template: string, state: WorkflowRunState): string {
  return template.replace(/\$\{([^}]+)\}/g, (full, raw) => {
    const key = String(raw).trim();
    if (!key) {
      return full;
    }
    if (state.values[key] !== undefined) {
      return state.values[key]!;
    }
    if (key.startsWith("input.")) {
      const inputKey = key.slice("input.".length);
      return state.initialInputs[inputKey] ?? full;
    }
    return full;
  });
}

function buildDecisionPrompt(
  step: WorkflowDecisionStep,
  state: WorkflowRunState
): string {
  const prompt = resolveTemplate(step.prompt, state);
  const choiceList = step.choices
    .map((choice) => `- ${choice.name}: ${describeChoice(choice)}`)
    .join("\n");
  return `${prompt}\n\nAvailable choices:\n${choiceList}\n\nYou MUST end your response with one line containing a workflow-decision tag, e.g.:\n<workflow-decision action="continue" next="${step.choices[0]?.next ?? step.choices[0]?.name}" reason="..." />\n`;
}

function describeChoice(choice: WorkflowDecisionChoice): string {
  if (choice.terminate) {
    return `terminate the run with status '${choice.terminate}'`;
  }
  if (choice.gate === "human") {
    return "pause for human input";
  }
  if (choice.next) {
    return `continue to step '${choice.next}'`;
  }
  return "continue";
}

type DecisionParseResult =
  | {
      ok: true;
      action: "continue" | "stop" | "branch" | "needs_human";
      next: string | null;
      choiceName: string | null;
      reason: string | null;
    }
  | {
      ok: false;
      reason: string;
    };

function parseDecisionResponse(
  response: string,
  step: WorkflowDecisionStep
): DecisionParseResult {
  const tagPattern =
    /<workflow-decision\b([^>]*?)\/?>(?:<\/workflow-decision>)?/gi;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = tagPattern.exec(response)) !== null) {
    last = match;
  }
  if (!last) {
    return { ok: false, reason: "Missing <workflow-decision> tag." };
  }
  const attrs = parseAttributes(last[1]);
  const actionRaw = (attrs.action ?? "").trim();
  if (!actionRaw) {
    return { ok: false, reason: "<workflow-decision> missing 'action' attribute." };
  }
  const reason = (attrs.reason ?? "").trim() || null;
  const nextRaw = (attrs.next ?? "").trim();
  const choiceRaw = (attrs.choice ?? "").trim();
  let next: string | null = nextRaw || null;
  let choiceName: string | null = choiceRaw || null;

  // Map by choice when provided.
  if (choiceName) {
    const choice = step.choices.find((c) => c.name === choiceName);
    if (!choice) {
      return {
        ok: false,
        reason: `Decision references unknown choice '${choiceName}'.`
      };
    }
    if (choice.terminate) {
      return {
        ok: true,
        action: "stop",
        next: null,
        choiceName: choice.name,
        reason
      };
    }
    if (choice.gate === "human") {
      return {
        ok: true,
        action: "needs_human",
        next: null,
        choiceName: choice.name,
        reason
      };
    }
    if (choice.next) {
      return {
        ok: true,
        action: "continue",
        next: choice.next,
        choiceName: choice.name,
        reason
      };
    }
    return {
      ok: true,
      action: "continue",
      next: null,
      choiceName: choice.name,
      reason
    };
  }

  switch (actionRaw) {
    case "stop":
      return { ok: true, action: "stop", next: null, choiceName: null, reason };
    case "needs_human":
      return {
        ok: true,
        action: "needs_human",
        next: null,
        choiceName: null,
        reason
      };
    case "continue":
      if (next) {
        return { ok: true, action: "continue", next, choiceName: null, reason };
      }
      return { ok: true, action: "continue", next: null, choiceName: null, reason };
    case "branch":
      if (!next) {
        return {
          ok: false,
          reason: "Branch action requires a 'next' attribute."
        };
      }
      return { ok: true, action: "branch", next, choiceName: null, reason };
    case "fail":
      return {
        ok: false,
        reason: reason ?? "Decision explicitly failed."
      };
    default:
      return {
        ok: false,
        reason: `Unsupported decision action '${actionRaw}'.`
      };
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const key = match[1]!;
    const value = (match[3] ?? match[4] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    attrs[key] = value;
  }
  return attrs;
}
