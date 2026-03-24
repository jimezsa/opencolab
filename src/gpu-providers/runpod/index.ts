/**
 * Runpod-backed remote GPU execution orchestration.
 * Owns target validation, Pod lifecycle, SSH sync/bootstrap/launch, and local run reconciliation.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenColabConfig } from "../../config.js";
import {
  appendExperimentLog,
  buildExperimentArtifactsDir,
  buildExperimentLogsDir,
  buildExperimentRunDir,
  buildExperimentSyncDir,
  createExperimentRunId,
  createInitialRunStatus,
  ensureExperimentRunDirs,
  ensureProjectExperimentDirs,
  listExperimentRunSummaries,
  overwriteExperimentLog,
  readExperimentRunManifest,
  readExperimentRunStatus,
  writeExperimentRunManifest,
  writeExperimentRunStatus
} from "../../experiments.js";
import type {
  AgentConfig,
  ExecutionTargetConfig,
  ExecutionTargetTestResult,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary,
  ProjectState,
  TaskProgressEvent
} from "../../types.js";
import { resolveEnvVar, resolveRunpodApiKey, RUNPOD_API_KEY_ENV_VAR } from "../../secrets.js";
import { ensureDir, nowIso, writeJson } from "../../utils.js";

const RUNPOD_API_BASE_URL = "https://rest.runpod.io/v1";
const DEFAULT_REMOTE_RUN_ROOT = "/workspace/.opencolab/runs";
const DEFAULT_SSH_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STATE_POLL_INTERVAL_MS = 10 * 1000;
const DEFAULT_EXCLUDE_PATHS = [
  ".git/",
  ".env.local",
  ".opencolab/",
  "node_modules/",
  "dist/",
  "projects/*/AGENTS/*/memory/",
  "projects/*/experiments/runs/"
];

interface RunpodNetworkVolume {
  id: string;
  name: string;
  size: number;
  dataCenterId: string;
}

interface RunpodPod {
  id: string;
  name: string | null;
  desiredStatus: string | null;
  image: string | null;
  publicIp: string | null;
  portMappings: Record<string, number>;
  volumeMountPath: string | null;
  networkVolume: RunpodNetworkVolume | null;
  machine: {
    dataCenterId: string | null;
    secureCloud: boolean | null;
    gpuTypeDisplayName: string | null;
  };
  gpuCount: number | null;
  costPerHr: string | null;
}

interface RunpodSshConnection {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string | null;
  pod: RunpodPod;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunpodJobStartInput {
  target: ExecutionTargetConfig;
  command: string;
  includePaths?: string[];
  excludePaths?: string[];
  expectedArtifacts?: string[];
  envVarNames?: string[];
  strictArtifacts?: boolean;
  maxRuntimeMinutes?: number;
  wait?: boolean;
  requestedBy?: "cli" | "agent";
  onProgress?: (event: TaskProgressEvent) => void;
}

export interface RunpodExecutionService {
  testTarget(project: ProjectState, target: ExecutionTargetConfig): Promise<ExecutionTargetTestResult>;
  startRun(
    project: ProjectState,
    agent: AgentConfig,
    input: RunpodJobStartInput
  ): Promise<ExperimentRunStatus>;
  reconcileRun(project: ProjectState, runId: string): Promise<ExperimentRunStatus>;
  fetchRunOutputs(project: ProjectState, runId: string): Promise<ExperimentRunStatus>;
  cancelRun(project: ProjectState, runId: string): Promise<ExperimentRunStatus>;
  listRuns(project: ProjectState): ExperimentRunSummary[];
  readLocalStatus(project: ProjectState, runId: string): ExperimentRunStatus | null;
  readLocalManifest(project: ProjectState, runId: string): ExperimentRunManifest | null;
}

export class RunpodExecutionServiceImpl implements RunpodExecutionService {
  constructor(private readonly config: OpenColabConfig) {}

  listRuns(project: ProjectState): ExperimentRunSummary[] {
    return listExperimentRunSummaries(this.config.rootDir, project);
  }

  readLocalStatus(project: ProjectState, runId: string): ExperimentRunStatus | null {
    return readExperimentRunStatus(this.config.rootDir, project, runId);
  }

  readLocalManifest(project: ProjectState, runId: string): ExperimentRunManifest | null {
    return readExperimentRunManifest(this.config.rootDir, project, runId);
  }

  async testTarget(project: ProjectState, target: ExecutionTargetConfig): Promise<ExecutionTargetTestResult> {
    const details: string[] = [];
    const warnings: string[] = [];

    this.validateTargetEnabled(target);
    this.requireRunpodApiKey();
    details.push(`Found ${RUNPOD_API_KEY_ENV_VAR} in environment.`);

    for (const command of ["ssh", "scp", "tar"]) {
      if (!isCommandAvailable(command)) {
        throw new Error(`Missing required local dependency: ${command}`);
      }
      details.push(`Local dependency available: ${command}`);
    }

    const volumes = await this.listNetworkVolumes();
    const volume = this.findMatchingVolume(target, volumes);
    if (volume) {
      details.push(`Network volume ready: ${volume.name} (${volume.id})`);
    } else {
      warnings.push(
        `Network volume '${target.volume.name}' was not found in ${target.datacenterId}. It will be created on first job start.`
      );
    }

    const pods = await this.listPods();
    const compatibleWarmPod = volume
      ? pods.find((pod) => this.isCompatiblePod(project, target, volume, pod))
      : null;
    if (compatibleWarmPod) {
      details.push(
        `Compatible Pod detected: ${compatibleWarmPod.id} (${compatibleWarmPod.desiredStatus ?? "unknown"})`
      );
    } else {
      details.push("No compatible warm Pod detected. A new Pod will be provisioned when needed.");
    }

    if (!target.imageName && !target.templateId) {
      warnings.push("Target has no image or template configured. Pod creation will fail until one is configured.");
    }
    if (!target.ssh.privateKeyPath) {
      warnings.push(
        "No SSH private key path is configured on the target. OpenSSH defaults will be used; if Runpod rejects them, configure --ssh-key-path."
      );
    }

    return {
      ok: warnings.length === 0,
      targetId: target.id,
      backend: target.backend,
      warnings,
      details
    };
  }

  async startRun(
    project: ProjectState,
    agent: AgentConfig,
    input: RunpodJobStartInput
  ): Promise<ExperimentRunStatus> {
    const target = input.target;
    this.validateTargetEnabled(target);
    const waitForCompletion = input.wait ?? true;
    const createdAt = nowIso();
    const syncPlan = this.buildSyncPlan(project, target, input.includePaths, input.excludePaths);
    const manifest: ExperimentRunManifest = {
      runId: createExperimentRunId(),
      projectId: project.id,
      agentId: agent.id,
      targetId: target.id,
      backend: target.backend,
      requestedBy: input.requestedBy ?? "cli",
      createdAt,
      command: input.command.trim(),
      envVarNames: this.normalizeEnvVarNames(input.envVarNames),
      expectedArtifacts: this.normalizeArtifactPaths(input.expectedArtifacts),
      strictArtifacts: input.strictArtifacts ?? false,
      maxRuntimeMinutes: this.resolveMaxRuntimeMinutes(target, input.maxRuntimeMinutes),
      sourceRevision: resolveGitRevision(this.config.rootDir),
      sync: syncPlan,
      targetSnapshot: target
    };

    ensureProjectExperimentDirs(this.config.rootDir, project);
    ensureExperimentRunDirs(this.config.rootDir, project, manifest.runId);
    writeExperimentRunManifest(this.config.rootDir, project, manifest);

    let status = createInitialRunStatus(manifest);
    status.logs.poller = path.join(buildExperimentLogsDir(this.config.rootDir, project, manifest.runId), "poller.log");
    writeExperimentRunStatus(this.config.rootDir, project, status);
    this.writeSyncMetadata(project, manifest);

    const emit = (event: TaskProgressEvent): void => {
      status = {
        ...status,
        stage: event.stage ?? status.stage,
        message: event.message,
        updatedAt: nowIso(),
        progressEvents: [...status.progressEvents, event],
        warnings:
          event.kind === "warning" ? [...status.warnings, event.message] : [...status.warnings]
      };
      writeExperimentRunStatus(this.config.rootDir, project, status);
      if (event.kind === "warning") {
        this.appendPollerLog(project, manifest.runId, `warning: ${event.message}`);
      } else {
        this.appendPollerLog(project, manifest.runId, `${event.kind}: ${event.message}`);
      }
      input.onProgress?.(event);
    };

    const setStatus = (patch: Partial<ExperimentRunStatus>): ExperimentRunStatus => {
      status = {
        ...status,
        ...patch,
        updatedAt: nowIso(),
        pod: patch.pod ? { ...status.pod, ...patch.pod } : status.pod,
        remote: patch.remote ? { ...status.remote, ...patch.remote } : status.remote,
        logs: patch.logs ? { ...status.logs, ...patch.logs } : status.logs,
        warnings: patch.warnings ? [...patch.warnings] : status.warnings,
        fetchedArtifacts: patch.fetchedArtifacts ? [...patch.fetchedArtifacts] : status.fetchedArtifacts,
        missingArtifacts: patch.missingArtifacts ? [...patch.missingArtifacts] : status.missingArtifacts,
        progressEvents: patch.progressEvents ? [...patch.progressEvents] : status.progressEvents
      };
      writeExperimentRunStatus(this.config.rootDir, project, status);
      return status;
    };

    let connection: RunpodSshConnection | null = null;
    emit({
      kind: "started",
      stage: "validating",
      message: `Validating Runpod target '${target.id}'.`
    });
    status = setStatus({
      state: "validating",
      startedAt: createdAt
    });

    try {
      this.requireRunpodApiKey();
      this.validateCommandInput(input.command);
      this.validateLocalDependencies();
      this.validateEnvVars(manifest.envVarNames);
      this.validateSyncPlan(syncPlan);

      const volume = await this.ensureNetworkVolume(target);
      status = setStatus({
        pod: {
          ...status.pod,
          volumeId: volume.id
        }
      });

      emit({
        kind: "milestone",
        stage: "provisioning",
        message: `Provisioning Runpod Pod for target '${target.id}'.`
      });
      status = setStatus({ state: "provisioning" });
      const pod = await this.ensureCompatiblePod(project, target, volume);
      status = this.updateStatusFromPod(project, status, pod);

      emit({
        kind: "milestone",
        stage: "waiting_for_ssh",
        message: "Waiting for Pod SSH access."
      });
      status = setStatus({ state: "waiting_for_ssh" });
      connection = await this.waitForSsh(target, status);
      status = this.updateStatusFromPod(project, status, connection.pod);

      emit({
        kind: "progress",
        stage: "syncing",
        current: syncPlan.fileCount,
        total: syncPlan.fileCount,
        message: `Syncing ${syncPlan.fileCount} files to ${target.workspaceRoot}.`
      });
      status = setStatus({ state: "syncing" });
      await this.syncWorkspace(project, manifest, connection);

      emit({
        kind: "milestone",
        stage: "bootstrapping",
        message: `Running bootstrap profile '${target.bootstrapProfile}'.`
      });
      status = setStatus({ state: "bootstrapping" });
      status = await this.runBootstrap(project, manifest, status, connection);

      emit({
        kind: "milestone",
        stage: "running",
        message: "Launching detached remote command."
      });
      status = setStatus({ state: "running" });
      status = await this.launchDetachedCommand(project, manifest, status, connection);

      if (!waitForCompletion) {
        return status;
      }

      return this.waitForTerminalState(project, manifest.runId, input.onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = setStatus({
        state: "failed",
        error: message,
        message,
        finishedAt: nowIso()
      });
      if (connection) {
        try {
          status = await this.fetchLogsSnapshot(project, manifest, status, connection);
        } catch {
          // Preserve the original run failure even if log collection also degrades.
        }
      }
      status = await this.applyAutoStopPolicy(project, manifest, status, connection);
      return status;
    }
  }

  async reconcileRun(project: ProjectState, runId: string): Promise<ExperimentRunStatus> {
    const manifest = this.requireManifest(project, runId);
    let status = this.requireStatus(project, runId);
    if (isTerminalRunState(status.state)) {
      return status;
    }

    const pod = status.pod.id ? await this.getPodOrNull(status.pod.id) : null;
    if (!pod) {
      status = this.persistStatus(project, {
        ...status,
        state: "failed",
        stage: "running",
        message: "Runpod Pod is no longer available.",
        error: "Runpod Pod is no longer available.",
        finishedAt: nowIso()
      });
      return status;
    }

    status = this.updateStatusFromPod(project, status, pod);
    const connection = await this.tryOpenSshConnection(manifest.targetSnapshot, pod);
    if (!connection) {
      status = this.persistStatus(project, {
        ...status,
        state: "running_unreachable",
        message: "Pod is still alive but SSH is temporarily unavailable.",
        warnings: addUniqueValue(status.warnings, "Pod is still alive but SSH is temporarily unavailable.")
      });
      return status;
    }

    status = await this.fetchLogsSnapshot(project, manifest, status, connection);
    status = await this.inspectRemoteRun(project, manifest, status, connection);
    if (status.state === "fetching") {
      status = await this.finalizeCompletedRun(project, manifest, status, connection);
    }
    return status;
  }

  async fetchRunOutputs(project: ProjectState, runId: string): Promise<ExperimentRunStatus> {
    const manifest = this.requireManifest(project, runId);
    let status = this.requireStatus(project, runId);
    const pod = status.pod.id ? await this.getPodOrNull(status.pod.id) : null;
    if (!pod) {
      return status;
    }
    const connection = await this.tryOpenSshConnection(manifest.targetSnapshot, pod);
    if (!connection) {
      return status;
    }
    status = await this.fetchLogsSnapshot(project, manifest, status, connection);
    status = await this.fetchArtifacts(project, manifest, status, connection);
    return status;
  }

  async cancelRun(project: ProjectState, runId: string): Promise<ExperimentRunStatus> {
    const manifest = this.requireManifest(project, runId);
    let status = this.requireStatus(project, runId);
    if (isTerminalRunState(status.state)) {
      return status;
    }

    const pod = status.pod.id ? await this.getPodOrNull(status.pod.id) : null;
    const connection = pod ? await this.tryOpenSshConnection(manifest.targetSnapshot, pod) : null;
    if (connection && status.remote.pidFilePath) {
      await this.runRemoteScript(
        connection,
        `if [ -f ${shellQuote(status.remote.pidFilePath)} ]; then kill "$(cat ${shellQuote(
          status.remote.pidFilePath
        )})" >/dev/null 2>&1 || true; fi`
      );
      status = await this.fetchLogsSnapshot(project, manifest, status, connection);
    }

    if (pod) {
      await this.stopPod(pod.id);
    }

    status = this.persistStatus(project, {
      ...status,
      state: "cancelled",
      message: "Remote run cancelled.",
      finishedAt: nowIso()
    });
    return status;
  }

  private async waitForTerminalState(
    project: ProjectState,
    runId: string,
    onProgress?: (event: TaskProgressEvent) => void
  ): Promise<ExperimentRunStatus> {
    while (true) {
      let status = await this.reconcileRun(project, runId);
      if (status.state === "running_unreachable") {
        onProgress?.({
          kind: "warning",
          stage: "running_unreachable",
          message: status.message
        });
      }
      if (isTerminalRunState(status.state)) {
        if (status.state === "completed") {
          onProgress?.({
            kind: "completed",
            stage: "completed",
            message: `Run '${runId}' completed.`
          });
        }
        return status;
      }
      await sleep(DEFAULT_STATE_POLL_INTERVAL_MS);
    }
  }

  private async finalizeCompletedRun(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    let next = await this.fetchArtifacts(project, manifest, status, connection);
    next = await this.applyAutoStopPolicy(project, manifest, next, connection);
    return next;
  }

  private async fetchArtifacts(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    const foundPaths: string[] = [];
    const missingPaths: string[] = [];
    if (manifest.expectedArtifacts.length > 0) {
      const inspection = await this.inspectArtifactPaths(connection, manifest);
      foundPaths.push(...inspection.foundPaths);
      missingPaths.push(...inspection.missingPaths);
      if (foundPaths.length > 0) {
        await this.downloadArtifactBundle(project, manifest, connection, foundPaths);
      }
    }

    let next = this.persistStatus(project, {
      ...status,
      state: "fetching",
      message: "Collecting logs and artifacts.",
      fetchedArtifacts: foundPaths,
      missingArtifacts: missingPaths
    });

    const exitCode = next.remote.exitCode ?? 1;
    const success = exitCode === 0;
    if (missingPaths.length > 0 && manifest.strictArtifacts) {
      next = this.persistStatus(project, {
        ...next,
        state: "failed",
        message: "Declared artifacts were missing.",
        error: "Declared artifacts were missing.",
        warnings: addUniqueValue(next.warnings, "Declared artifacts were missing."),
        finishedAt: nowIso()
      });
      return next;
    }

    next = this.persistStatus(project, {
      ...next,
      state: success ? "completed" : "failed",
      message: success ? "Remote run completed." : `Remote command exited with code ${String(exitCode)}.`,
      error: success ? null : `Remote command exited with code ${String(exitCode)}.`,
      warnings:
        missingPaths.length > 0
          ? addUniqueValue(next.warnings, `Missing expected artifacts: ${missingPaths.join(", ")}`)
          : next.warnings,
      finishedAt: nowIso()
    });
    return next;
  }

  private async inspectRemoteRun(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    if (!status.remote.pidFilePath || !status.remote.exitCodeFilePath) {
      return status;
    }

    const inspection = await this.runRemoteScript(
      connection,
      [
        "set -euo pipefail",
        `if [ -f ${shellQuote(status.remote.exitCodeFilePath)} ]; then`,
        `  printf 'EXIT_CODE\\t%s\\n' "$(cat ${shellQuote(status.remote.exitCodeFilePath)})"`,
        "fi",
        `if [ -f ${shellQuote(status.remote.pidFilePath)} ]; then`,
        `  printf 'PID\\t%s\\n' "$(cat ${shellQuote(status.remote.pidFilePath)})"`,
        `  if kill -0 "$(cat ${shellQuote(status.remote.pidFilePath)})" >/dev/null 2>&1; then`,
        "    printf 'RUNNING\\t1\\n'",
        "  else",
        "    printf 'RUNNING\\t0\\n'",
        "  fi",
        "fi"
      ].join("\n")
    );

    let exitCode: number | null = null;
    let running = false;
    for (const line of inspection.stdout.split(/\r?\n/)) {
      const [kind, value] = line.split("\t");
      if (kind === "EXIT_CODE") {
        exitCode = Number(value);
      }
      if (kind === "RUNNING" && value === "1") {
        running = true;
      }
    }

    let next = this.persistStatus(project, {
      ...status,
      remote: {
        ...status.remote,
        exitCode
      }
    });

    if (exitCode !== null) {
      next = this.persistStatus(project, {
        ...next,
        state: "fetching",
        message: "Remote process finished. Fetching logs and artifacts."
      });
      return next;
    }

    if (running) {
      if (hasRunTimedOut(manifest, next)) {
        await this.stopPodIfPresent(next);
        next = this.persistStatus(project, {
          ...next,
          state: "timed_out",
          message: "Remote run exceeded max runtime and was stopped.",
          error: "Remote run exceeded max runtime and was stopped.",
          finishedAt: nowIso()
        });
      } else {
        next = this.persistStatus(project, {
          ...next,
          state: "running",
          message: "Remote process is still running."
        });
      }
      return next;
    }

    next = this.persistStatus(project, {
      ...next,
      state: "failed",
      message: "Remote process exited without reporting an exit code.",
      error: "Remote process exited without reporting an exit code.",
      finishedAt: nowIso()
    });
    return next;
  }

  private async applyAutoStopPolicy(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection | null
  ): Promise<ExperimentRunStatus> {
    if (manifest.targetSnapshot.autoStopPolicy !== "stop_on_completion" || !status.pod.id) {
      return status;
    }

    try {
      await this.stopPod(status.pod.id);
      return this.persistStatus(project, {
        ...status,
        pod: {
          ...status.pod,
          desiredStatus: "EXITED",
          lastObservedAt: nowIso()
        }
      });
    } catch (error) {
      if (connection) {
        try {
          await this.fetchLogsSnapshot(project, manifest, status, connection);
        } catch {
          // Preserve cleanup failure as the surfaced issue.
        }
      }
      return this.persistStatus(project, {
        ...status,
        state: "cleanup_failed",
        message: "Remote cleanup failed after the run completed.",
        error: error instanceof Error ? error.message : String(error),
        warnings: addUniqueValue(status.warnings, "Remote cleanup failed after the run completed.")
      });
    }
  }

  private async ensureNetworkVolume(target: ExecutionTargetConfig): Promise<RunpodNetworkVolume> {
    const volumes = await this.listNetworkVolumes();
    const existing = this.findMatchingVolume(target, volumes);
    if (existing) {
      return existing;
    }
    return this.createNetworkVolume(target);
  }

  private findMatchingVolume(
    target: ExecutionTargetConfig,
    volumes: RunpodNetworkVolume[]
  ): RunpodNetworkVolume | null {
    if (target.volume.id) {
      const byId = volumes.find((candidate) => candidate.id === target.volume.id);
      if (byId) {
        return byId;
      }
    }
    return (
      volumes.find(
        (candidate) =>
          candidate.name === target.volume.name && candidate.dataCenterId === target.datacenterId
      ) ?? null
    );
  }

  private async ensureCompatiblePod(
    project: ProjectState,
    target: ExecutionTargetConfig,
    volume: RunpodNetworkVolume
  ): Promise<RunpodPod> {
    const pods = await this.listPods();
    const compatible = pods.find((pod) => this.isCompatiblePod(project, target, volume, pod));
    if (compatible) {
      if (compatible.desiredStatus === "EXITED") {
        await this.startPod(compatible.id);
        await sleep(5_000);
        return (await this.getPod(compatible.id)) ?? compatible;
      }
      return compatible;
    }
    return this.createPod(project, target, volume);
  }

  private isCompatiblePod(
    project: ProjectState,
    target: ExecutionTargetConfig,
    volume: RunpodNetworkVolume,
    pod: RunpodPod
  ): boolean {
    if (pod.desiredStatus === "TERMINATED") {
      return false;
    }
    if (!pod.networkVolume || pod.networkVolume.id !== volume.id) {
      return false;
    }
    if (pod.machine.dataCenterId !== target.datacenterId) {
      return false;
    }
    if (pod.machine.secureCloud !== true) {
      return false;
    }
    if (pod.gpuCount !== target.gpuCount) {
      return false;
    }
    if (pod.machine.gpuTypeDisplayName !== target.gpuType) {
      return false;
    }
    const expectedName = buildPodName(project, target);
    return pod.name === expectedName;
  }

  private async waitForSsh(
    target: ExecutionTargetConfig,
    status: ExperimentRunStatus
  ): Promise<RunpodSshConnection> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < DEFAULT_SSH_WAIT_TIMEOUT_MS) {
      const pod = status.pod.id ? await this.getPod(status.pod.id) : null;
      if (!pod) {
        throw new Error("Runpod Pod disappeared while waiting for SSH.");
      }
      const connection = await this.tryOpenSshConnection(target, pod);
      if (connection) {
        return connection;
      }
      await sleep(5_000);
    }
    throw new Error("Timed out waiting for Pod SSH access.");
  }

  private async tryOpenSshConnection(
    target: ExecutionTargetConfig,
    pod: RunpodPod
  ): Promise<RunpodSshConnection | null> {
    const sshPort = pod.portMappings["22"] ?? target.ssh.port;
    if (!pod.publicIp || !sshPort) {
      return null;
    }

    const connection: RunpodSshConnection = {
      host: pod.publicIp,
      port: sshPort,
      user: target.ssh.user ?? "root",
      privateKeyPath: target.ssh.privateKeyPath,
      pod
    };

    try {
      await this.runRemoteScript(connection, "true");
      return connection;
    } catch {
      return null;
    }
  }

  private async syncWorkspace(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    connection: RunpodSshConnection
  ): Promise<void> {
    const selectedFiles = this.collectSyncFiles(manifest.sync.includePaths, manifest.sync.excludePaths);
    const syncDir = buildExperimentSyncDir(this.config.rootDir, project, manifest.runId);
    const listPath = path.join(syncDir, "files.txt");
    fs.writeFileSync(listPath, `${selectedFiles.join("\n")}\n`, "utf8");

    const archivePath = path.join(os.tmpdir(), `${manifest.runId}-sync.tar.gz`);
    try {
      await this.runLocalCommand(
        "tar",
        ["-czf", archivePath, "-C", this.config.rootDir, "-T", listPath],
        {
          COPYFILE_DISABLE: "1",
          COPY_EXTENDED_ATTRIBUTES_DISABLE: "1"
        }
      );
      const remoteArchivePath = path.posix.join(
        manifest.targetSnapshot.workspaceRoot,
        `.opencolab-sync-${manifest.runId}.tar.gz`
      );
      await this.ensureRemoteDir(connection, manifest.targetSnapshot.workspaceRoot);
      await this.copyFileToRemote(connection, archivePath, remoteArchivePath);
      await this.runRemoteScript(
        connection,
        [
          "set -euo pipefail",
          `mkdir -p ${shellQuote(manifest.targetSnapshot.workspaceRoot)}`,
          `tar --no-same-owner -xzf ${shellQuote(remoteArchivePath)} -C ${shellQuote(
            manifest.targetSnapshot.workspaceRoot
          )}`,
          `rm -f ${shellQuote(remoteArchivePath)}`,
          `mkdir -p ${shellQuote(path.posix.dirname(manifest.sync.remoteWorkingDir))}`,
          `test -d ${shellQuote(manifest.sync.remoteWorkingDir)}`
        ].join("\n")
      );
    } finally {
      if (fs.existsSync(archivePath)) {
        fs.rmSync(archivePath, { force: true });
      }
    }
  }

  private async runBootstrap(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    const remoteRunDir = this.resolveRemoteRunDir(manifest);
    const remoteBootstrapScriptPath = path.posix.join(remoteRunDir, "bootstrap.sh");
    const remoteBootstrapLogPath = path.posix.join(remoteRunDir, "bootstrap.log");
    await this.ensureRemoteDir(connection, remoteRunDir);

    const localScriptPath = path.join(os.tmpdir(), `${manifest.runId}-bootstrap.sh`);
    try {
      fs.writeFileSync(
        localScriptPath,
        buildBootstrapScript(manifest.targetSnapshot.bootstrapProfile, manifest.sync.remoteWorkingDir, remoteBootstrapLogPath),
        "utf8"
      );
      await this.copyFileToRemote(connection, localScriptPath, remoteBootstrapScriptPath);
      await this.runRemoteScript(connection, `bash ${shellQuote(remoteBootstrapScriptPath)}`);
      let next = this.persistStatus(project, {
        ...status,
        remote: {
          ...status.remote,
          remoteRunDir,
          bootstrapScriptPath: remoteBootstrapScriptPath,
          bootstrapLogPath: remoteBootstrapLogPath
        }
      });
      next = await this.fetchLogsSnapshot(project, manifest, next, connection);
      return next;
    } finally {
      if (fs.existsSync(localScriptPath)) {
        fs.rmSync(localScriptPath, { force: true });
      }
    }
  }

  private async launchDetachedCommand(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    const remoteRunDir = status.remote.remoteRunDir ?? this.resolveRemoteRunDir(manifest);
    const remoteLaunchScriptPath = path.posix.join(remoteRunDir, "launch.sh");
    const remoteStdoutPath = path.posix.join(remoteRunDir, "stdout.log");
    const remoteStderrPath = path.posix.join(remoteRunDir, "stderr.log");
    const remotePidFilePath = path.posix.join(remoteRunDir, "wrapper.pid");
    const remoteExitCodePath = path.posix.join(remoteRunDir, "exit-code.txt");

    const localScriptPath = path.join(os.tmpdir(), `${manifest.runId}-launch.sh`);
    try {
      fs.writeFileSync(
        localScriptPath,
        buildLaunchScript({
          command: manifest.command,
          envVarNames: manifest.envVarNames,
          remoteWorkingDir: manifest.sync.remoteWorkingDir,
          stdoutPath: remoteStdoutPath,
          stderrPath: remoteStderrPath,
          exitCodePath: remoteExitCodePath,
          bootstrapProfile: manifest.targetSnapshot.bootstrapProfile
        }),
        "utf8"
      );
      await this.copyFileToRemote(connection, localScriptPath, remoteLaunchScriptPath);
      const launch = await this.runRemoteScript(
        connection,
        [
          "set -euo pipefail",
          `mkdir -p ${shellQuote(remoteRunDir)}`,
          `rm -f ${shellQuote(remoteExitCodePath)} ${shellQuote(remotePidFilePath)}`,
          `nohup bash ${shellQuote(remoteLaunchScriptPath)} >/dev/null 2>&1 & echo $! > ${shellQuote(
            remotePidFilePath
          )}`,
          `cat ${shellQuote(remotePidFilePath)}`
        ].join("\n")
      );
      const launchPid = Number(launch.stdout.trim());
      const next = this.persistStatus(project, {
        ...status,
        remote: {
          ...status.remote,
          remoteRunDir,
          launchScriptPath: remoteLaunchScriptPath,
          stdoutPath: remoteStdoutPath,
          stderrPath: remoteStderrPath,
          pidFilePath: remotePidFilePath,
          exitCodeFilePath: remoteExitCodePath,
          launchPid: Number.isFinite(launchPid) ? launchPid : null
        }
      });
      return next;
    } finally {
      if (fs.existsSync(localScriptPath)) {
        fs.rmSync(localScriptPath, { force: true });
      }
    }
  }

  private async fetchLogsSnapshot(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    status: ExperimentRunStatus,
    connection: RunpodSshConnection
  ): Promise<ExperimentRunStatus> {
    const updates = { ...status.logs };
    if (status.remote.stdoutPath) {
      updates.stdout = await this.tryCopyRemoteFileToLocal(
        project,
        manifest.runId,
        connection,
        status.remote.stdoutPath,
        "stdout"
      );
    }
    if (status.remote.stderrPath) {
      updates.stderr = await this.tryCopyRemoteFileToLocal(
        project,
        manifest.runId,
        connection,
        status.remote.stderrPath,
        "stderr"
      );
    }
    if (status.remote.bootstrapLogPath) {
      updates.bootstrap = await this.tryCopyRemoteFileToLocal(
        project,
        manifest.runId,
        connection,
        status.remote.bootstrapLogPath,
        "bootstrap"
      );
    }
    return this.persistStatus(project, {
      ...status,
      logs: updates
    });
  }

  private async tryCopyRemoteFileToLocal(
    project: ProjectState,
    runId: string,
    connection: RunpodSshConnection,
    remotePath: string,
    logName: "stdout" | "stderr" | "bootstrap"
  ): Promise<string | null> {
    const localPath = path.join(buildExperimentLogsDir(this.config.rootDir, project, runId), `${logName}.log`);
    try {
      await this.copyFileFromRemote(connection, remotePath, localPath);
      return localPath;
    } catch {
      return null;
    }
  }

  private async inspectArtifactPaths(
    connection: RunpodSshConnection,
    manifest: ExperimentRunManifest
  ): Promise<{ foundPaths: string[]; missingPaths: string[] }> {
    if (manifest.expectedArtifacts.length === 0) {
      return { foundPaths: [], missingPaths: [] };
    }

    const quotedChecks = manifest.expectedArtifacts
      .map(
        (artifactPath) =>
          `if [ -e ${shellQuote(path.posix.join(manifest.sync.remoteWorkingDir, artifactPath))} ]; then printf 'FOUND\\t%s\\n' ${shellQuote(
            artifactPath
          )}; else printf 'MISSING\\t%s\\n' ${shellQuote(artifactPath)}; fi`
      )
      .join("\n");
    const result = await this.runRemoteScript(connection, quotedChecks);
    const foundPaths: string[] = [];
    const missingPaths: string[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const [kind, artifactPath] = line.split("\t");
      if (!artifactPath) {
        continue;
      }
      if (kind === "FOUND") {
        foundPaths.push(artifactPath);
      }
      if (kind === "MISSING") {
        missingPaths.push(artifactPath);
      }
    }
    return { foundPaths, missingPaths };
  }

  private async downloadArtifactBundle(
    project: ProjectState,
    manifest: ExperimentRunManifest,
    connection: RunpodSshConnection,
    artifactPaths: string[]
  ): Promise<void> {
    const archivePath = path.join(os.tmpdir(), `${manifest.runId}-artifacts.tar.gz`);
    const artifactsDir = buildExperimentArtifactsDir(this.config.rootDir, project, manifest.runId);
    ensureDir(artifactsDir);
    try {
      const remoteCommand = [
        "set -euo pipefail",
        `cd ${shellQuote(manifest.sync.remoteWorkingDir)}`,
        `tar -czf - -- ${artifactPaths.map((artifactPath) => shellQuote(artifactPath)).join(" ")}`
      ].join("\n");
      await this.streamRemoteScriptToFile(connection, remoteCommand, archivePath);
      await this.runLocalCommand("tar", ["-xzf", archivePath, "-C", artifactsDir]);
    } finally {
      if (fs.existsSync(archivePath)) {
        fs.rmSync(archivePath, { force: true });
      }
    }
  }

  private resolveRemoteRunDir(manifest: ExperimentRunManifest): string {
    const workspaceRoot = manifest.targetSnapshot.workspaceRoot || "/workspace";
    const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
    const runRoot =
      normalizedRoot === "/workspace" ? DEFAULT_REMOTE_RUN_ROOT : `${normalizedRoot}/.opencolab/runs`;
    return path.posix.join(runRoot, manifest.runId);
  }

  private buildSyncPlan(
    project: ProjectState,
    target: ExecutionTargetConfig,
    includePaths: string[] | undefined,
    excludePaths: string[] | undefined
  ): ExperimentRunManifest["sync"] {
    const normalizedIncludes =
      includePaths && includePaths.length > 0
        ? includePaths.map((value) => normalizeRelativePath(value))
        : [normalizeRelativePath(project.path)];
    const normalizedExcludes = [
      ...DEFAULT_EXCLUDE_PATHS,
      ...(excludePaths ?? []).map((value) => normalizeRelativePath(value))
    ];
    const files = this.collectSyncFiles(normalizedIncludes, normalizedExcludes);
    const totalBytes = files.reduce((sum, relativePath) => {
      const stats = fs.statSync(path.join(this.config.rootDir, relativePath));
      return sum + stats.size;
    }, 0);
    return {
      workingRoot: ".",
      includePaths: normalizedIncludes,
      excludePaths: normalizedExcludes,
      remoteWorkspaceRoot: target.workspaceRoot,
      remoteWorkingDir: path.posix.join(target.workspaceRoot, normalizePosixPath(project.path)),
      fileCount: files.length,
      totalBytes
    };
  }

  private collectSyncFiles(includePaths: string[], excludePaths: string[]): string[] {
    const excludedMatchers = excludePaths.map((pattern) => compileExcludePattern(pattern));
    const files = new Set<string>();
    for (const includePath of includePaths) {
      const absolutePath = path.resolve(this.config.rootDir, includePath);
      if (!absolutePath.startsWith(this.config.rootDir)) {
        throw new Error(`Sync include path escapes the workspace: ${includePath}`);
      }
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Sync include path does not exist: ${includePath}`);
      }
      this.walkSyncPath(absolutePath, files, excludedMatchers);
    }
    return [...files].sort((a, b) => a.localeCompare(b));
  }

  private walkSyncPath(
    absolutePath: string,
    files: Set<string>,
    excludedMatchers: Array<(relativePath: string) => boolean>
  ): void {
    const relativePath = normalizePosixPath(path.relative(this.config.rootDir, absolutePath));
    if (!relativePath || isExcludedPath(relativePath, excludedMatchers)) {
      return;
    }

    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      return;
    }

    if (stats.isFile()) {
      files.add(relativePath);
      return;
    }

    if (!stats.isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(absolutePath)) {
      this.walkSyncPath(path.join(absolutePath, entry), files, excludedMatchers);
    }
  }

  private writeSyncMetadata(project: ProjectState, manifest: ExperimentRunManifest): void {
    const syncDir = buildExperimentSyncDir(this.config.rootDir, project, manifest.runId);
    writeJson(path.join(syncDir, "plan.json"), manifest.sync);
  }

  private validateTargetEnabled(target: ExecutionTargetConfig): void {
    if (!target.enabled) {
      throw new Error(`Execution target '${target.id}' is disabled.`);
    }
    if (target.backend !== "runpod") {
      throw new Error(`Unsupported execution backend: ${target.backend}`);
    }
  }

  private validateCommandInput(command: string): void {
    if (!command.trim()) {
      throw new Error("Remote command is required.");
    }
  }

  private validateLocalDependencies(): void {
    for (const command of ["ssh", "scp", "tar"]) {
      if (!isCommandAvailable(command)) {
        throw new Error(`Missing required local dependency: ${command}`);
      }
    }
  }

  private validateEnvVars(envVarNames: string[]): void {
    for (const envVarName of envVarNames) {
      if (!resolveEnvVar(envVarName)) {
        throw new Error(`Missing required env var '${envVarName}' for remote run.`);
      }
    }
  }

  private validateSyncPlan(syncPlan: ExperimentRunManifest["sync"]): void {
    if (syncPlan.fileCount <= 0) {
      throw new Error("Sync plan is empty. Choose at least one file or directory to upload.");
    }
  }

  private normalizeEnvVarNames(envVarNames: string[] | undefined): string[] {
    if (!envVarNames) {
      return [];
    }
    const values = new Set<string>();
    for (const envVarName of envVarNames) {
      const normalized = envVarName.trim();
      if (!normalized) {
        continue;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
        throw new Error(`Invalid env var name for remote forwarding: ${envVarName}`);
      }
      values.add(normalized);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }

  private normalizeArtifactPaths(artifactPaths: string[] | undefined): string[] {
    if (!artifactPaths) {
      return [];
    }
    return [...new Set(artifactPaths.map((value) => normalizeRelativePath(value)))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  private resolveMaxRuntimeMinutes(target: ExecutionTargetConfig, requestedMinutes?: number): number {
    if (!requestedMinutes || requestedMinutes <= 0) {
      return target.maxRuntimeMinutes;
    }
    if (requestedMinutes > target.maxRuntimeMinutes) {
      throw new Error(
        `Requested runtime (${requestedMinutes}m) exceeds target max (${target.maxRuntimeMinutes}m).`
      );
    }
    return requestedMinutes;
  }

  private updateStatusFromPod(
    project: ProjectState,
    status: ExperimentRunStatus,
    pod: RunpodPod
  ): ExperimentRunStatus {
    return this.persistStatus(project, {
      ...status,
      pod: {
        ...status.pod,
        id: pod.id,
        name: pod.name,
        desiredStatus: pod.desiredStatus,
        publicIp: pod.publicIp,
        sshPort: pod.portMappings["22"] ?? status.pod.sshPort,
        volumeId: pod.networkVolume?.id ?? status.pod.volumeId,
        lastObservedAt: nowIso()
      }
    });
  }

  private persistStatus(project: ProjectState, status: ExperimentRunStatus): ExperimentRunStatus {
    writeExperimentRunStatus(this.config.rootDir, project, status);
    return status;
  }

  private requireRunpodApiKey(): string {
    const apiKey = resolveRunpodApiKey();
    if (!apiKey) {
      throw new Error(`Missing required Runpod API key (${RUNPOD_API_KEY_ENV_VAR}).`);
    }
    return apiKey;
  }

  private requireManifest(project: ProjectState, runId: string): ExperimentRunManifest {
    const manifest = readExperimentRunManifest(this.config.rootDir, project, runId);
    if (!manifest) {
      throw new Error(`Unknown GPU run: ${runId}`);
    }
    return manifest;
  }

  private requireStatus(project: ProjectState, runId: string): ExperimentRunStatus {
    const status = readExperimentRunStatus(this.config.rootDir, project, runId);
    if (!status) {
      throw new Error(`Missing run status for GPU run: ${runId}`);
    }
    return status;
  }

  private appendPollerLog(project: ProjectState, runId: string, line: string): void {
    appendExperimentLog(this.config.rootDir, project, runId, "poller", `[${nowIso()}] ${line}\n`);
  }

  private async listNetworkVolumes(): Promise<RunpodNetworkVolume[]> {
    const response = await this.requestJson<unknown[]>("GET", "/networkvolumes");
    return Array.isArray(response) ? response.map((value) => normalizeNetworkVolume(value)) : [];
  }

  private async createNetworkVolume(target: ExecutionTargetConfig): Promise<RunpodNetworkVolume> {
    const response = await this.requestJson<unknown>("POST", "/networkvolumes", {
      dataCenterId: target.datacenterId,
      name: target.volume.name,
      size: target.volume.sizeGb
    });
    return normalizeNetworkVolume(response);
  }

  private async listPods(): Promise<RunpodPod[]> {
    const response = await this.requestJson<unknown[]>("GET", "/pods");
    return Array.isArray(response) ? response.map((value) => normalizePod(value)) : [];
  }

  private async getPod(podId: string): Promise<RunpodPod | null> {
    const response = await this.requestJson<unknown | null>("GET", `/pods/${podId}`);
    return response ? normalizePod(response) : null;
  }

  private async getPodOrNull(podId: string): Promise<RunpodPod | null> {
    try {
      return await this.getPod(podId);
    } catch {
      return null;
    }
  }

  private async createPod(
    project: ProjectState,
    target: ExecutionTargetConfig,
    volume: RunpodNetworkVolume
  ): Promise<RunpodPod> {
    const body: Record<string, unknown> = {
      cloudType: "SECURE",
      computeType: "GPU",
      dataCenterIds: [target.datacenterId],
      dataCenterPriority: "custom",
      gpuTypeIds: [target.gpuType],
      gpuTypePriority: "custom",
      gpuCount: target.gpuCount,
      name: buildPodName(project, target),
      networkVolumeId: volume.id,
      volumeMountPath: target.workspaceRoot,
      containerDiskInGb: 50,
      interruptible: false,
      ports: ["22/tcp"],
      supportPublicIp: true
    };
    if (target.templateId) {
      body.templateId = target.templateId;
    }
    if (target.imageName) {
      body.imageName = target.imageName;
    }
    const response = await this.requestJson<unknown>("POST", "/pods", body);
    return normalizePod(response);
  }

  private async startPod(podId: string): Promise<void> {
    await this.requestJson("POST", `/pods/${podId}/start`);
  }

  private async stopPod(podId: string): Promise<void> {
    await this.requestJson("POST", `/pods/${podId}/stop`);
  }

  private async stopPodIfPresent(status: ExperimentRunStatus): Promise<void> {
    if (status.pod.id) {
      await this.stopPod(status.pod.id);
    }
  }

  private async requestJson<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const apiKey = this.requireRunpodApiKey();
    const response = await fetch(`${RUNPOD_API_BASE_URL}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Runpod API ${method} ${pathname} failed (${response.status}): ${responseText || response.statusText}`
      );
    }

    const responseText = await response.text();
    if (!responseText) {
      return undefined as T;
    }
    return JSON.parse(responseText) as T;
  }

  private async ensureRemoteDir(connection: RunpodSshConnection, remoteDir: string): Promise<void> {
    await this.runRemoteScript(connection, `mkdir -p ${shellQuote(remoteDir)}`);
  }

  private async copyFileToRemote(
    connection: RunpodSshConnection,
    localPath: string,
    remotePath: string
  ): Promise<void> {
    const remoteSpec = `${connection.user}@${connection.host}:${remotePath}`;
    await this.runLocalCommand("scp", [...buildScpBaseArgs(connection), localPath, remoteSpec]);
  }

  private async copyFileFromRemote(
    connection: RunpodSshConnection,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    ensureDir(path.dirname(localPath));
    const remoteSpec = `${connection.user}@${connection.host}:${remotePath}`;
    await this.runLocalCommand("scp", [...buildScpBaseArgs(connection), remoteSpec, localPath]);
  }

  private async runRemoteScript(connection: RunpodSshConnection, script: string): Promise<CommandResult> {
    return this.runLocalCommand(
      "ssh",
      [...buildSshBaseArgs(connection), `${connection.user}@${connection.host}`, `bash -lc ${shellQuote(script)}`]
    );
  }

  private async streamRemoteScriptToFile(
    connection: RunpodSshConnection,
    script: string,
    outputPath: string
  ): Promise<void> {
    ensureDir(path.dirname(outputPath));
    await runStreamingCommand(
      "ssh",
      [...buildSshBaseArgs(connection), `${connection.user}@${connection.host}`, `bash -lc ${shellQuote(script)}`],
      outputPath
    );
  }

  private async runLocalCommand(
    command: string,
    args: string[],
    extraEnv?: NodeJS.ProcessEnv
  ): Promise<CommandResult> {
    return runBufferedCommand(command, args, extraEnv);
  }
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (!result.error) {
    return true;
  }
  const error = result.error as NodeJS.ErrnoException;
  return error.code !== "ENOENT";
}

function buildPodName(project: ProjectState, target: ExecutionTargetConfig): string {
  return `opencolab-${project.id}-${target.id}`;
}

function normalizeNetworkVolume(raw: unknown): RunpodNetworkVolume {
  const source = asRecord(raw);
  return {
    id: asString(source?.id, ""),
    name: asString(source?.name, ""),
    size: Number(source?.size ?? 0),
    dataCenterId: asString(source?.dataCenterId, "")
  };
}

function normalizePod(raw: unknown): RunpodPod {
  const source = asRecord(raw);
  const networkVolume = asRecord(source?.networkVolume);
  const machine = asRecord(source?.machine);
  const machineGpuType = asRecord(machine?.gpuType);
  const portMappings: Record<string, number> = {};
  const rawPortMappings = asRecord(source?.portMappings);
  if (rawPortMappings) {
    for (const [port, value] of Object.entries(rawPortMappings)) {
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric > 0) {
        portMappings[port] = numeric;
      }
    }
  }

  return {
    id: asString(source?.id, ""),
    name: asNullableString(source?.name),
    desiredStatus: asNullableString(source?.desiredStatus),
    image: asNullableString(source?.image),
    publicIp: asNullableString(source?.publicIp),
    portMappings,
    volumeMountPath: asNullableString(source?.volumeMountPath),
    networkVolume: networkVolume
      ? {
          id: asString(networkVolume.id, ""),
          name: asString(networkVolume.name, ""),
          size: Number(networkVolume.size ?? 0),
          dataCenterId: asString(networkVolume.dataCenterId, "")
        }
      : null,
    machine: {
      dataCenterId: asNullableString(machine?.dataCenterId),
      secureCloud:
        typeof machine?.secureCloud === "boolean" ? machine.secureCloud : machine?.secureCloud === "true",
      gpuTypeDisplayName: asNullableString(machineGpuType?.displayName)
    },
    gpuCount: Number(asRecord(source?.gpu)?.count ?? 0) || null,
    costPerHr: asNullableString(source?.costPerHr)
  };
}

function buildSshBaseArgs(connection: RunpodSshConnection): string[] {
  const args = [
    "-p",
    String(connection.port),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes"
  ];
  if (connection.privateKeyPath) {
    args.push("-i", connection.privateKeyPath);
  }
  return args;
}

function buildScpBaseArgs(connection: RunpodSshConnection): string[] {
  const args = [
    "-P",
    String(connection.port),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes"
  ];
  if (connection.privateKeyPath) {
    args.push("-i", connection.privateKeyPath);
  }
  return args;
}

async function runBufferedCommand(
  command: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (exitCode) => {
      const code = exitCode ?? 1;
      if (code !== 0) {
        reject(new Error(`${command} failed (${String(code)}): ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

async function runStreamingCommand(command: string, args: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output = fs.createWriteStream(outputPath);
    let stderr = "";

    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      output.destroy();
      reject(error);
    });
    child.on("close", (exitCode) => {
      output.end();
      const code = exitCode ?? 1;
      if (code !== 0) {
        reject(new Error(`${command} failed (${String(code)}): ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}

function buildBootstrapScript(
  profile: ExecutionTargetConfig["bootstrapProfile"],
  remoteWorkingDir: string,
  remoteBootstrapLogPath: string
): string {
  const commonHeader = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `mkdir -p ${shellQuote(path.posix.dirname(remoteBootstrapLogPath))}`,
    `exec > >(tee -a ${shellQuote(remoteBootstrapLogPath)}) 2>&1`,
    `cd ${shellQuote(remoteWorkingDir)}`,
    "echo \"[bootstrap] $(date -u +%FT%TZ) profile start\"",
    "command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi || true",
    "python3 --version"
  ];

  if (profile === "minimal-shell") {
    return [...commonHeader, "echo '[bootstrap] minimal-shell complete'"].join("\n") + "\n";
  }

  const pythonSetup = [
    "if [ ! -d .venv ]; then python3 -m venv .venv; fi",
    ". .venv/bin/activate",
    "python -m pip install --upgrade pip setuptools wheel",
    "if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi"
  ];

  if (profile === "pytorch-cu12") {
    return [
      ...commonHeader,
      ...pythonSetup,
      "if ! python - <<'PY'\nimport importlib.util\nraise SystemExit(0 if importlib.util.find_spec('torch') else 1)\nPY",
      "then",
      "  python -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124",
      "fi",
      "echo '[bootstrap] pytorch-cu12 complete'"
    ].join("\n") + "\n";
  }

  return [...commonHeader, ...pythonSetup, "echo '[bootstrap] python-ml complete'"].join("\n") + "\n";
}

function buildLaunchScript(input: {
  command: string;
  envVarNames: string[];
  remoteWorkingDir: string;
  stdoutPath: string;
  stderrPath: string;
  exitCodePath: string;
  bootstrapProfile: ExecutionTargetConfig["bootstrapProfile"];
}): string {
  const exports = input.envVarNames.map((envVarName) => {
    const value = resolveEnvVar(envVarName) ?? "";
    return `export ${envVarName}=${shellQuote(value)}`;
  });

  const activateVenv =
    input.bootstrapProfile === "python-ml" || input.bootstrapProfile === "pytorch-cu12"
      ? "if [ -f .venv/bin/activate ]; then . .venv/bin/activate; fi"
      : "true";

  return [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    `cd ${shellQuote(input.remoteWorkingDir)}`,
    ...exports,
    activateVenv,
    `USER_COMMAND=${shellQuote(input.command)}`,
    `bash -lc "$USER_COMMAND" >${shellQuote(input.stdoutPath)} 2>${shellQuote(input.stderrPath)}`,
    "status=$?",
    `printf '%s\\n' "$status" > ${shellQuote(input.exitCodePath)}`,
    "exit \"$status\""
  ].join("\n") + "\n";
}

function resolveGitRevision(rootDir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function normalizeRelativePath(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Path value is required.");
  }
  const normalized = normalizePosixPath(trimmed);
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error(`Path must stay inside the workspace root: ${value}`);
  }
  return normalized;
}

function normalizePosixPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function compileExcludePattern(pattern: string): (relativePath: string) => boolean {
  const normalized = normalizePosixPath(pattern).replace(/\./g, "\\.").replace(/\*/g, "[^/]+");
  const regex = new RegExp(`^${normalized}(?:$|/)`);
  return (relativePath: string) => regex.test(relativePath);
}

function isExcludedPath(relativePath: string, matchers: Array<(relativePath: string) => boolean>): boolean {
  return matchers.some((matcher) => matcher(relativePath));
}

function hasRunTimedOut(manifest: ExperimentRunManifest, status: ExperimentRunStatus): boolean {
  const startedAt = status.startedAt ?? manifest.createdAt;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  return elapsedMs > manifest.maxRuntimeMinutes * 60 * 1000;
}

function isTerminalRunState(state: ExperimentRunStatus["state"]): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out" ||
    state === "cleanup_failed"
  );
}

function addUniqueValue(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
