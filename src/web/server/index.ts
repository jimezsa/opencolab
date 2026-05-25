/**
 * OpenColab Studio web server entrypoint.
 * Routes /api/web/* to read-only DTO handlers and serves the built static client
 * for browser routes. Returns false when the request is not handled, so the
 * caller (src/http.ts) can fall through to its own routes or 404.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenColabRuntime } from "../../runtime.js";
import { listAgentSummaries, getAgentDetail } from "./agents.js";
import { listProjectArtifacts } from "./artifacts.js";
import { handleChatRoute } from "./chat.js";
import {
  getConversationDetail,
  listAgentConversations,
  listProjectConversations
} from "./conversations.js";
import { listProjectGpuRuns } from "./gpu-runs.js";
import { buildHealthStatus } from "./health.js";
import { getProjectDetail, listProjectSummaries } from "./projects.js";
import {
  getResearchRunDetail,
  listAgentResearch,
  listProjectResearch,
  streamResearchFile
} from "./research.js";
import { serveStaticAsset } from "./static.js";
import { listProjectSummaries as _ } from "./projects.js";
import type {
  WebActiveSelection,
  WebOverview
} from "../shared/types.js";

void _;

export async function handleWebRequest(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  const method = request.method ?? "GET";
  const pathname = url.pathname;

  if (pathname.startsWith("/api/web/")) {
    const chatMatch = /^\/api\/web\/projects\/([^/]+)\/chat(\/.*)?$/u.exec(pathname);
    if (chatMatch) {
      const projectId = decodeURIComponent(chatMatch[1]);
      const rest = chatMatch[2] ?? "";
      const handled = await handleChatRoute(runtime, request, response, url, projectId, rest);
      if (handled) {
        return true;
      }
      sendJson(response, 404, { error: "not_found" });
      return true;
    }
    if (method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return true;
    }
    return handleApi(runtime, request, response, pathname, url);
  }

  if (pathname.startsWith("/api/")) {
    return false;
  }

  if (method !== "GET") {
    return false;
  }

  return serveStaticAsset(response, pathname);
}

function handleApi(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  url: URL
): boolean {
  if (pathname === "/api/web/overview") {
    sendJson(response, 200, buildOverview(runtime));
    return true;
  }
  if (pathname === "/api/web/health") {
    sendJson(response, 200, buildHealthStatus(runtime));
    return true;
  }
  if (pathname === "/api/web/projects") {
    sendJson(response, 200, listProjectSummaries(runtime));
    return true;
  }

  const projectMatch = /^\/api\/web\/projects\/([^/]+)(\/.*)?$/u.exec(pathname);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const rest = projectMatch[2] ?? "";
    return handleProjectRoute(runtime, request, response, projectId, rest, url);
  }

  sendJson(response, 404, { error: "not_found" });
  return true;
}

function handleProjectRoute(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  projectId: string,
  rest: string,
  url: URL
): boolean {
  if (rest === "" || rest === "/") {
    const detail = getProjectDetail(runtime, projectId);
    if (!detail) {
      sendJson(response, 404, { error: "unknown_project" });
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  if (rest === "/agents") {
    sendJson(response, 200, listAgentSummaries(runtime, projectId));
    return true;
  }

  const agentResearchMatch = /^\/agents\/([^/]+)\/research$/u.exec(rest);
  if (agentResearchMatch) {
    const agentId = decodeURIComponent(agentResearchMatch[1]);
    sendJson(response, 200, listAgentResearch(runtime, projectId, agentId));
    return true;
  }

  const agentMatch = /^\/agents\/([^/]+)$/u.exec(rest);
  if (agentMatch) {
    const detail = getAgentDetail(runtime, projectId, decodeURIComponent(agentMatch[1]));
    if (!detail) {
      sendJson(response, 404, { error: "unknown_agent" });
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  if (rest === "/conversations") {
    const agentFilter = url.searchParams.get("agentId") ?? null;
    const limit = Number(url.searchParams.get("limit") ?? "0") || undefined;
    const summaries = agentFilter
      ? listAgentConversations(runtime, projectId, agentFilter, { limit })
      : listProjectConversations(runtime, projectId, { limit });
    sendJson(response, 200, summaries);
    return true;
  }

  const conversationMatch = /^\/conversations\/([^/]+)$/u.exec(rest);
  if (conversationMatch) {
    const sessionId = decodeURIComponent(conversationMatch[1]);
    const agentId = url.searchParams.get("agentId");
    const date = url.searchParams.get("date");
    if (!agentId) {
      sendJson(response, 400, { error: "missing_agent_id" });
      return true;
    }
    const detail = getConversationDetail(runtime, projectId, agentId, sessionId, date);
    if (!detail) {
      sendJson(response, 404, { error: "unknown_session" });
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  if (rest === "/artifacts") {
    const limit = Number(url.searchParams.get("limit") ?? "0") || undefined;
    sendJson(response, 200, listProjectArtifacts(runtime, projectId, { limit }));
    return true;
  }

  if (rest === "/research") {
    sendJson(response, 200, listProjectResearch(runtime, projectId));
    return true;
  }

  const researchFileMatch = /^\/research\/([^/]+)\/file$/u.exec(rest);
  if (researchFileMatch) {
    const runId = decodeURIComponent(researchFileMatch[1]);
    const relativePath = url.searchParams.get("path") ?? "";
    const ifNoneMatch = request.headers["if-none-match"];
    const headerValue = Array.isArray(ifNoneMatch)
      ? (ifNoneMatch[0] ?? null)
      : (ifNoneMatch ?? null);
    return streamResearchFile(
      runtime,
      response,
      projectId,
      runId,
      relativePath,
      headerValue
    );
  }

  const researchDetailMatch = /^\/research\/([^/]+)$/u.exec(rest);
  if (researchDetailMatch) {
    const runId = decodeURIComponent(researchDetailMatch[1]);
    const detail = getResearchRunDetail(runtime, projectId, runId);
    if (!detail) {
      sendJson(response, 404, { error: "unknown_run" });
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  if (rest === "/gpu-runs") {
    const limit = Number(url.searchParams.get("limit") ?? "0") || undefined;
    sendJson(response, 200, listProjectGpuRuns(runtime, projectId, { limit }));
    return true;
  }

  sendJson(response, 404, { error: "not_found" });
  return true;
}

function buildOverview(runtime: OpenColabRuntime): WebOverview {
  const state = runtime.getState();
  const activeProject = runtime.getActiveProject();
  const activeAgent = runtime.getActiveAgent();
  const active: WebActiveSelection = {
    projectId: activeProject.id,
    agentId: activeAgent.id
  };

  let agentCount = 0;
  for (const project of Object.values(state.projects)) {
    agentCount += Object.keys(project.agents).length;
  }

  return {
    active,
    projectCount: Object.keys(state.projects).length,
    agentCount,
    recentSessions: listProjectConversations(runtime, activeProject.id, { limit: 6 }),
    recentArtifacts: listProjectArtifacts(runtime, activeProject.id, { limit: 6 }),
    recentGpuRuns: listProjectGpuRuns(runtime, activeProject.id, { limit: 6 }),
    health: buildHealthStatus(runtime),
    generatedAt: new Date().toISOString()
  };
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}
