/**
 * Local experiment bookkeeping helpers.
 * Manages target snapshots, run manifests, mutable status, and run folder paths.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionTargetConfig,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary,
  ProjectState
} from "./types.js";
import { ensureDir, nowIso, randomDigits, safeReadJson, writeJson } from "./utils.js";

export function buildProjectExperimentsPath(rootDir: string, project: ProjectState): string {
  return path.join(rootDir, project.path, "experiments");
}

export function buildExperimentTargetsDir(rootDir: string, project: ProjectState): string {
  return path.join(buildProjectExperimentsPath(rootDir, project), "targets");
}

export function buildExperimentRunsDir(rootDir: string, project: ProjectState): string {
  return path.join(buildProjectExperimentsPath(rootDir, project), "runs");
}

export function buildExperimentTargetPath(
  rootDir: string,
  project: ProjectState,
  targetId: string
): string {
  return path.join(buildExperimentTargetsDir(rootDir, project), `${targetId}.json`);
}

export function buildExperimentRunDir(rootDir: string, project: ProjectState, runId: string): string {
  return path.join(buildExperimentRunsDir(rootDir, project), runId);
}

export function buildExperimentManifestPath(
  rootDir: string,
  project: ProjectState,
  runId: string
): string {
  return path.join(buildExperimentRunDir(rootDir, project, runId), "manifest.json");
}

export function buildExperimentStatusPath(
  rootDir: string,
  project: ProjectState,
  runId: string
): string {
  return path.join(buildExperimentRunDir(rootDir, project, runId), "status.json");
}

export function buildExperimentLogsDir(rootDir: string, project: ProjectState, runId: string): string {
  return path.join(buildExperimentRunDir(rootDir, project, runId), "logs");
}

export function buildExperimentArtifactsDir(
  rootDir: string,
  project: ProjectState,
  runId: string
): string {
  return path.join(buildExperimentRunDir(rootDir, project, runId), "artifacts");
}

export function buildExperimentSyncDir(rootDir: string, project: ProjectState, runId: string): string {
  return path.join(buildExperimentRunDir(rootDir, project, runId), "sync");
}

export function ensureProjectExperimentDirs(rootDir: string, project: ProjectState): void {
  ensureDir(buildExperimentTargetsDir(rootDir, project));
  ensureDir(buildExperimentRunsDir(rootDir, project));
}

export function ensureExperimentRunDirs(rootDir: string, project: ProjectState, runId: string): void {
  ensureProjectExperimentDirs(rootDir, project);
  ensureDir(buildExperimentRunDir(rootDir, project, runId));
  ensureDir(buildExperimentLogsDir(rootDir, project, runId));
  ensureDir(buildExperimentArtifactsDir(rootDir, project, runId));
  ensureDir(buildExperimentSyncDir(rootDir, project, runId));
}

export function writeExecutionTargetSnapshot(
  rootDir: string,
  project: ProjectState,
  target: ExecutionTargetConfig
): void {
  ensureProjectExperimentDirs(rootDir, project);
  writeJson(buildExperimentTargetPath(rootDir, project, target.id), target);
}

export function removeExecutionTargetSnapshot(
  rootDir: string,
  project: ProjectState,
  targetId: string
): void {
  const filePath = buildExperimentTargetPath(rootDir, project, targetId);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function createExperimentRunId(): string {
  const stamp = nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run-${stamp}-${randomDigits(4)}`;
}

export function createInitialRunStatus(manifest: ExperimentRunManifest): ExperimentRunStatus {
  return {
    runId: manifest.runId,
    projectId: manifest.projectId,
    agentId: manifest.agentId,
    targetId: manifest.targetId,
    backend: manifest.backend,
    state: "draft",
    stage: "draft",
    message: "Run manifest created.",
    createdAt: manifest.createdAt,
    updatedAt: manifest.createdAt,
    startedAt: null,
    finishedAt: null,
    warnings: [],
    error: null,
    pod: {
      id: null,
      name: null,
      desiredStatus: null,
      publicIp: null,
      sshPort: null,
      volumeId: manifest.targetSnapshot.volume.id,
      lastObservedAt: null
    },
    remote: {
      remoteWorkingDir: manifest.sync.remoteWorkingDir,
      remoteRunDir: null,
      launchScriptPath: null,
      bootstrapScriptPath: null,
      stdoutPath: null,
      stderrPath: null,
      bootstrapLogPath: null,
      pidFilePath: null,
      exitCodeFilePath: null,
      launchPid: null,
      exitCode: null
    },
    logs: {
      stdout: null,
      stderr: null,
      bootstrap: null,
      poller: null
    },
    fetchedArtifacts: [],
    missingArtifacts: [],
    progressEvents: []
  };
}

export function writeExperimentRunManifest(
  rootDir: string,
  project: ProjectState,
  manifest: ExperimentRunManifest
): void {
  ensureExperimentRunDirs(rootDir, project, manifest.runId);
  writeJson(buildExperimentManifestPath(rootDir, project, manifest.runId), manifest);
}

export function writeExperimentRunStatus(
  rootDir: string,
  project: ProjectState,
  status: ExperimentRunStatus
): void {
  ensureExperimentRunDirs(rootDir, project, status.runId);
  writeJson(buildExperimentStatusPath(rootDir, project, status.runId), status);
}

export function readExperimentRunManifest(
  rootDir: string,
  project: ProjectState,
  runId: string
): ExperimentRunManifest | null {
  return safeReadJson<ExperimentRunManifest | null>(
    buildExperimentManifestPath(rootDir, project, runId),
    null
  );
}

export function readExperimentRunStatus(
  rootDir: string,
  project: ProjectState,
  runId: string
): ExperimentRunStatus | null {
  return safeReadJson<ExperimentRunStatus | null>(
    buildExperimentStatusPath(rootDir, project, runId),
    null
  );
}

export function listExperimentRunSummaries(
  rootDir: string,
  project: ProjectState
): ExperimentRunSummary[] {
  const runsDir = buildExperimentRunsDir(rootDir, project);
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const summaries: ExperimentRunSummary[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const status = readExperimentRunStatus(rootDir, project, entry.name);
    const manifest = readExperimentRunManifest(rootDir, project, entry.name);
    if (!status || !manifest) {
      continue;
    }
    summaries.push({
      runId: status.runId,
      targetId: status.targetId,
      state: status.state,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      command: manifest.command
    });
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendExperimentLog(
  rootDir: string,
  project: ProjectState,
  runId: string,
  logName: "stdout" | "stderr" | "bootstrap" | "poller",
  text: string
): string {
  ensureExperimentRunDirs(rootDir, project, runId);
  const filePath = path.join(buildExperimentLogsDir(rootDir, project, runId), `${logName}.log`);
  fs.appendFileSync(filePath, text, "utf8");
  return filePath;
}

export function overwriteExperimentLog(
  rootDir: string,
  project: ProjectState,
  runId: string,
  logName: "stdout" | "stderr" | "bootstrap" | "poller",
  text: string
): string {
  ensureExperimentRunDirs(rootDir, project, runId);
  const filePath = path.join(buildExperimentLogsDir(rootDir, project, runId), `${logName}.log`);
  fs.writeFileSync(filePath, text, "utf8");
  return filePath;
}
