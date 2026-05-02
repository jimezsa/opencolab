/**
 * Web DTO builders for projects.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenColabRuntime } from "../../runtime.js";
import type { ProjectState } from "../../types.js";
import { resolveProjectAndTeamPath } from "../../agent.js";
import type {
  WebProjectDetail,
  WebProjectSummary
} from "../shared/types.js";
import { listAgentSummaries } from "./agents.js";
import { listProjectConversations } from "./conversations.js";
import { listProjectArtifacts } from "./artifacts.js";
import { listProjectGpuRuns } from "./gpu-runs.js";

export function listProjectSummaries(runtime: OpenColabRuntime): WebProjectSummary[] {
  const state = runtime.getState();
  return runtime.listProjects().map((project) =>
    buildProjectSummary(runtime, project, project.id === state.activeProjectId)
  );
}

export function getProjectDetail(
  runtime: OpenColabRuntime,
  projectId: string
): WebProjectDetail | null {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return null;
  }
  const isActive = runtime.getState().activeProjectId === project.id;
  const projectAndTeam = readProjectAndTeam(runtime, project);
  const focus = extractSection(projectAndTeam, "current focus") ?? extractSection(projectAndTeam, "focus");
  const goal = extractSection(projectAndTeam, "goal") ?? extractFirstParagraph(projectAndTeam);

  return {
    id: project.id,
    path: project.path,
    active: isActive,
    goal,
    focus,
    projectAndTeam,
    agents: listAgentSummaries(runtime, project.id),
    recentSessions: listProjectConversations(runtime, project.id, { limit: 8 }),
    recentArtifacts: listProjectArtifacts(runtime, project.id, { limit: 8 }),
    recentGpuRuns: listProjectGpuRuns(runtime, project.id, { limit: 8 })
  };
}

export function buildProjectSummary(
  runtime: OpenColabRuntime,
  project: ProjectState,
  active: boolean
): WebProjectSummary {
  const artifacts = listProjectArtifacts(runtime, project.id, { limit: 0 });
  const runs = listProjectGpuRuns(runtime, project.id, { limit: 0 });
  const conversations = listProjectConversations(runtime, project.id, { limit: 1 });
  return {
    id: project.id,
    path: project.path,
    active,
    agentCount: Object.keys(project.agents).length,
    artifactCount: artifacts.length,
    runCount: runs.length,
    recentActivityAt:
      conversations[0]?.lastMessageAt ?? runs[0]?.updatedAt ?? null
  };
}

function readProjectAndTeam(
  runtime: OpenColabRuntime,
  project: ProjectState
): string | null {
  const filePath = resolveProjectAndTeamPath(runtime.config.rootDir, project.path);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function extractSection(content: string | null, heading: string): string | null {
  if (!content) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  const target = heading.toLowerCase();
  let inside = false;
  const collected: string[] = [];
  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+)$/u.exec(line.trim());
    if (headingMatch) {
      if (inside) {
        break;
      }
      if (headingMatch[1].toLowerCase().includes(target)) {
        inside = true;
        continue;
      }
      continue;
    }
    if (inside) {
      collected.push(line);
    }
  }
  const result = collected.join("\n").trim();
  return result || null;
}

function extractFirstParagraph(content: string | null): string | null {
  if (!content) {
    return null;
  }
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
  return paragraphs[0] ?? null;
}

void path;
