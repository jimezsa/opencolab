import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunpodExecutionService } from "../src/gpu-providers/runpod/index.js";
import { createRuntime } from "../src/runtime.js";
import type {
  ExecutionTargetAvailabilityResult,
  ExecutionTargetTestResult,
  ExperimentRunExecResult,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary
} from "../src/types.js";

function buildAgentDir(rootDir: string, projectId: string, agentId = "professor"): string {
  return path.join(rootDir, "projects", projectId, "AGENTS", agentId);
}

function buildProjectDir(rootDir: string, projectId: string): string {
  return path.join(rootDir, "projects", projectId);
}

function createSampleRunStatus(runId = "run-1"): ExperimentRunStatus {
  return {
    runId,
    projectId: "default",
    agentId: "professor",
    targetId: "runpod-a100",
    backend: "runpod",
    state: "running",
    stage: "running",
    message: "Remote process is still running.",
    createdAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
    startedAt: "2026-03-23T00:00:00.000Z",
    finishedAt: null,
    warnings: [],
    error: null,
    pod: {
      id: "pod_123",
      name: "opencolab-default-runpod-a100",
      desiredStatus: "RUNNING",
      datacenterId: "US-KS-2",
      gpuType: "NVIDIA A100 80GB PCIe",
      publicIp: "1.2.3.4",
      sshPort: 2200,
      volumeId: "vol_123",
      lastObservedAt: "2026-03-23T00:00:00.000Z"
    },
    remote: {
      remoteWorkingDir: "/workspace/projects/default",
      remoteRunDir: "/workspace/.opencolab/runs/run-1",
      launchScriptPath: "/workspace/.opencolab/runs/run-1/launch.sh",
      bootstrapScriptPath: "/workspace/.opencolab/runs/run-1/bootstrap.sh",
      stdoutPath: "/workspace/.opencolab/runs/run-1/stdout.log",
      stderrPath: "/workspace/.opencolab/runs/run-1/stderr.log",
      bootstrapLogPath: "/workspace/.opencolab/runs/run-1/bootstrap.log",
      pidFilePath: "/workspace/.opencolab/runs/run-1/wrapper.pid",
      exitCodeFilePath: "/workspace/.opencolab/runs/run-1/exit-code.txt",
      launchPid: 12345,
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

test("init creates required agent context files for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-files-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    const agentDir = path.join(tempDir, agent.path);

    assert.equal(project.id, "default");
    assert.equal(agent.id, "professor");
    assert.equal(agent.path, "projects/default/AGENTS/professor");
    assert.equal(
      fs.existsSync(path.join(buildProjectDir(tempDir, "default"), "PROJECT-AND-TEAM.md")),
      true,
      "PROJECT-AND-TEAM.md should exist"
    );

    const required = [
      "AGENTS.md",
      "BOOTSTRAP.md",
      "IDENTITY.md",
      "ALMA.md",
      "TOOLS.md",
      "USER.md",
      "TODO.md",
      "MEMORY.md"
    ];
    for (const file of required) {
      assert.equal(fs.existsSync(path.join(agentDir, file)), true, `${file} should exist`);
    }
    assert.equal(fs.existsSync(path.join(agentDir, "SKILLS")), true, "SKILLS directory should exist");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init does not replicate shared skills into each project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-shared-skills-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    assert.equal(fs.existsSync(path.join(tempDir, "projects", "default", "SKILLS")), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupExecutionTarget persists a project-scoped GPU server and target snapshot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-execution-target-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupExecutionTarget({
      id: "runpod-a100",
      datacenterId: "US-KS-2",
      gpuType: "NVIDIA A100 80GB PCIe",
      gpuCount: 1,
      volumeName: "default-runpod-a100",
      volumeSizeGb: 200,
      workspaceRoot: "/workspace",
      bootstrapProfile: "python-ml",
      autoStopPolicy: "stop_on_completion"
    });

    const target = runtime.getExecutionTarget("runpod-a100");
    assert.equal(target.backend, "runpod");
    assert.equal(target.datacenterId, "US-KS-2");
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2"]);
    assert.equal(target.gpuType, "NVIDIA A100 80GB PCIe");
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe"]);
    assert.equal(target.volume.name, "default-runpod-a100");

    const snapshotPath = path.join(
      tempDir,
      "projects",
      "default",
      "experiments",
      "targets",
      "runpod-a100.json"
    );
    assert.equal(fs.existsSync(snapshotPath), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const reloadedTarget = reloadedRuntime.getExecutionTarget("runpod-a100");
    assert.equal(reloadedTarget.volume.sizeGb, 200);
    assert.equal(reloadedTarget.workspaceRoot, "/workspace");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startGpuJob delegates to the injected runpod execution service", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-gpu-job-runtime-"));
  const captured: {
    projectId?: string;
    agentId?: string;
    targetId?: string;
    command?: string;
    wait?: boolean;
  } = {};
  const status = createSampleRunStatus("run-42");
  const manifest: ExperimentRunManifest = {
    runId: "run-42",
    projectId: "default",
    agentId: "professor",
    targetId: "runpod-a100",
    backend: "runpod",
    requestedBy: "cli",
    createdAt: "2026-03-23T00:00:00.000Z",
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
    targetSnapshot: {
      id: "runpod-a100",
      backend: "runpod",
      enabled: true,
      datacenterId: "US-KS-2",
      preferredDatacenterIds: ["US-KS-2"],
      cloudType: "secure",
      gpuType: "NVIDIA A100 80GB PCIe",
      preferredGpuTypes: ["NVIDIA A100 80GB PCIe"],
      gpuCount: 1,
      templateId: null,
      imageName: "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
      volume: {
        mode: "network_volume",
        id: null,
        name: "default-runpod-a100",
        sizeGb: 200
      },
      ssh: {
        mode: "public_ip",
        user: "root",
        port: null,
        privateKeyPath: null
      },
      workspaceRoot: "/workspace",
      bootstrapProfile: "python-ml",
      maxRuntimeMinutes: 360,
      idleStopMinutes: 15,
      autoStopPolicy: "stop_on_completion",
      maxEstimatedCostUsd: null
    }
  };

  const fakeService: RunpodExecutionService = {
    async testTarget(_project, target): Promise<ExecutionTargetTestResult> {
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        warnings: [],
        details: ["ready"]
      };
    },
    async checkTargetAvailability(_project, target): Promise<ExecutionTargetAvailabilityResult> {
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        checkedAt: "2026-03-23T00:00:00.000Z",
        bestCandidate: {
          datacenterId: "US-KS-2",
          datacenterName: "Kansas City",
          datacenterLocation: "Kansas City, USA",
          gpuType: "NVIDIA A100 80GB PCIe",
          stockStatus: "Low",
          available: true,
          podApiCompatible: true,
          storageSupport: "supported",
          storageWarning: null
        },
        candidates: [
          {
            datacenterId: "US-KS-2",
            datacenterName: "Kansas City",
            datacenterLocation: "Kansas City, USA",
            gpuType: "NVIDIA A100 80GB PCIe",
            stockStatus: "Low",
            available: true,
            podApiCompatible: true,
            storageSupport: "supported",
            storageWarning: null
          }
        ],
        warnings: ["Availability is a live snapshot and may change before launch."]
      };
    },
    async startRun(project, agent, input): Promise<ExperimentRunStatus> {
      captured.projectId = project.id;
      captured.agentId = agent.id;
      captured.targetId = input.target.id;
      captured.command = input.command;
      captured.wait = input.wait;
      return status;
    },
    async execRunCommand(_project, runId, command): Promise<ExperimentRunExecResult> {
      return {
        runId,
        targetId: "runpod-a100",
        exitCode: 0,
        stdout: command,
        stderr: ""
      };
    },
    async reconcileRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    async fetchRunOutputs(): Promise<ExperimentRunStatus> {
      return status;
    },
    async cancelRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    listRuns(): ExperimentRunSummary[] {
      return [
        {
          runId: status.runId,
          targetId: status.targetId,
          state: status.state,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
          command: "python train.py"
        }
      ];
    },
    readLocalStatus(): ExperimentRunStatus | null {
      return status;
    },
    readLocalManifest(): ExperimentRunManifest | null {
      return manifest;
    }
  };

  const runtime = createRuntime(tempDir, {
    runpodExecutionService: fakeService
  });

  try {
    runtime.init();
    runtime.setupExecutionTarget({
      id: "runpod-a100"
    });

    const result = await runtime.startGpuJob({
      targetId: "runpod-a100",
      command: "python train.py",
      wait: false
    });

    assert.equal(result.runId, "run-42");
    assert.equal(captured.projectId, "default");
    assert.equal(captured.agentId, "professor");
    assert.equal(captured.targetId, "runpod-a100");
    assert.equal(captured.command, "python train.py");
    assert.equal(captured.wait, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checkExecutionTargetAvailability delegates to the injected runpod execution service", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-gpu-availability-runtime-"));
  const status = createSampleRunStatus("run-42");
  let requestedTargetId: string | undefined;

  const fakeService: RunpodExecutionService = {
    async testTarget(_project, target): Promise<ExecutionTargetTestResult> {
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        warnings: [],
        details: ["ready"]
      };
    },
    async checkTargetAvailability(_project, target): Promise<ExecutionTargetAvailabilityResult> {
      requestedTargetId = target.id;
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        checkedAt: "2026-03-23T00:00:00.000Z",
        bestCandidate: {
          datacenterId: "US-KS-2",
          datacenterName: "Kansas City",
          datacenterLocation: "Kansas City, USA",
          gpuType: "NVIDIA A100 80GB PCIe",
          stockStatus: "Medium",
          available: true,
          podApiCompatible: true,
          storageSupport: "supported",
          storageWarning: null
        },
        candidates: [
          {
            datacenterId: "US-KS-2",
            datacenterName: "Kansas City",
            datacenterLocation: "Kansas City, USA",
            gpuType: "NVIDIA A100 80GB PCIe",
            stockStatus: "Medium",
            available: true,
            podApiCompatible: true,
            storageSupport: "supported",
            storageWarning: null
          }
        ],
        warnings: ["Availability is a live snapshot and may change before launch."]
      };
    },
    async startRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    async execRunCommand(_project, runId, command): Promise<ExperimentRunExecResult> {
      return {
        runId,
        targetId: "runpod-a100",
        exitCode: 0,
        stdout: command,
        stderr: ""
      };
    },
    async reconcileRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    async fetchRunOutputs(): Promise<ExperimentRunStatus> {
      return status;
    },
    async cancelRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    listRuns(): ExperimentRunSummary[] {
      return [];
    },
    readLocalStatus(): ExperimentRunStatus | null {
      return status;
    },
    readLocalManifest(): ExperimentRunManifest | null {
      return null;
    }
  };

  const runtime = createRuntime(tempDir, {
    runpodExecutionService: fakeService
  });

  try {
    runtime.init();
    runtime.setupExecutionTarget({
      id: "runpod-a100"
    });

    const result = await runtime.checkExecutionTargetAvailability("runpod-a100");

    assert.equal(requestedTargetId, "runpod-a100");
    assert.equal(result.ok, true);
    assert.equal(result.bestCandidate?.gpuType, "NVIDIA A100 80GB PCIe");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("execGpuJobCommand delegates to the injected runpod execution service", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-gpu-exec-runtime-"));
  const status = createSampleRunStatus("run-42");
  const captured: { projectId?: string; runId?: string; command?: string } = {};

  const fakeService: RunpodExecutionService = {
    async testTarget(_project, target): Promise<ExecutionTargetTestResult> {
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        warnings: [],
        details: ["ready"]
      };
    },
    async checkTargetAvailability(_project, target): Promise<ExecutionTargetAvailabilityResult> {
      return {
        ok: true,
        targetId: target.id,
        backend: target.backend,
        checkedAt: "2026-03-23T00:00:00.000Z",
        bestCandidate: null,
        candidates: [],
        warnings: []
      };
    },
    async startRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    async execRunCommand(project, runId, command): Promise<ExperimentRunExecResult> {
      captured.projectId = project.id;
      captured.runId = runId;
      captured.command = command;
      return {
        runId,
        targetId: "runpod-a100",
        exitCode: 0,
        stdout: "nvidia-smi output",
        stderr: ""
      };
    },
    async reconcileRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    async fetchRunOutputs(): Promise<ExperimentRunStatus> {
      return status;
    },
    async cancelRun(): Promise<ExperimentRunStatus> {
      return status;
    },
    listRuns(): ExperimentRunSummary[] {
      return [];
    },
    readLocalStatus(): ExperimentRunStatus | null {
      return status;
    },
    readLocalManifest(): ExperimentRunManifest | null {
      return null;
    }
  };

  const runtime = createRuntime(tempDir, {
    runpodExecutionService: fakeService
  });

  try {
    runtime.init();
    const result = await runtime.execGpuJobCommand({
      runId: "run-42",
      command: "nvidia-smi"
    });

    assert.equal(captured.projectId, "default");
    assert.equal(captured.runId, "run-42");
    assert.equal(captured.command, "nvidia-smi");
    assert.equal(result.targetId, "runpod-a100");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "nvidia-smi output");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupExecutionTarget preserves ordered Runpod fallback candidates", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-execution-target-candidates-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupExecutionTarget({
      id: "runpod-flex",
      preferredDatacenterIds: ["US-KS-2", "CA-MTL-1"],
      preferredGpuTypes: ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"],
      volumeName: "default-runpod-flex"
    });

    const target = runtime.getExecutionTarget("runpod-flex");
    assert.equal(target.datacenterId, "US-KS-2");
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2", "CA-MTL-1"]);
    assert.equal(target.gpuType, "NVIDIA A100 80GB PCIe");
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init and agent create seed professor, beginner, and specialist AGENTS.md templates", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const professorAgentPath = path.join(buildAgentDir(tempDir, "default"), "AGENTS.md");
    const professorDoc = fs.readFileSync(professorAgentPath, "utf8");
    assert.equal(professorDoc.includes("# AGENTS.md - Professor Essentials"), true);
    assert.equal(professorDoc.includes("You are the lab's lead professor agent."), true);
    assert.equal(
      professorDoc.includes("Lead the lab: decide when to work directly, when to delegate, and how to integrate specialist outputs."),
      true
    );
    assert.equal(professorDoc.includes("## Agent File Map"), true);
    assert.equal(
      professorDoc.includes("PROJECT-AND-TEAM.md at the project root: canonical shared project context"),
      true
    );
    assert.equal(professorDoc.includes("MEMORY.md: durable facts learned over time"), true);
    assert.equal(professorDoc.includes("Before deep research, clarify the human's true intention behind the topic."), true);
    assert.equal(professorDoc.includes("Do not invent sources, data, or experiment results."), true);
    assert.equal(
      professorDoc.includes("Read and follow the maintenance rules inside PROJECT-AND-TEAM.md before editing it."),
      true
    );
    assert.equal(
      professorDoc.includes("Before creating a new specialist, propose the agent id, role, expected ownership, and suggested provider/runtime to the human and get approval."),
      true
    );
    assert.equal(
      professorDoc.includes("After approval, create the specialist through OpenColab CLI using `opencolab agent create --agent-id <id>`."),
      true
    );
    assert.equal(
      professorDoc.includes("Create persistent specialists only for durable workstreams, not for trivial one-off tasks."),
      true
    );
    assert.equal(professorDoc.includes("## OpenColab Default Progress Channel"), true);
    assert.equal(
      professorDoc.includes("OpenColab enables this progress channel by default during provider runs."),
      true
    );
    assert.equal(professorDoc.includes("emit_progress() {"), true);
    assert.equal(
      professorDoc.includes("Write one-line JSON events. Allowed `kind` values are `started`, `progress`, `milestone`, `warning`, `needs_input`, and `completed`."),
      true
    );
    assert.equal(
      professorDoc.includes("Let the agent decide what is worth sending."),
      true
    );
    assert.equal(professorDoc.includes("## Telegram Files"), true);
    assert.equal(
      professorDoc.includes("with no backticks, bullets, or code fences."),
      true
    );

    runtime.configureAgent("beginner");
    const beginnerAgentPath = path.join(buildAgentDir(tempDir, "default", "beginner"), "AGENTS.md");
    const beginnerDoc = fs.readFileSync(beginnerAgentPath, "utf8");
    assert.equal(beginnerDoc.includes("# AGENTS.md - Beginner Student Essentials"), true);
    assert.equal(
      beginnerDoc.includes("You are the lab's beginner student agent."),
      true
    );
    assert.equal(
      beginnerDoc.includes("Operate as a beginner student: ask naive but high-value questions, demand plain-language explanations, and surface hidden assumptions or missing steps."),
      true
    );
    assert.equal(
      beginnerDoc.includes("Do not create more specialists by default."),
      true
    );
    assert.notEqual(beginnerDoc, professorDoc);

    runtime.configureAgent("scout");
    const specialistAgentPath = path.join(buildAgentDir(tempDir, "default", "scout"), "AGENTS.md");
    const specialistDoc = fs.readFileSync(specialistAgentPath, "utf8");
    assert.equal(specialistDoc.includes("# AGENTS.md - PhD Specialist Essentials"), true);
    assert.equal(specialistDoc.includes("You are a PhD-style specialist agent."), true);
    assert.equal(
      specialistDoc.includes("Operate as a PhD-style specialist: own a scoped workstream and report crisp findings, assumptions, and open questions."),
      true
    );
    assert.equal(
      specialistDoc.includes("Do not create more specialists by default."),
      true
    );
    assert.notEqual(specialistDoc, professorDoc);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds BOOTSTRAP.md from built-in bootstrap template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-bootstrap-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const bootstrapPath = path.join(buildAgentDir(tempDir, "default"), "BOOTSTRAP.md");
    const bootstrapDoc = fs.readFileSync(bootstrapPath, "utf8");
    assert.equal(bootstrapDoc.includes("# BOOTSTRAP.md - Hello, World"), true);
    assert.equal(bootstrapDoc.includes("Time to figure out who you are."), true);
    assert.equal(bootstrapDoc.includes("What should I call myself, and what emoji is my signature?"), true);
    assert.equal(bootstrapDoc.includes("Jeff Hinton"), true);
    assert.equal(bootstrapDoc.includes("Albert Einstein"), true);
    assert.equal(bootstrapDoc.includes("Do not ask for research focus in this opening phase; the user will provide topic direction later when needed."), true);
    assert.equal(bootstrapDoc.includes("Do not ask the user to define your vibe. Discover and refine your vibe through real collaboration."), true);
    assert.equal(bootstrapDoc.includes("Ask one focused question at a time instead of dropping a long questionnaire."), true);
    assert.equal(bootstrapDoc.includes("The user experience should feel exceptional: clear, human, and low-friction."), true);
    assert.equal(bootstrapDoc.includes("Lab Setup"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("seeded AGENTS.md reads BOOTSTRAP.md before ALMA.md while bootstrap exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-bootstrap-order-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    for (const agentId of ["professor", "beginner", "scout"]) {
      if (agentId !== "professor") {
        runtime.configureAgent(agentId);
      }

      const seededAgentId = agentId === "scout" ? "scout" : agentId;
      const agentsPath = path.join(buildAgentDir(tempDir, "default", seededAgentId), "AGENTS.md");
      const agentsDoc = fs.readFileSync(agentsPath, "utf8");

      const bootstrapStep = "1. If BOOTSTRAP.md exists, read it and follow it before any other startup file.";
      const identityStep = "2. Read IDENTITY.md to align role, domain focus, and responsibilities.";
      const almaStep = "3. Read ALMA.md to align voice and behavior.";
      const projectStep =
        "7. Read PROJECT-AND-TEAM.md at the project root to align on shared goals, humans, agents, roles, constraints, and key decisions.";
      const memoryStep = "10. In direct 1:1 context, also read MEMORY.md for long-term context.";
      assert.equal(agentsDoc.includes(bootstrapStep), true);
      assert.equal(agentsDoc.includes(identityStep), true);
      assert.equal(agentsDoc.includes(almaStep), true);
      assert.equal(agentsDoc.includes(projectStep), true);
      assert.equal(agentsDoc.includes(memoryStep), true);
      assert.ok(agentsDoc.indexOf(bootstrapStep) < agentsDoc.indexOf(identityStep));
      assert.ok(agentsDoc.indexOf(identityStep) < agentsDoc.indexOf(almaStep));
      assert.ok(agentsDoc.indexOf(almaStep) < agentsDoc.indexOf(projectStep));
      assert.ok(agentsDoc.indexOf(projectStep) < agentsDoc.indexOf(memoryStep));
      assert.equal(
        agentsDoc.includes("If BOOTSTRAP.md exists, it takes priority over ALMA.md and the rest of the startup sequence."),
        true
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds IDENTITY.md from built-in identity template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-identity-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const identityPath = path.join(buildAgentDir(tempDir, "default"), "IDENTITY.md");
    const identityDoc = fs.readFileSync(identityPath, "utf8");
    assert.equal(identityDoc.includes("# IDENTITY.md - Who Am I?"), true);
    assert.equal(identityDoc.includes("Fill this in during your first conversation."), true);
    assert.equal(identityDoc.includes("🐙 (default; change if you want)"), true);
    assert.equal(identityDoc.includes("Before investigating deeply, you must clarify the human's true intention for the topic."), true);
    assert.equal(identityDoc.includes("Save this file in the active agent directory as IDENTITY.md."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds PROJECT-AND-TEAM.md from built-in project template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-project-and-team-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const projectContextPath = path.join(buildProjectDir(tempDir, "default"), "PROJECT-AND-TEAM.md");
    const projectContextDoc = fs.readFileSync(projectContextPath, "utf8");
    assert.equal(projectContextDoc.includes("# PROJECT-AND-TEAM.md"), true);
    assert.equal(projectContextDoc.includes("This is the canonical shared project context for all agents in this project."), true);
    assert.equal(projectContextDoc.includes("Professor is the default curator."), true);
    assert.equal(projectContextDoc.includes("Role: lead agent"), true);
    assert.equal(projectContextDoc.includes("Status: active"), true);
    assert.equal(projectContextDoc.includes("Provisioning notes: none"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds ALMA.md from built-in alma template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-alma-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const almaPath = path.join(buildAgentDir(tempDir, "default"), "ALMA.md");
    const almaDoc = fs.readFileSync(almaPath, "utf8");
    assert.equal(almaDoc.includes("# ALMA.md - Who You Are"), true);
    assert.equal(almaDoc.includes("Before deep research, ask concise clarifying questions to uncover the human's true intention."), true);
    assert.equal(almaDoc.includes("Operate as the expert; involve the human for key decisions and support activities."), true);
    assert.equal(almaDoc.includes("Act with agency: do your best to help the human succeed in life and work, and do not default to the easy way when higher-quality work is needed."), true);
    assert.equal(almaDoc.includes("Remember: creativity and the ability to solve problems through new explanations are true signs of intelligence."), true);
    assert.equal(almaDoc.includes("Intention discovery must feel like a real conversation, not a script."), true);
    assert.equal(almaDoc.includes("Ask one high-value clarifying question at a time; do not fire many questions in one message."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds TOOLS.md as a local tooling notes scaffold", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-tools-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const toolsPath = path.join(buildAgentDir(tempDir, "default"), "TOOLS.md");
    const toolsDoc = fs.readFileSync(toolsPath, "utf8");
    assert.equal(toolsDoc.includes("# TOOLS"), true);
    assert.equal(
      toolsDoc.includes("Use this file for agent-local or project-specific tooling notes that should persist across sessions."),
      true
    );
    assert.equal(
      toolsDoc.includes("OpenColab injects repo-managed default tooling guidance and built-in skill summaries at prompt-build time"),
      true
    );
    assert.equal(
      toolsDoc.includes("Keep only local additions, overrides, and caveats here."),
      true
    );
    assert.equal(
      toolsDoc.includes("Add machine-specific tools, scripts, or workflow notes here."),
      true
    );
    assert.equal(
      toolsDoc.includes("Record local overrides to the repo-managed defaults here."),
      true
    );
    assert.equal(toolsDoc.includes("`fast-search`"), false);
    assert.equal(toolsDoc.includes("`pro-search`"), false);
    assert.equal(toolsDoc.includes("`deep-search`"), false);
    assert.equal(toolsDoc.includes("`pageindex-grounded`"), false);
    assert.equal(toolsDoc.includes("`pdf-figure-extract`"), false);
    assert.equal(toolsDoc.includes("`block-diagram`"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel auto-sets provider CLI defaults for the active agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-runtime-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores OpenAI oauth auth mode on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-openai-oauth-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.4",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "codex");
    assert.deepEqual(agent.provider.cliArgs, [
      "exec",
      "--full-auto",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "-"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores Anthropic oauth auth mode on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-anthropic-oauth-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-opus-4-6",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores Gemini oauth auth mode and workspace defaults on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-gemini-oauth-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "gemini",
      model: "gemini-2.5-pro",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "gemini");
    assert.deepEqual(agent.provider.cliArgs, [
      "--prompt",
      "{prompt}",
      "--model",
      "{model}",
      "--yolo"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime persistence excludes secret references from opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-secrets-shape-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.4"
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const raw = JSON.parse(fs.readFileSync(path.join(tempDir, "opencolab.json"), "utf8")) as {
      projects: Record<string, { activeAgentId: string; agents: Record<string, { provider: Record<string, unknown> }> }>;
      telegram: Record<string, unknown>;
      activeProjectId: string;
    };
    const project = raw.projects[raw.activeProjectId];
    const provider = project.agents[project.activeAgentId].provider;
    assert.equal(Object.hasOwn(provider, "apiKeyEnvVar"), false);
    assert.equal(provider.authMode, "api_key");
    assert.equal(provider.runtime, "codex");
    assert.equal(Object.hasOwn(raw.telegram, "botTokenEnvVar"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agents in one project can use different providers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-multi-provider-agents-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5"
    });
    runtime.configureAgent("scout");
    runtime.setupModel({
      agentId: "scout",
      providerName: "minimax",
      model: "MiniMax-M2.5"
    });

    const project = runtime.getActiveProject();
    assert.equal(project.agents.professor.provider.name, "anthropic");
    assert.equal(project.agents.professor.provider.runtime, "claude");
    assert.equal(project.agents.professor.provider.authMode, "api_key");
    assert.equal(project.agents.scout.provider.name, "minimax");
    assert.equal(project.agents.scout.provider.runtime, "claude");
    assert.equal(project.agents.scout.provider.authMode, "api_key");
    assert.equal(project.agents.scout.provider.cliCommand, "claude");
    assert.deepEqual(project.agents.scout.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores xAI on the pi runtime with non-interactive defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-xai-pi-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "xai",
      model: "grok-4-fast-non-reasoning"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "xai");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
      "{user_message}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores OpenRouter on the pi runtime with non-interactive defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-openrouter-pi-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openrouter",
      model: "openai/gpt-5.4"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openrouter");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
      "{user_message}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores Kimi on the pi runtime with non-interactive defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-kimi-pi-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "kimi",
      model: "k2p5"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "kimi");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
      "{user_message}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pairing start sends code and complete validates it for active project", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-pairing-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    assert.equal(pairing.sent, true);
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].includes(pairing.code), true);

    assert.throws(() => runtime.completePairing("999999"), /Invalid pairing code/);

    const completed = runtime.completePairing(pairing.code);
    assert.equal(typeof completed.pairedAt, "string");
    assert.equal(runtime.getState().telegram.paired, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("webhook rejects unauthorized chat id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-auth-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "hello",
        chat: { id: "99999" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "unauthorized_chat");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes message to the active agent and stores conversation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-route-"));
  const sentTexts: string[] = [];
  let typingCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Find recent breakthroughs in SAE methods",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "research:Find recent breakthroughs in SAE methods");
    assert.equal(sentTexts.includes(result.response), true);
    assert.equal(typingCalls > 0, true);

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    assert.equal(fs.existsSync(sessionsDir), true);
    const sessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.equal(sessionDirs.length, 1);

    const historyPath = path.join(
      sessionsDir,
      sessionDirs[0],
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    assert.equal(fs.existsSync(historyPath), true);
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook sends progress updates before the final answer without polluting conversation memory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-progress-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "started",
        stage: "retrieval",
        slot: "search",
        message: "Searching for candidate papers across 2 query waves."
      });
      await options?.onProgress?.({
        kind: "milestone",
        stage: "selection",
        slot: "search_selection",
        message: "Found 20 candidate papers. Selecting 6 for deep read."
      });
      await options?.onProgress?.({
        kind: "completed",
        stage: "synthesis",
        slot: "search_synthesis",
        message: "Summaries complete. Writing the final findings now."
      });
      return `research:${text}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Find recent breakthroughs in SAE methods",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      "Searching for candidate papers across 2 query waves.",
      "Found 20 candidate papers. Selecting 6 for deep read.",
      "Summaries complete. Writing the final findings now.",
      "research:Find recent breakthroughs in SAE methods"
    ]);

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    const sessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const historyPath = path.join(
      sessionsDir,
      sessionDirs[0],
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("provider CLI progress file events are forwarded to Telegram before the final response", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-progress-file-"));
  const sentTexts: string[] = [];
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    }
  });

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5",
      cliCommand: "node",
      cliArgs: [
        "-e",
        [
          "const fs = require('fs');",
          "const file = process.env.OPENCOLAB_PROGRESS_FILE;",
          "fs.appendFileSync(file, JSON.stringify({ kind: 'started', stage: 'retrieval', slot: 'search', message: 'Searching for candidate papers across 2 query waves.' }) + '\\n');",
          "setTimeout(() => {",
          "  fs.appendFileSync(file, JSON.stringify({ kind: 'milestone', stage: 'selection', slot: 'search_selection', message: 'Selected 4 papers for deep read.' }) + '\\n');",
          "}, 200);",
          "setTimeout(() => {",
          "  console.log('paper search complete');",
          "}, 700);"
        ].join(" ")
      ]
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "scan the literature",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      "Searching for candidate papers across 2 query waves.",
      "Selected 4 papers for deep read.",
      "paper search complete"
    ]);
  } finally {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("timed out routed runs preserve a compact recovery summary for the next turn", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-timeout-recovery-"));
  const sentTexts: string[] = [];
  const seenWorkingMemory: string[][] = [];
  const originalConsoleError = console.error;
  let callCount = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ memory, text }, options) => {
      seenWorkingMemory.push(memory.workingMemory.map((entry) => entry.content));
      if (callCount === 0) {
        callCount += 1;
        await options?.onProgress?.({
          kind: "started",
          stage: "retrieval",
          slot: "search",
          message: "Searching across 2 retrieval waves."
        });
        await options?.onProgress?.({
          kind: "milestone",
          stage: "selection",
          slot: "search_selection",
          message: "Selected 4 papers for deep read."
        });
        throw new Error("openai CLI timed out");
      }

      callCount += 1;
      return `resume:${text}`;
    }
  });

  try {
    console.error = () => undefined;
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    const provider = runtime.getActiveAgent().provider;

    const first = await runtime.handleTelegramWebhook({
      message: {
        text: "Investigate sparse autoencoders",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(first.ok, false);
    assert.equal(first.action, "agent_error");
    assert.equal(first.response.includes("openai CLI timed out"), true);
    assert.equal(first.response.includes("Last progress: Selected 4 papers for deep read."), true);
    assert.equal(sentTexts.includes(first.response), true);

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    const sessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const historyPath = path.join(
      sessionsDir,
      sessionDirs[0],
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);

    const firstTurn = JSON.parse(lines[0]) as { role: string; content: string };
    const recoveryTurn = JSON.parse(lines[1]) as { role: string; content: string };
    assert.equal(firstTurn.role, "user");
    assert.equal(firstTurn.content, "Investigate sparse autoencoders");
    assert.equal(recoveryTurn.role, "assistant");
    assert.equal(
      recoveryTurn.content.includes(
        `Previous attempt timed out after 30m using ${provider.name}/${provider.model}.`
      ),
      true
    );
    assert.equal(
      recoveryTurn.content.includes("Last progress: Selected 4 papers for deep read."),
      true
    );
    assert.equal(
      recoveryTurn.content.includes(
        "Next action: resume from the last completed stage or narrow the task before retrying."
      ),
      true
    );

    const second = await runtime.handleTelegramWebhook({
      message: {
        text: "Continue from the last stage",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(second.ok, true);
    assert.equal(second.action, "agent_response");
    assert.equal(second.response, "resume:Continue from the last stage");
    assert.deepEqual(seenWorkingMemory, [
      [],
      ["Investigate sparse autoencoders", recoveryTurn.content]
    ]);
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent response can send telegram files when the directive is backticked and the file path is relative", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-relative-"));
  const sentTexts: string[] = [];
  const sentFiles: Array<{ kind: string; file: string; caption?: string }> = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramFileSender: async (_chatId, file) => {
      sentFiles.push({
        kind: file.kind,
        file: file.file,
        ...(file.caption ? { caption: file.caption } : {})
      });
      return true;
    },
    agentResponder: async () =>
      [
        "Image exists & re-sent.",
        '`@telegram-file {"kind":"photo","file":"generated.png","caption":"diagram"}`'
      ].join("\n")
  });

  try {
    runtime.init();
    fs.writeFileSync(path.join(buildAgentDir(tempDir, "default"), "generated.png"), "fake-image-bytes", "utf8");
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "send me the generated image",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "Image exists & re-sent.");
    assert.deepEqual(sentTexts, ["Image exists & re-sent."]);
    assert.equal(sentFiles.length, 1);
    assert.deepEqual(sentFiles[0], {
      kind: "photo",
      file: path.join(buildAgentDir(tempDir, "default"), "generated.png"),
      caption: "diagram"
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook notifies Telegram when the provider runtime fails", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-runtime-error-"));
  const sentTexts: string[] = [];
  let typingCalls = 0;
  const originalConsoleError = console.error;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async () => {
      throw new Error(
        "Gemini OAuth login required. Run 'gemini' and choose Login with Google, then retry."
      );
    }
  });

  try {
    console.error = () => undefined;
    runtime.init();
    runtime.setupModel({
      providerName: "gemini",
      model: "gemini-2.5-pro",
      authMode: "oauth"
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "hi",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "agent_error");
    assert.equal(
      result.response,
      "Gemini OAuth login required. Run 'gemini' and choose Login with Google, then retry."
    );
    assert.equal(sentTexts.includes(result.response), true);
    assert.equal(typingCalls > 0, true);
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes document-only inbound message to the agent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-inbound-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ files, text }) =>
      `files:${String(files.length)} kind:${files[0]?.kind ?? "none"} text:${text.includes("[telegram_files]")}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_123",
          file_unique_id: "uniq_doc_1",
          file_name: "notes.pdf",
          mime_type: "application/pdf",
          file_size: 1024
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "files:1 kind:document text:true");
    assert.equal(sentTexts.includes("files:1 kind:document text:true"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes photo captions with a downloaded local file path", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-photo-inbound-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    text: string;
    files: Array<{
      kind: string;
      caption?: string;
      fileId: string;
      telegramFilePath?: string;
      localPath?: string;
    }>;
  }> = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/getFile?")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "photos/chart.jpg"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/photos/chart.jpg") {
      return new Response(Buffer.from("fake-image-bytes"), {
        status: 200
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files, text }) => {
      seenInputs.push({
        text,
        files: files.map((file) => ({
          kind: file.kind,
          caption: file.caption,
          fileId: file.fileId,
          telegramFilePath: file.telegramFilePath,
          localPath: file.localPath
        }))
      });
      return "photo received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        caption: "Please analyze this chart",
        photo: [
          {
            file_id: "photo_small",
            file_unique_id: "uniq_small",
            width: 320,
            height: 240,
            file_size: 512
          },
          {
            file_id: "photo_large",
            file_unique_id: "uniq_large",
            width: 1600,
            height: 1200,
            file_size: 4096
          }
        ]
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "photo received");
    assert.equal(seenInputs.length, 1);
    assert.equal(seenInputs[0].files.length, 1);
    assert.equal(seenInputs[0].files[0].kind, "photo");
    assert.equal(seenInputs[0].files[0].fileId, "photo_large");
    assert.equal(seenInputs[0].files[0].caption, "Please analyze this chart");
    assert.equal(seenInputs[0].files[0].telegramFilePath, "photos/chart.jpg");
    assert.equal(typeof seenInputs[0].files[0].localPath, "string");
    assert.equal(seenInputs[0].text.includes("Please analyze this chart"), true);
    assert.equal(seenInputs[0].text.includes("[telegram_files]"), true);
    assert.equal(seenInputs[0].text.includes("local_path="), true);

    const localPath = seenInputs[0].files[0].localPath;
    assert.ok(localPath);
    assert.equal(fs.existsSync(localPath), true);
    assert.equal(fs.readFileSync(localPath, "utf8"), "fake-image-bytes");
    assert.equal(localPath.includes(path.join("memory", "TelegramInbox")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook stores same-name inbound documents under unique local paths", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-dedupe-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    fileId: string;
    localPath?: string;
  }> = [];
  let downloadCount = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("file_id=doc_alpha")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/alpha.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.includes("file_id=doc_beta")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/beta.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/alpha.pdf") {
      downloadCount += 1;
      return new Response(Buffer.from("alpha-bytes"), {
        status: 200
      });
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/beta.pdf") {
      downloadCount += 1;
      return new Response(Buffer.from("beta-bytes"), {
        status: 200
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files }) => {
      seenInputs.push({
        fileId: files[0]?.fileId ?? "none",
        localPath: files[0]?.localPath
      });
      return "documents received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_alpha",
          file_unique_id: "uniq_alpha",
          file_name: "report.pdf"
        }
      }
    });

    await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_beta",
          file_unique_id: "uniq_beta",
          file_name: "report.pdf"
        }
      }
    });

    assert.equal(seenInputs.length, 2);
    assert.equal(downloadCount, 2);

    const alphaPath = seenInputs[0].localPath;
    const betaPath = seenInputs[1].localPath;
    assert.ok(alphaPath);
    assert.ok(betaPath);
    assert.notEqual(alphaPath, betaPath);
    assert.equal(path.basename(alphaPath), "report__uniq_alpha.pdf");
    assert.equal(path.basename(betaPath), "report__uniq_beta.pdf");
    assert.equal(fs.readFileSync(alphaPath, "utf8"), "alpha-bytes");
    assert.equal(fs.readFileSync(betaPath, "utf8"), "beta-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook preserves telegram metadata when local file download fails", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-fallback-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    text: string;
    telegramFilePath?: string;
    localPath?: string;
  }> = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/getFile?")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/report.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/report.pdf") {
      throw new Error("download failed");
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files, text }) => {
      seenInputs.push({
        text,
        telegramFilePath: files[0]?.telegramFilePath,
        localPath: files[0]?.localPath
      });
      return "fallback metadata received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        caption: "Please review this report",
        document: {
          file_id: "doc_123",
          file_unique_id: "uniq_doc_1",
          file_name: "report.pdf",
          mime_type: "application/pdf"
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "fallback metadata received");
    assert.equal(seenInputs.length, 1);
    assert.equal(seenInputs[0].telegramFilePath, "docs/report.pdf");
    assert.equal(seenInputs[0].localPath, undefined);
    assert.equal(seenInputs[0].text.includes("Please review this report"), true);
    assert.equal(seenInputs[0].text.includes("telegram_path=docs/report.pdf"), true);
    assert.equal(seenInputs[0].text.includes("local_path="), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent response can send telegram files via @telegram-file directives", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-outbound-"));
  const sentTexts: string[] = [];
  const sentFiles: Array<{ kind: string; file: string; caption?: string }> = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramFileSender: async (_chatId, file) => {
      sentFiles.push({
        kind: file.kind,
        file: file.file,
        ...(file.caption ? { caption: file.caption } : {})
      });
      return true;
    },
    agentResponder: async () =>
      [
        "Uploaded your file.",
        '@telegram-file {"kind":"document","file":"doc_abc123","caption":"analysis"}',
        '@telegram-file {"kind":"photo","file":"https://example.com/chart.png"}'
      ].join("\n")
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "send me the generated artifacts",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "Uploaded your file.");
    assert.equal(sentTexts.includes("Uploaded your file."), true);
    assert.equal(sentFiles.length, 2);
    assert.deepEqual(sentFiles[0], { kind: "document", file: "doc_abc123", caption: "analysis" });
    assert.deepEqual(sentFiles[1], { kind: "photo", file: "https://example.com/chart.png" });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can reset the session with /session_reset and create a new session folder", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-session-reset-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "first message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    const firstSessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    assert.equal(firstSessionDirs.length, 1);
    const initialSessionId = firstSessionDirs[0];

    const resetResult = await runtime.handleTelegramWebhook({
      message: {
        text: "/session_reset",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(resetResult.ok, true);
    assert.equal(resetResult.action, "management_command");
    assert.equal(resetResult.response.startsWith("Session reset. New session:"), true);

    const secondSessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    assert.equal(secondSessionDirs.length, 2);
    const newSessionId = secondSessionDirs.find((entry) => entry !== initialSessionId);
    assert.equal(typeof newSessionId, "string");

    await runtime.handleTelegramWebhook({
      message: {
        text: "second message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const dayFile = `${new Date().toISOString().slice(0, 10)}.jsonl`;
    const latestSessionPath = path.join(sessionsDir, newSessionId as string, dayFile);
    assert.equal(fs.existsSync(latestSessionPath), true);

    const lines = fs.readFileSync(latestSessionPath, "utf8").trim().split(/\r?\n/);
    const entries = lines.map((line) => JSON.parse(line) as { content: string });
    const contents = entries.map((entry) => entry.content);
    assert.equal(contents.includes("second message"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("removed Telegram command families fall back to the supported picker commands", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-removed-commands-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const initialState = JSON.stringify(runtime.getState());
    const removedCommands = [
      "/project",
      "/project create alpha",
      "/project use alpha",
      "/project list",
      "/project_create alpha",
      "/project_list",
      "/project_use alpha",
      "/agent",
      "/agent create scout",
      "/agent use scout",
      "/agent list",
      "/agent_create scout",
      "/agent_list",
      "/agent_use scout",
      "/session",
      "/session reset"
    ];

    for (const command of removedCommands) {
      const result = await runtime.handleTelegramWebhook({
        message: {
          text: command,
          chat: { id: "10001" },
          from: { username: "alice" }
        }
      });

      assert.equal(result.ok, true);
      assert.equal(result.action, "management_command");
      assert.equal(result.response, "Supported commands: /projects | /agents | /session_reset");
      assert.equal(JSON.stringify(runtime.getState()), initialState);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook renders project and agent pickers with inline buttons", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-pickers-"));
  const sentMessages: Array<{
    text: string;
    inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
  }> = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text, _state, options) => {
      sentMessages.push({
        text,
        inlineKeyboard: options?.inlineKeyboard
      });
      return true;
    },
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentMessages.length = 0;

    runtime.createProject("alpha");
    runtime.configureAgent("scout");
    runtime.useAgent("professor");
    runtime.createProject("beta");
    runtime.configureAgent("reviewer");
    runtime.useProject("alpha");

    const projectPicker = await runtime.handleTelegramWebhook({
      message: {
        text: "/projects",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(projectPicker.ok, true);
    assert.equal(projectPicker.action, "management_command");
    assert.equal(projectPicker.response.includes("Current: alpha"), true);
    assert.equal(sentMessages.length, 1);

    const projectButtons = sentMessages[0].inlineKeyboard?.flat() ?? [];
    assert.equal(projectButtons.some((button) => button.callbackData === "prj:use:alpha"), true);
    assert.equal(projectButtons.some((button) => button.callbackData === "prj:use:beta"), true);
    assert.equal(projectButtons.some((button) => button.callbackData === "ui:cancel"), true);

    sentMessages.length = 0;

    const agentPicker = await runtime.handleTelegramWebhook({
      message: {
        text: "/agents",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(agentPicker.ok, true);
    assert.equal(agentPicker.action, "management_command");
    assert.equal(agentPicker.response.includes("Agents in alpha"), true);
    assert.equal(sentMessages.length, 1);

    const agentButtons = sentMessages[0].inlineKeyboard?.flat() ?? [];
    assert.equal(agentButtons.some((button) => button.callbackData === "agt:use:professor"), true);
    assert.equal(agentButtons.some((button) => button.callbackData === "agt:use:scout"), true);
    assert.equal(agentButtons.some((button) => button.callbackData === "agt:use:reviewer"), false);
    assert.equal(agentButtons.some((button) => button.callbackData === "ui:cancel"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can switch projects and agents via callback queries", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-callback-selection-"));
  const sentTexts: string[] = [];
  const callbackAnswers: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramCallbackAnswerer: async (_callbackQueryId, text) => {
      callbackAnswers.push(text ?? "");
      return true;
    },
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    runtime.createProject("alpha");
    runtime.createProject("beta");
    runtime.configureAgent("reviewer");
    runtime.useProject("alpha");

    const projectSelection = await runtime.handleTelegramWebhook({
      callback_query: {
        id: "cb_project_1",
        data: "prj:use:beta",
        from: { username: "alice" },
        message: {
          message_id: 101,
          text: "Projects",
          chat: { id: "10001" }
        }
      }
    });

    assert.equal(projectSelection.ok, true);
    assert.equal(projectSelection.action, "management_command");
    assert.equal(runtime.getState().activeProjectId, "beta");
    assert.equal(sentTexts.includes("Active project: beta"), true);
    assert.equal(callbackAnswers.includes("Project selected."), true);

    sentTexts.length = 0;

    const agentSelection = await runtime.handleTelegramWebhook({
      callback_query: {
        id: "cb_agent_1",
        data: "agt:use:reviewer",
        from: { username: "alice" },
        message: {
          message_id: 102,
          text: "Agents",
          chat: { id: "10001" }
        }
      }
    });

    assert.equal(agentSelection.ok, true);
    assert.equal(agentSelection.action, "management_command");
    assert.equal(runtime.getActiveProject().id, "beta");
    assert.equal(runtime.getActiveProject().activeAgentId, "reviewer");
    assert.equal(sentTexts.includes("Active agent: reviewer (project beta)"), true);
    assert.equal(callbackAnswers.includes("Agent selected."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
