/**
 * Web DTO builders for GPU runs.
 */
import fs from "node:fs";
import {
  buildExperimentRunsDir,
  readExperimentRunManifest,
  readExperimentRunStatus
} from "../../experiments.js";
import type { OpenColabRuntime } from "../../runtime.js";
import type { WebGpuRunSummary } from "../shared/types.js";

interface ListOptions {
  limit?: number;
}

export function listProjectGpuRuns(
  runtime: OpenColabRuntime,
  projectId: string,
  options: ListOptions = {}
): WebGpuRunSummary[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  const runsDir = buildExperimentRunsDir(runtime.config.rootDir, project);
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  const summaries: WebGpuRunSummary[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const status = readExperimentRunStatus(runtime.config.rootDir, project, entry.name);
    const manifest = readExperimentRunManifest(runtime.config.rootDir, project, entry.name);
    if (!status || !manifest) {
      continue;
    }
    summaries.push({
      runId: status.runId,
      projectId: project.id,
      targetId: status.targetId,
      state: status.state,
      command: manifest.command,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      startedAt: status.startedAt,
      finishedAt: status.finishedAt,
      fetchedArtifacts: [...status.fetchedArtifacts],
      message: status.message || null
    });
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return options.limit && options.limit > 0 ? summaries.slice(0, options.limit) : summaries;
}
