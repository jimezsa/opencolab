import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createDefaultExecutionTargetConfig, createDefaultProjectState } from "../src/project-config.js";
import { RunpodExecutionServiceImpl } from "../src/gpu-providers/runpod/index.js";

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
