/**
 * Web DTO builders for conversation sessions.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveAgentDirectory } from "../../agent.js";
import type { OpenColabRuntime } from "../../runtime.js";
import type { AgentConfig, ConversationMessage, ProjectState } from "../../types.js";
import type { WebConversationSummary } from "../shared/types.js";

interface ListOptions {
  limit?: number;
}

export function listProjectConversations(
  runtime: OpenColabRuntime,
  projectId: string,
  options: ListOptions = {}
): WebConversationSummary[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  const collected: WebConversationSummary[] = [];
  for (const agent of Object.values(project.agents)) {
    collected.push(...collectAgentSessions(runtime, project, agent));
  }
  collected.sort((a, b) =>
    (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")
  );
  return options.limit && options.limit > 0 ? collected.slice(0, options.limit) : collected;
}

export function listAgentConversations(
  runtime: OpenColabRuntime,
  projectId: string,
  agentId: string,
  options: ListOptions = {}
): WebConversationSummary[] {
  const project = runtime.getState().projects[projectId];
  const agent = project?.agents[agentId];
  if (!project || !agent) {
    return [];
  }
  const sessions = collectAgentSessions(runtime, project, agent).sort((a, b) =>
    (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")
  );
  return options.limit && options.limit > 0 ? sessions.slice(0, options.limit) : sessions;
}

function collectAgentSessions(
  runtime: OpenColabRuntime,
  project: ProjectState,
  agent: AgentConfig
): WebConversationSummary[] {
  const sessionsDir = sessionsDirFor(runtime, agent);
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  const activeSessionId = readActiveSessionId(sessionsDir);
  const summaries: WebConversationSummary[] = [];
  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sessionId = entry.name;
    const sessionDir = path.join(sessionsDir, sessionId);
    const dayFiles = fs
      .readdirSync(sessionDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    const latestFile = dayFiles[dayFiles.length - 1];
    if (!latestFile) {
      continue;
    }
    const filePath = path.join(sessionDir, latestFile);
    const messages = readMessages(filePath);
    if (messages.length === 0) {
      continue;
    }
    const lastMessage = messages[messages.length - 1];
    summaries.push({
      sessionId,
      projectId: project.id,
      agentId: agent.id,
      date: latestFile.replace(/\.jsonl$/u, ""),
      active: sessionId === activeSessionId,
      messageCount: messages.length,
      lastMessageAt: lastMessage?.at ?? null,
      lastMessagePreview: lastMessage ? previewMessage(lastMessage.content) : null
    });
  }
  return summaries;
}

function sessionsDirFor(runtime: OpenColabRuntime, agent: AgentConfig): string {
  const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
  return path.join(agentDir, "memory", "Session");
}

function readActiveSessionId(sessionsDir: string): string | null {
  const markerPath = path.join(sessionsDir, ".active-session");
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  const value = fs.readFileSync(markerPath, "utf8").trim();
  return value || null;
}

function readMessages(filePath: string): ConversationMessage[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const out: ConversationMessage[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ConversationMessage;
      if (parsed && (parsed.role === "user" || parsed.role === "assistant")) {
        out.push(parsed);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

function previewMessage(content: string): string {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 157)}...`;
}
