/**
 * Web DTO builders for agents.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenColabRuntime } from "../../runtime.js";
import { resolveAgentDirectory } from "../../agent.js";
import type { AgentConfig, ProjectState } from "../../types.js";
import type { WebAgentDetail, WebAgentSummary } from "../shared/types.js";
import { listAgentConversations } from "./conversations.js";

export function listAgentSummaries(
  runtime: OpenColabRuntime,
  projectId: string
): WebAgentSummary[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  return Object.values(project.agents)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((agent) => buildAgentSummary(runtime, project, agent));
}

export function getAgentDetail(
  runtime: OpenColabRuntime,
  projectId: string,
  agentId: string
): WebAgentDetail | null {
  const project = runtime.getState().projects[projectId];
  const agent = project?.agents[agentId];
  if (!project || !agent) {
    return null;
  }
  const summary = buildAgentSummary(runtime, project, agent);
  const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
  return {
    ...summary,
    todo: readAgentFile(agentDir, agent.files.todo),
    memory: readAgentFile(agentDir, agent.files.memory),
    heartbeatRaw: readAgentFile(agentDir, "HEARTBEAT.md"),
    recentSessions: listAgentConversations(runtime, projectId, agentId, { limit: 8 })
  };
}

function buildAgentSummary(
  runtime: OpenColabRuntime,
  project: ProjectState,
  agent: AgentConfig
): WebAgentSummary {
  const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
  const todoSummary = summarizeMarkdown(readAgentFile(agentDir, agent.files.todo));
  const heartbeat = project.heartbeat.pending?.agentId === agent.id
    ? project.heartbeat.pending
    : null;
  return {
    id: agent.id,
    projectId: project.id,
    path: agent.path,
    active: project.activeAgentId === agent.id,
    provider: {
      name: agent.provider.name,
      model: agent.provider.model,
      authMode: agent.provider.authMode,
      reasoningEffort: agent.provider.reasoningEffort ?? null
    },
    todoSummary,
    heartbeat
  };
}

function readAgentFile(agentDir: string, fileName: string): string {
  const filePath = path.join(agentDir, fileName);
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function summarizeMarkdown(content: string): string | null {
  if (!content.trim()) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  const bulletItems: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      bulletItems.push(line.replace(/^([-*+]|\d+\.)\s+/, ""));
      if (bulletItems.length >= 3) {
        break;
      }
    }
  }
  if (bulletItems.length > 0) {
    return bulletItems.join(" • ");
  }
  const firstParagraph = content
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
  if (!firstParagraph) {
    return null;
  }
  return firstParagraph.length > 240
    ? `${firstParagraph.slice(0, 237)}...`
    : firstParagraph;
}
