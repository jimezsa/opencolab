import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createInitialRunStatus, writeExperimentRunManifest, writeExperimentRunStatus } from "../src/experiments.js";
import { createDefaultExecutionTargetConfig, createDefaultProjectState } from "../src/project-config.js";
import { RunpodExecutionServiceImpl } from "../src/gpu-providers/runpod/index.js";
import type { ExperimentRunManifest, ExperimentRunStatus } from "../src/types.js";

function createRunManifest(target = createDefaultExecutionTargetConfig("runpod-flex")): ExperimentRunManifest {
  return {
    runId: "run-1234",
    projectId: "default",
    agentId: "professor",
    targetId: target.id,
    backend: target.backend,
    requestedBy: "cli",
    createdAt: "2026-03-30T00:00:00.000Z",
    command: "python train.py",
    envVarNames: [],
    expectedArtifacts: [],
    strictArtifacts: false,
    maxRuntimeMinutes: 60,
    sourceRevision: null,
    sync: {
      workingRoot: ".",
      includePaths: ["projects/default"],
      excludePaths: [],
      remoteWorkspaceRoot: "/workspace",
      remoteWorkingDir: "/workspace/projects/default",
      fileCount: 1,
      totalBytes: 10
    },
    targetSnapshot: target
  };
}

function createRunningStatus(manifest: ExperimentRunManifest): ExperimentRunStatus {
  const status = createInitialRunStatus(manifest);
  return {
    ...status,
    state: "running",
    stage: "running",
    message: "Remote process is still running.",
    startedAt: manifest.createdAt,
    pod: {
      ...status.pod,
      id: "pod_123",
      name: "opencolab-default-runpod-flex",
      desiredStatus: "RUNNING",
      datacenterId: "US-KS-2",
      gpuType: "NVIDIA A100 80GB PCIe",
      publicIp: "1.2.3.4",
      sshPort: 2200,
      volumeId: "vol_123",
      lastObservedAt: manifest.createdAt
    },
    remote: {
      ...status.remote,
      remoteRunDir: "/workspace/.opencolab/runs/run-1234",
      launchScriptPath: "/workspace/.opencolab/runs/run-1234/launch.sh",
      stdoutPath: "/workspace/.opencolab/runs/run-1234/stdout.log",
      stderrPath: "/workspace/.opencolab/runs/run-1234/stderr.log",
      pidFilePath: "/workspace/.opencolab/runs/run-1234/wrapper.pid",
      exitCodeFilePath: "/workspace/.opencolab/runs/run-1234/exit-code.txt",
      launchPid: 12345
    }
  };
}

test("Runpod execution falls back to the next preferred datacenter when capacity is unavailable", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-fallback-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    target.preferredDatacenterIds = ["US-KS-2", "CA-MTL-1"];
    target.preferredGpuTypes = ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"];
    target.datacenterId = target.preferredDatacenterIds[0];
    target.gpuType = target.preferredGpuTypes[0];

    const createPodAttempts: string[] = [];

    service.listNetworkVolumes = async () => [];
    service.listPods = async () => [];
    service.createNetworkVolume = async (_target: unknown, datacenterId: string) => ({
      id: `vol-${datacenterId}`,
      name: `runpod-flex-${datacenterId}`,
      size: 200,
      dataCenterId: datacenterId
    });
    service.createPod = async (
      _project: unknown,
      _target: unknown,
      volume: { id: string; dataCenterId: string }
    ) => {
      createPodAttempts.push(volume.dataCenterId);
      if (volume.dataCenterId === "US-KS-2") {
        throw new Error("capacity unavailable");
      }
      return {
        id: "pod_123",
        name: "opencolab-default-runpod-flex",
        desiredStatus: "RUNNING",
        image: "runpod/pytorch:latest",
        publicIp: "1.2.3.4",
        portMappings: { "22": 2200 },
        volumeMountPath: "/workspace",
        networkVolume: {
          id: volume.id,
          name: "runpod-flex-ca-mtl-1",
          size: 200,
          dataCenterId: volume.dataCenterId
        },
        machine: {
          dataCenterId: volume.dataCenterId,
          secureCloud: true,
          gpuTypeDisplayName: "NVIDIA RTX 4090"
        },
        gpuCount: 1,
        costPerHr: "1.23"
      };
    };

    const allocation = await service.ensureCompatiblePod(project, target, () => {});

    assert.deepEqual(createPodAttempts, ["US-KS-2", "CA-MTL-1"]);
    assert.equal(allocation.volume.dataCenterId, "CA-MTL-1");
    assert.equal(allocation.pod.machine.dataCenterId, "CA-MTL-1");
    assert.equal(allocation.pod.machine.gpuTypeDisplayName, "NVIDIA RTX 4090");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod execution falls back when network volume creation fails in a preferred datacenter", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-volume-fallback-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    target.preferredDatacenterIds = ["CA-MTL-1", "US-KS-2"];
    target.preferredGpuTypes = ["NVIDIA A100 80GB PCIe"];
    target.datacenterId = target.preferredDatacenterIds[0];
    target.gpuType = target.preferredGpuTypes[0];

    const volumeAttempts: string[] = [];

    service.listNetworkVolumes = async () => [];
    service.listPods = async () => [];
    service.createNetworkVolume = async (_target: unknown, datacenterId: string) => {
      volumeAttempts.push(datacenterId);
      if (datacenterId === "CA-MTL-1") {
        throw new Error("volume create failed");
      }
      return {
        id: `vol-${datacenterId}`,
        name: `runpod-flex-${datacenterId}`,
        size: 200,
        dataCenterId: datacenterId
      };
    };
    service.createPod = async (
      _project: unknown,
      _target: unknown,
      volume: { id: string; dataCenterId: string }
    ) => ({
      id: "pod_456",
      name: "opencolab-default-runpod-flex",
      desiredStatus: "RUNNING",
      image: "runpod/pytorch:latest",
      publicIp: "1.2.3.4",
      portMappings: { "22": 2200 },
      volumeMountPath: "/workspace",
      networkVolume: {
        id: volume.id,
        name: `runpod-flex-${volume.dataCenterId}`,
        size: 200,
        dataCenterId: volume.dataCenterId
      },
      machine: {
        dataCenterId: volume.dataCenterId,
        secureCloud: true,
        gpuTypeDisplayName: "NVIDIA A100 80GB PCIe"
      },
      gpuCount: 1,
      costPerHr: "1.23"
    });

    const allocation = await service.ensureCompatiblePod(project, target, () => {});

    assert.deepEqual(volumeAttempts, ["CA-MTL-1", "US-KS-2"]);
    assert.equal(allocation.volume.dataCenterId, "US-KS-2");
    assert.equal(allocation.pod.machine.dataCenterId, "US-KS-2");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod availability reports the best matching datacenter and GPU snapshot", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-availability-"));
  const previousRunpodKey = process.env.RUNPOD_API_KEY;

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    target.preferredDatacenterIds = ["US-KS-2", "CA-MTL-1"];
    target.preferredGpuTypes = ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"];
    target.datacenterId = target.preferredDatacenterIds[0];
    target.gpuType = target.preferredGpuTypes[0];

    process.env.RUNPOD_API_KEY = "runpod_test_key";
    service.listDataCenters = async () => [
      {
        id: "US-KS-2",
        name: "Kansas City",
        location: "Kansas City, USA",
        gpuAvailability: [
          {
            gpuTypeId: "NVIDIA RTX 4090",
            displayName: "NVIDIA RTX 4090",
            stockStatus: "Low"
          }
        ]
      },
      {
        id: "CA-MTL-1",
        name: "Montreal",
        location: "Montreal, Canada",
        gpuAvailability: [
          {
            gpuTypeId: "NVIDIA A100 80GB PCIe",
            displayName: "NVIDIA A100 80GB PCIe",
            stockStatus: "Medium"
          }
        ]
      }
    ];
    service.readPodApiConstraints = async () => ({
      compatibleDataCenterIds: ["US-KS-2", "CA-MTL-1"],
      compatibleGpuTypeIds: ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"]
    });
    service.readStorageCompatibilityCache = () => ({
      datacenters: {
        "US-KS-2": {
          datacenterId: "US-KS-2",
          status: "supported",
          message: null,
          observedAt: "2026-03-30T00:00:00.000Z"
        },
        "CA-MTL-1": {
          datacenterId: "CA-MTL-1",
          status: "failed",
          message: "storage cluster unavailable",
          observedAt: "2026-03-30T00:00:00.000Z"
        }
      }
    });

    const result = await service.checkTargetAvailability(project, target);

    assert.equal(result.ok, true);
    assert.equal(result.bestCandidate?.datacenterId, "US-KS-2");
    assert.equal(result.bestCandidate?.gpuType, "NVIDIA RTX 4090");
    assert.equal(result.bestCandidate?.stockStatus, "Low");
    assert.equal(result.bestCandidate?.podApiCompatible, true);
    assert.equal(result.bestCandidate?.storageSupport, "supported");
    assert.equal(result.candidates.length, 4);
    assert.equal(
      result.candidates.some(
        (candidate: {
          datacenterId: string;
          gpuType: string;
          available: boolean;
          storageSupport: string;
        }) =>
          candidate.datacenterId === "US-KS-2" &&
          candidate.gpuType === "NVIDIA A100 80GB PCIe" &&
          candidate.available === false
      ),
      true
    );
    assert.equal(
      result.candidates.some(
        (candidate: {
          datacenterId: string;
          gpuType: string;
          storageSupport: string;
          storageWarning: string | null;
        }) =>
          candidate.datacenterId === "CA-MTL-1" &&
          candidate.gpuType === "NVIDIA A100 80GB PCIe" &&
          candidate.storageSupport === "failed" &&
          candidate.storageWarning === "storage cluster unavailable"
      ),
      true
    );
    assert.equal(
      result.warnings.includes("Availability is a live snapshot and may change before launch."),
      true
    );
    assert.equal(
      result.warnings.includes(
        "Datacenter 'CA-MTL-1' previously failed network volume provisioning: storage cluster unavailable"
      ),
      true
    );
  } finally {
    if (previousRunpodKey === undefined) {
      delete process.env.RUNPOD_API_KEY;
    } else {
      process.env.RUNPOD_API_KEY = previousRunpodKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod availability warns when a datacenter is not Pod-API-compatible", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-availability-podapi-"));
  const previousRunpodKey = process.env.RUNPOD_API_KEY;

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    target.preferredDatacenterIds = ["US-MO-2"];
    target.preferredGpuTypes = ["NVIDIA L4"];
    target.datacenterId = target.preferredDatacenterIds[0];
    target.gpuType = target.preferredGpuTypes[0];

    process.env.RUNPOD_API_KEY = "runpod_test_key";
    service.listDataCenters = async () => [
      {
        id: "US-MO-2",
        name: "Missouri",
        location: "United States",
        gpuAvailability: [
          {
            gpuTypeId: "NVIDIA L4",
            displayName: "L4",
            stockStatus: "Medium"
          }
        ]
      }
    ];
    service.readPodApiConstraints = async () => ({
      compatibleDataCenterIds: ["US-KS-2"],
      compatibleGpuTypeIds: ["NVIDIA L4"]
    });
    service.readStorageCompatibilityCache = () => ({ datacenters: {} });

    const result = await service.checkTargetAvailability(project, target);

    assert.equal(result.candidates[0]?.podApiCompatible, false);
    assert.equal(
      result.warnings.includes(
        "Datacenter 'US-MO-2' appears in Runpod's live availability feed but is not currently accepted by the Pod create API schema."
      ),
      true
    );
  } finally {
    if (previousRunpodKey === undefined) {
      delete process.env.RUNPOD_API_KEY;
    } else {
      process.env.RUNPOD_API_KEY = previousRunpodKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod createPod normalizes shorthand GPU names to canonical Runpod GPU ids", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-gpu-normalize-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-4090");
    target.preferredGpuTypes = ["NVIDIA RTX 4090"];
    target.gpuType = target.preferredGpuTypes[0];

    let capturedBody: Record<string, unknown> | null = null;

    service.listGpuTypes = async () => [
      {
        id: "NVIDIA GeForce RTX 4090",
        displayName: "RTX 4090"
      }
    ];
    service.requestJson = async (_method: string, pathname: string, body?: Record<string, unknown>) => {
      if (pathname === "/pods") {
        capturedBody = body ?? null;
        return {
          id: "pod_789",
          name: "opencolab-default-runpod-4090",
          desiredStatus: "RUNNING",
          image: "runpod/pytorch:latest",
          publicIp: "1.2.3.4",
          portMappings: { "22": 2200 },
          volumeMountPath: "/workspace",
          networkVolume: {
            id: "vol_789",
            name: "runpod-4090-us-nc-1",
            size: 50,
            dataCenterId: "US-NC-1"
          },
          machine: {
            dataCenterId: "US-NC-1",
            secureCloud: true,
            gpuType: {
              displayName: "RTX 4090"
            }
          },
          gpu: {
            count: 1
          },
          costPerHr: "1.23"
        };
      }
      throw new Error(`Unexpected request path: ${pathname}`);
    };

    await service.createPod(
      project,
      target,
      {
        id: "vol_789",
        name: "runpod-4090-us-nc-1",
        size: 50,
        dataCenterId: "US-NC-1"
      },
      "US-NC-1"
    );

    assert.deepEqual((capturedBody as { gpuTypeIds?: string[] } | null)?.gpuTypeIds, [
      "NVIDIA GeForce RTX 4090"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod execRunCommand returns stdout stderr and exit code from the launched Pod", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-exec-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    const manifest = createRunManifest(target);
    const status = createRunningStatus(manifest);

    writeExperimentRunManifest(tempDir, project, manifest);
    writeExperimentRunStatus(tempDir, project, status);

    const livePod = {
      id: "pod_123",
      name: "opencolab-default-runpod-flex",
      desiredStatus: "RUNNING",
      image: "runpod/pytorch:latest",
      publicIp: "1.2.3.4",
      portMappings: { "22": 2200 },
      volumeMountPath: "/workspace",
      networkVolume: {
        id: "vol_123",
        name: "runpod-flex-us-ks-2",
        size: 50,
        dataCenterId: "US-KS-2"
      },
      machine: {
        dataCenterId: "US-KS-2",
        secureCloud: true,
        gpuTypeDisplayName: "NVIDIA A100 80GB PCIe"
      },
      gpuCount: 1,
      costPerHr: "1.23"
    };

    let executedCommand = "";
    service.validateSshDependency = () => {};
    service.reconcileRun = async () => status;
    service.getPodOrNull = async () => livePod;
    service.tryOpenSshConnection = async () => ({
      host: "1.2.3.4",
      port: 2200,
      user: "root",
      privateKeyPath: null,
      pod: livePod
    });
    service.runRemoteScriptAllowExitCode = async (_connection: unknown, script: string) => {
      executedCommand = script;
      return {
        exitCode: 7,
        stdout: "gpu output\n",
        stderr: "remote warning\n"
      };
    };

    const result = await service.execRunCommand(project, manifest.runId, "nvidia-smi");

    assert.equal(executedCommand, "nvidia-smi");
    assert.equal(result.runId, manifest.runId);
    assert.equal(result.targetId, target.id);
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "gpu output\n");
    assert.equal(result.stderr, "remote warning\n");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod execRunCommand rejects runs whose Pod is live but SSH is unreachable", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-exec-unreachable-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    const manifest = createRunManifest(target);
    const status = createRunningStatus(manifest);

    writeExperimentRunManifest(tempDir, project, manifest);
    writeExperimentRunStatus(tempDir, project, status);

    service.validateSshDependency = () => {};
    service.reconcileRun = async () => ({
      ...status,
      state: "running_unreachable",
      message: "Pod is still alive but SSH is temporarily unavailable."
    });

    await assert.rejects(
      service.execRunCommand(project, manifest.runId, "nvidia-smi"),
      /still live but SSH is temporarily unavailable/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Runpod execRunCommand rejects terminal runs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-runpod-exec-terminal-"));

  try {
    const config = loadConfig(tempDir);
    const service = new RunpodExecutionServiceImpl(config) as any;
    const project = createDefaultProjectState("default");
    const target = createDefaultExecutionTargetConfig("runpod-flex");
    const manifest = createRunManifest(target);
    const status = {
      ...createRunningStatus(manifest),
      state: "completed" as const,
      stage: "completed",
      message: "Remote run completed.",
      finishedAt: "2026-03-30T00:10:00.000Z"
    };

    writeExperimentRunManifest(tempDir, project, manifest);
    writeExperimentRunStatus(tempDir, project, status);

    service.validateSshDependency = () => {};

    await assert.rejects(
      service.execRunCommand(project, manifest.runId, "nvidia-smi"),
      /terminal state 'completed'/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
