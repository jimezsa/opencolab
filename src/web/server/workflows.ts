/**
 * Studio web workflow routes.
 *
 * Wraps OpenColabRuntime workflow methods with JSON DTOs and Server-Sent
 * Events for live event streaming. Mounted at
 * /api/web/projects/<projectId>/workflows and
 * /api/web/projects/<projectId>/workflow-runs.
 */
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenColabRuntime } from "../../runtime.js";
import type {
  WorkflowApprovalDecision,
  WorkflowEvent,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowSummary
} from "../../types.js";
import {
  getActiveRun,
  type ActiveRunEntry
} from "../../workflows/index.js";
import type {
  WebWorkflowDetail,
  WebWorkflowEvent,
  WebWorkflowRunDetail,
  WebWorkflowRunStatusDto,
  WebWorkflowRunSummary,
  WebWorkflowStartRequest,
  WebWorkflowStartResponse,
  WebWorkflowStopResponse,
  WebWorkflowSummary
} from "../shared/types.js";

const SSE_KEEPALIVE_MS = 15_000;

export async function handleWorkflowsRoute(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  projectId: string,
  rest: string
): Promise<boolean> {
  const method = request.method ?? "GET";

  if (method === "GET" && (rest === "" || rest === "/")) {
    sendJson(response, 200, toWorkflowSummariesDto(runtime.listWorkflows(projectId)));
    return true;
  }

  const detailMatch = /^\/([^/]+)$/.exec(rest);
  if (method === "GET" && detailMatch) {
    const workflowId = decodeURIComponent(detailMatch[1]!);
    const detail = runtime.getWorkflowDetail(workflowId, projectId);
    if (!detail) {
      sendError(response, 404, "unknown_workflow");
      return true;
    }
    const runs = runtime.listWorkflowRuns(workflowId, projectId);
    const dto: WebWorkflowDetail = {
      ...toWorkflowSummaryDto(detail),
      steps: detail.steps.map((step) => ({
        id: step.id,
        kind: step.kind as WebWorkflowDetail["steps"][number]["kind"],
        agentId: step.agentId,
        loopId: step.loopId
      })),
      loops: detail.loops,
      xmlPath: detail.xmlPath,
      runs: runs.map(toRunSummaryDto)
    };
    sendJson(response, 200, dto);
    return true;
  }

  const runsMatch = /^\/([^/]+)\/runs$/.exec(rest);
  if (method === "POST" && runsMatch) {
    const workflowId = decodeURIComponent(runsMatch[1]!);
    let body: WebWorkflowStartRequest;
    try {
      body = await readJsonBody<WebWorkflowStartRequest>(request);
    } catch (error) {
      sendError(response, 400, (error as Error).message);
      return true;
    }
    const inputs = normalizeInputs(body);
    try {
      const result = runtime.startWorkflowRun(
        {
          workflowId,
          input: inputs,
          initiator: body.initiator ?? "web"
        },
        projectId
      );
      const dto: WebWorkflowStartResponse = {
        runId: result.runId,
        workflowId: result.workflowId,
        status: "queued"
      };
      sendJson(response, 202, dto);
    } catch (error) {
      sendError(response, 400, (error as Error).message);
    }
    return true;
  }

  if (method === "GET" && (rest === "/runs" || rest === "/runs/")) {
    const workflowId = url.searchParams.get("workflowId") ?? undefined;
    sendJson(
      response,
      200,
      runtime.listWorkflowRuns(workflowId, projectId).map(toRunSummaryDto)
    );
    return true;
  }

  sendError(response, 404, "not_found");
  return true;
}

export async function handleWorkflowRunRoute(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  projectId: string,
  rest: string
): Promise<boolean> {
  const method = request.method ?? "GET";

  if (method === "GET" && rest === "") {
    sendJson(response, 200, runtime.listWorkflowRuns(undefined, projectId).map(toRunSummaryDto));
    return true;
  }

  const runMatch = /^\/([^/]+)(\/.*)?$/.exec(rest);
  if (!runMatch) {
    sendError(response, 404, "not_found");
    return true;
  }
  const runId = decodeURIComponent(runMatch[1]!);
  const trailing = runMatch[2] ?? "";

  const resolved = runtime.resolveWorkflowRun(runId, projectId);
  if (!resolved) {
    sendError(response, 404, "unknown_run");
    return true;
  }
  const workflowId = resolved.workflowId;

  if (method === "GET" && trailing === "") {
    const status = runtime.getWorkflowRunStatus(workflowId, runId, projectId);
    const detail = toRunDetailDto(resolved.runState, status);
    sendJson(response, 200, detail);
    return true;
  }

  if (method === "GET" && trailing === "/status") {
    const status = runtime.getWorkflowRunStatus(workflowId, runId, projectId);
    if (!status) {
      sendError(response, 404, "missing_status");
      return true;
    }
    sendJson(response, 200, toStatusDto(status));
    return true;
  }

  if (method === "GET" && trailing === "/events") {
    streamEvents(runtime, request, response, projectId, workflowId, runId);
    return true;
  }

  if (method === "POST" && trailing === "/stop") {
    const status = runtime.stopWorkflowRun(runId, projectId);
    if (!status) {
      sendError(response, 404, "unknown_run");
      return true;
    }
    const dto: WebWorkflowStopResponse = {
      runId,
      status: status.status
    };
    sendJson(response, 200, dto);
    return true;
  }

  if (method === "POST" && trailing === "/resume") {
    try {
      const result = runtime.resumeWorkflowRun(runId, projectId);
      sendJson(response, 200, result);
    } catch (error) {
      sendError(response, 400, (error as Error).message);
    }
    return true;
  }

  if (method === "POST" && trailing === "/approve") {
    let body: { decision?: string; next?: string; values?: Record<string, unknown> };
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendError(response, 400, (error as Error).message);
      return true;
    }
    let decision: WorkflowApprovalDecision;
    switch (body.decision) {
      case "continue":
        decision = { kind: "continue" };
        break;
      case "stop":
        decision = { kind: "stop" };
        break;
      case "retry":
        decision = { kind: "retry" };
        break;
      case "branch":
        if (!body.next) {
          sendError(response, 400, "missing_next");
          return true;
        }
        decision = { kind: "branch", next: body.next };
        break;
      case "edit": {
        const values: Record<string, string> = {};
        if (body.values && typeof body.values === "object") {
          for (const [key, value] of Object.entries(body.values)) {
            values[key] = typeof value === "string" ? value : JSON.stringify(value);
          }
        }
        decision = { kind: "edit", values };
        break;
      }
      default:
        sendError(response, 400, "invalid_decision");
        return true;
    }
    try {
      const result = runtime.approveWorkflowGate(runId, decision, projectId);
      sendJson(response, 200, result);
    } catch (error) {
      sendError(response, 400, (error as Error).message);
    }
    return true;
  }

  void url;
  sendError(response, 404, "not_found");
  return true;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendError(response: ServerResponse, status: number, error: string): void {
  sendJson(response, status, { error });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  const limit = 1 * 1024 * 1024;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new Error("request_body_too_large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new Error("invalid_json");
  }
}

function normalizeInputs(body: WebWorkflowStartRequest): Record<string, string> {
  if (body.input && typeof body.input === "object") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.input)) {
      out[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return out;
  }
  if (typeof body.inputText === "string" && body.inputText.trim()) {
    return { task: body.inputText };
  }
  return {};
}

function toWorkflowSummariesDto(summaries: WorkflowSummary[]): WebWorkflowSummary[] {
  return summaries.map(toWorkflowSummaryDto);
}

function toWorkflowSummaryDto(source: WorkflowSummary): WebWorkflowSummary {
  return {
    id: source.id,
    projectId: source.projectId,
    version: source.version,
    description: source.description,
    updatedAt: source.updatedAt,
    stepCount: source.stepCount,
    inputs: source.inputs.map((input) => ({
      name: input.name,
      description: input.description,
      required: input.required
    }))
  };
}

function toRunSummaryDto(source: WorkflowRunSummary): WebWorkflowRunSummary {
  return {
    runId: source.runId,
    workflowId: source.workflowId,
    projectId: source.projectId,
    status: source.status,
    initiator: source.initiator,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    startedAt: source.startedAt,
    finishedAt: source.finishedAt,
    currentStepId: source.currentStepId,
    iteration: source.iteration,
    lastEventMessage: source.lastEventMessage
  };
}

function toRunDetailDto(
  state: Awaited<ReturnType<OpenColabRuntime["getWorkflowRun"]>>,
  status: WorkflowRunStatus | null
): WebWorkflowRunDetail | null {
  if (!state) {
    return null;
  }
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    projectId: state.projectId,
    status: state.status,
    initiator: state.initiator,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    initialInputs: state.initialInputs,
    values: state.values,
    stepHistory: state.stepHistory.map((record) => ({
      stepId: record.stepId,
      kind: record.kind as WebWorkflowRunDetail["stepHistory"][number]["kind"],
      agentId: record.agentId,
      iteration: record.iteration,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      outputName: record.outputName,
      decisionAction: record.decisionAction,
      decisionChoice: record.decisionChoice,
      durationMs: record.durationMs
    })),
    pendingGate: state.pendingGate
      ? {
          stepId: state.pendingGate.stepId,
          prompt: state.pendingGate.prompt,
          allow: state.pendingGate.allow
        }
      : status?.pendingGate ?? null,
    error: state.error
  };
}

function toStatusDto(status: WorkflowRunStatus): WebWorkflowRunStatusDto {
  return {
    runId: status.runId,
    workflowId: status.workflowId,
    projectId: status.projectId,
    status: status.status,
    currentStepId: status.currentStepId,
    currentStepType: status.currentStepType,
    currentAgentId: status.currentAgentId,
    currentAgentLabel: status.currentAgentLabel ?? null,
    currentPhase: status.currentPhase,
    iteration: status.iteration,
    maxIterations: status.maxIterations ?? null,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    lastEventMessage: status.lastEventMessage,
    progress: status.progress,
    pendingGate: status.pendingGate,
    error: status.error
  };
}

function toEventDto(event: WorkflowEvent): WebWorkflowEvent {
  return {
    at: event.at,
    kind: event.kind,
    message: event.message,
    stepId: event.stepId ?? null,
    agentId: event.agentId ?? null,
    iteration: event.iteration ?? null
  };
}

function streamEvents(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  projectId: string,
  workflowId: string,
  runId: string
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const history = runtime.listWorkflowRunEvents(workflowId, runId, projectId);
  for (const event of history) {
    response.write(`event: history\ndata: ${JSON.stringify(toEventDto(event))}\n\n`);
  }

  const live = getActiveRun(runId);
  const keepalive = setInterval(() => {
    try {
      response.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, SSE_KEEPALIVE_MS);

  let cleanedUp = false;
  let listener: ((event: WorkflowEvent) => void) | null = null;
  let statusListener: ((status: WorkflowRunStatus) => void) | null = null;
  const activeRun: ActiveRunEntry | null = live;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearInterval(keepalive);
    if (activeRun) {
      if (listener) {
        activeRun.eventListeners.delete(listener);
      }
      if (statusListener) {
        activeRun.statusListeners.delete(statusListener);
      }
    }
    try {
      response.end();
    } catch {
      // ignore
    }
  };

  request.on("close", cleanup);
  request.on("end", cleanup);
  response.on("close", cleanup);

  if (activeRun) {
    listener = (event) => {
      try {
        response.write(`event: progress\ndata: ${JSON.stringify(toEventDto(event))}\n\n`);
      } catch {
        cleanup();
      }
    };
    statusListener = (status) => {
      try {
        response.write(`event: status\ndata: ${JSON.stringify(toStatusDto(status))}\n\n`);
      } catch {
        cleanup();
      }
    };
    activeRun.eventListeners.add(listener);
    activeRun.statusListeners.add(statusListener);
  } else {
    response.write("event: completed\ndata: {}\n\n");
    cleanup();
  }
}
