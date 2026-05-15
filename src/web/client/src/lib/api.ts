import type {
  WebAgentDetail,
  WebAgentSummary,
  WebArtifactSummary,
  WebConversationDetail,
  WebConversationSummary,
  WebGpuRunSummary,
  WebHealthStatus,
  WebOverview,
  WebProjectDetail,
  WebProjectSummary,
  WebResearchRun,
  WebResearchRunDetail,
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

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `API ${response.status} ${response.statusText}: ${text || path}`,
    )
  }
  return (await response.json()) as T
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
  conversations: (projectId: string, agentId?: string, limit?: number) => {
    const params = new URLSearchParams()
    if (agentId) params.set("agentId", agentId)
    if (limit) params.set("limit", String(limit))
    const query = params.toString() ? `?${params.toString()}` : ""
    return request<WebConversationSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/conversations${query}`,
    )
  },
  conversation: (
    projectId: string,
    sessionId: string,
    agentId: string,
    date?: string,
  ) => {
    const params = new URLSearchParams({ agentId })
    if (date) params.set("date", date)
    return request<WebConversationDetail>(
      `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(sessionId)}?${params.toString()}`,
    )
  },
  artifacts: (projectId: string, limit?: number) => {
    const query = limit ? `?limit=${limit}` : ""
    return request<WebArtifactSummary[]>(
      `/projects/${encodeURIComponent(projectId)}/artifacts${query}`,
    )
  },
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
  agentResearch: (projectId: string, agentId: string) =>
    request<WebResearchRun[]>(
      `/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/research`,
    ),
  researchRun: (projectId: string, runId: string) =>
    request<WebResearchRunDetail>(
      `/projects/${encodeURIComponent(projectId)}/research/${encodeURIComponent(runId)}`,
    ),
}

export type { WebOverview, WebProjectDetail, WebAgentDetail, WebHealthStatus }
