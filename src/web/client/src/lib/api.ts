import type {
  WebAgentDetail,
  WebAgentSummary,
  WebChatAgentOption,
  WebChatNewSessionResponse,
  WebChatSendRequest,
  WebChatSendResponse,
  WebChatSessionDetail,
  WebChatSessionSummary,
  WebChatTurn,
  WebChatUploadResponse,
  WebGpuRunSummary,
  WebHealthStatus,
  WebOverview,
  WebProjectDetail,
  WebProjectSummary,
  WebResearchRun,
  WebResearchRunDetail,
  WebWorkflowApprovalRequest,
  WebWorkflowCreateRequest,
  WebWorkflowCreateResponse,
  WebWorkflowDeleteRequest,
  WebWorkflowDeleteResponse,
  WebWorkflowDetail,
  WebWorkflowDuplicateRequest,
  WebWorkflowGraph,
  WebWorkflowPauseResponse,
  WebWorkflowRunDetail,
  WebWorkflowRunStatusDto,
  WebWorkflowRunSummary,
  WebWorkflowStartRequest,
  WebWorkflowStartResponse,
  WebWorkflowStopResponse,
  WebWorkflowSummary,
  WebWorkflowTemplate,
  WebWorkflowUpdateXmlRequest,
  WebWorkflowValidationResponse,
  WebWorkflowXmlResponse,
} from "@shared/types"

const API_BASE = "/api/web"

export function researchFileUrl(
  projectId: string,
  runId: string,
  relativePath: string,
): string {
  const params = new URLSearchParams({ path: relativePath })
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/research/${encodeURIComponent(runId)}/file?${params.toString()}`
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new ApiError(
      response.status,
      `API ${response.status} ${response.statusText}: ${text || path}`,
      tryParseJson(text),
    )
  }
  return (await response.json()) as T
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return sendJson<T>("POST", path, payload)
}

async function putJson<T>(path: string, payload: unknown): Promise<T> {
  return sendJson<T>("PUT", path, payload)
}

async function deleteJson<T>(path: string, payload: unknown): Promise<T> {
  return sendJson<T>("DELETE", path, payload)
}

async function sendJson<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  payload: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  })
  const text = await response.text().catch(() => "")
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `API ${response.status} ${response.statusText}: ${text || path}`,
      tryParseJson(text),
    )
  }
  return (text ? (JSON.parse(text) as T) : (undefined as unknown as T))
}

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
  })
  const text = await response.text().catch(() => "")
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `API ${response.status} ${response.statusText}: ${text || path}`,
      tryParseJson(text),
    )
  }
  return (text ? (JSON.parse(text) as T) : (undefined as unknown as T))
}

function tryParseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function chatFileUrl(projectId: string, fileId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/chat/files/${encodeURIComponent(fileId)}`
}

export function chatTurnEventsUrl(projectId: string, turnId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/chat/turns/${encodeURIComponent(turnId)}/events`
}

export function workflowRunEventsUrl(projectId: string, runId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/events`
}

export const api = {
  overview: () => request<WebOverview>("/overview"),
  health: () => request<WebHealthStatus>("/health"),
  projects: () => request<WebProjectSummary[]>("/projects"),
  project: (projectId: string) =>
    request<WebProjectDetail>(`/projects/${encodeURIComponent(projectId)}`),
  agents: (projectId: string) =>
    request<WebAgentSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/agents`,
    ),
  agent: (projectId: string, agentId: string) =>
    request<WebAgentDetail>(
      `/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`,
    ),
  gpuRuns: (projectId: string, limit?: number) => {
    const query = limit ? `?limit=${limit}` : ""
    return request<WebGpuRunSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/gpu-runs${query}`,
    )
  },
  research: (projectId: string) =>
    request<WebResearchRun[]>(
      `/projects/${encodeURIComponent(projectId)}/research`,
    ),
  researchRun: (projectId: string, runId: string) =>
    request<WebResearchRunDetail>(
      `/projects/${encodeURIComponent(projectId)}/research/${encodeURIComponent(runId)}`,
    ),
  chatAgents: (projectId: string) =>
    request<WebChatAgentOption[]>(
      `/projects/${encodeURIComponent(projectId)}/chat/agents`,
    ),
  chatSessions: (projectId: string, agentId: string) =>
    request<WebChatSessionSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/chat/sessions?agentId=${encodeURIComponent(agentId)}`,
    ),
  chatSession: (projectId: string, agentId: string, sessionId: string) =>
    request<WebChatSessionDetail>(
      `/projects/${encodeURIComponent(projectId)}/chat/sessions/${encodeURIComponent(sessionId)}?agentId=${encodeURIComponent(agentId)}`,
    ),
  chatNewSession: (projectId: string, agentId: string) =>
    postJson<WebChatNewSessionResponse>(
      `/projects/${encodeURIComponent(projectId)}/chat/sessions/new`,
      { agentId },
    ),
  chatSend: (projectId: string, payload: WebChatSendRequest) =>
    postJson<WebChatSendResponse>(
      `/projects/${encodeURIComponent(projectId)}/chat/send`,
      payload,
    ),
  chatStop: (projectId: string, turnId: string) =>
    postJson<WebChatTurn>(
      `/projects/${encodeURIComponent(projectId)}/chat/turns/${encodeURIComponent(turnId)}/stop`,
      {},
    ),
  chatTurn: (projectId: string, turnId: string) =>
    request<WebChatTurn>(
      `/projects/${encodeURIComponent(projectId)}/chat/turns/${encodeURIComponent(turnId)}`,
    ),
  chatUpload: (projectId: string, agentId: string, files: File[]) => {
    const form = new FormData()
    form.append("agentId", agentId)
    for (const file of files) {
      form.append("files", file, file.name)
    }
    return postForm<WebChatUploadResponse>(
      `/projects/${encodeURIComponent(projectId)}/chat/uploads`,
      form,
    )
  },
  workflows: (projectId: string) =>
    request<WebWorkflowSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/workflows`,
    ),
  workflow: (projectId: string, workflowId: string) =>
    request<WebWorkflowDetail>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}`,
    ),
  workflowGraph: (projectId: string, workflowId: string) =>
    request<WebWorkflowGraph>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/graph`,
    ),
  workflowXml: (projectId: string, workflowId: string) =>
    request<WebWorkflowXmlResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/xml`,
    ),
  workflowTemplates: (projectId: string) =>
    request<WebWorkflowTemplate[]>(
      `/projects/${encodeURIComponent(projectId)}/workflows/templates`,
    ),
  createWorkflow: (projectId: string, payload: WebWorkflowCreateRequest) =>
    postJson<WebWorkflowCreateResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows`,
      payload,
    ),
  updateWorkflowXml: (
    projectId: string,
    workflowId: string,
    payload: WebWorkflowUpdateXmlRequest,
  ) =>
    putJson<WebWorkflowXmlResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/xml`,
      payload,
    ),
  duplicateWorkflow: (
    projectId: string,
    sourceWorkflowId: string,
    payload: WebWorkflowDuplicateRequest,
  ) =>
    postJson<WebWorkflowCreateResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(sourceWorkflowId)}/duplicate`,
      payload,
    ),
  deleteWorkflow: (
    projectId: string,
    workflowId: string,
    payload: WebWorkflowDeleteRequest,
  ) =>
    deleteJson<WebWorkflowDeleteResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}`,
      payload,
    ),
  validateWorkflowXml: (projectId: string, xml: string, workflowId?: string) => {
    const path = workflowId
      ? `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/validate`
      : `/projects/${encodeURIComponent(projectId)}/workflows/validate`
    const payload = workflowId ? {} : { xml }
    return postJson<WebWorkflowValidationResponse>(path, payload)
  },
  workflowRuns: (projectId: string, workflowId?: string) => {
    const query = workflowId
      ? `?workflowId=${encodeURIComponent(workflowId)}`
      : ""
    return request<WebWorkflowRunSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs${query}`,
    )
  },
  workflowRun: (projectId: string, runId: string) =>
    request<WebWorkflowRunDetail>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}`,
    ),
  workflowRunStatus: (projectId: string, runId: string) =>
    request<WebWorkflowRunStatusDto>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/status`,
    ),
  startWorkflow: (
    projectId: string,
    workflowId: string,
    payload: WebWorkflowStartRequest,
  ) =>
    postJson<WebWorkflowStartResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowId)}/runs`,
      payload,
    ),
  pauseWorkflowRun: (projectId: string, runId: string) =>
    postJson<WebWorkflowPauseResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/pause`,
      {},
    ),
  stopWorkflowRun: (projectId: string, runId: string) =>
    postJson<WebWorkflowStopResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/stop`,
      {},
    ),
  resumeWorkflowRun: (projectId: string, runId: string) =>
    postJson<{ runId: string; status: string }>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/resume`,
      {},
    ),
  approveWorkflowRun: (
    projectId: string,
    runId: string,
    payload: WebWorkflowApprovalRequest,
  ) =>
    postJson<{ runId: string; status: string }>(
      `/projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}/approve`,
      payload,
    ),
}

export type { WebOverview, WebProjectDetail, WebAgentDetail, WebHealthStatus }
