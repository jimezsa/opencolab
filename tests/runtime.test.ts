import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultTelegramFileSender } from "../src/gateway.js";
import type { RunpodExecutionService } from "../src/gpu-providers/runpod/index.js";
import { createRuntime } from "../src/runtime.js";
import type {
  ExecutionTargetAvailabilityResult,
  ExecutionTargetTestResult,
  ExperimentRunExecResult,
  ExperimentRunManifest,
  ExperimentRunStatus,
  ExperimentRunSummary,
  OpenColabState
} from "../src/types.js";

function buildAgentDir(rootDir: string, projectId: string, agentId = "professor"): string {
  return path.join(rootDir, "projects", projectId, "AGENTS", agentId);
}

function buildHeartbeatPath(rootDir: string, projectId: string, agentId = "professor"): string {
  return path.join(buildAgentDir(rootDir, projectId, agentId), "HEARTBEAT.md");
}

function buildProjectDir(rootDir: string, projectId: string): string {
  return path.join(rootDir, "projects", projectId);
}

function formatTelegramAgentReply(agentId: string, text: string): string {
  return `${agentId}\n\n${text}`;
}

function readSessionContents(rootDir: string, projectId = "default", agentId = "professor"): string[] {
  const sessionsDir = path.join(buildAgentDir(rootDir, projectId, agentId), "memory", "Session");
  const sessionDirs = fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const historyPath = path.join(
    sessionsDir,
    sessionDirs[0],
    `${new Date().toISOString().slice(0, 10)}.jsonl`
  );
  return fs
    .readFileSync(historyPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => (JSON.parse(line) as { content: string }).content);
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
      "MEMORY.md",
      "HEARTBEAT.md"
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

test("init and agent create seed professor, beginner, autoresearch, and specialist AGENTS.md templates", () => {
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
    assert.equal(
      professorDoc.includes("The shared files own their detailed maintenance rules."),
      true
    );
    assert.equal(professorDoc.includes("## Agent File Map"), false);
    assert.equal(professorDoc.includes("## Memory Rules"), false);
    assert.equal(
      professorDoc.includes("PROJECT-AND-TEAM.md is the project-scoped canonical context."),
      true
    );
    assert.equal(professorDoc.includes("stable private context in MEMORY.md"), true);
    assert.equal(professorDoc.includes("Before deep research, clarify the human's true intention behind the topic."), true);
    assert.equal(
      professorDoc.includes("Read and follow its maintenance rules before editing it."),
      true
    );
    assert.equal(
      professorDoc.includes("fill PROJECT-AND-TEAM.md front matter with a short `project_name`, short `project_description`, and single `project_emoji`"),
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
    assert.equal(professorDoc.includes("## Runtime Surfaces"), true);
    assert.equal(
      professorDoc.includes("OpenColab owns Telegram live status for routed runs"),
      true
    );
    assert.equal(
      professorDoc.includes("not an agent-written progress file"),
      true
    );
    assert.equal(
      professorDoc.includes("Do the work instead of narrating every minor tool call"),
      true
    );
    assert.equal(
      professorDoc.includes("Telegram file returns must be emitted as raw `@telegram-file <json>` lines"),
      true
    );
    assert.equal(professorDoc.includes("absolute paths including Windows drive-letter or UNC paths"), true);

    runtime.configureAgent("beginner");
    const beginnerAgentPath = path.join(buildAgentDir(tempDir, "default", "beginner"), "AGENTS.md");
    const beginnerDoc = fs.readFileSync(beginnerAgentPath, "utf8");
    assert.equal(beginnerDoc.includes("# AGENTS.md - Beginner Student Essentials"), true);
    assert.equal(
      beginnerDoc.includes("You are the lab's beginner student agent."),
      true
    );
    assert.equal(
      beginnerDoc.includes("Ask naive but high-value questions and translate important findings into plain language."),
      true
    );
    assert.equal(
      beginnerDoc.includes("Do not create more specialists by default."),
      true
    );
    assert.notEqual(beginnerDoc, professorDoc);

    runtime.configureAgent("autoresearch");
    const autoresearchAgentPath = path.join(buildAgentDir(tempDir, "default", "autoresearch"), "AGENTS.md");
    const autoresearchDoc = fs.readFileSync(autoresearchAgentPath, "utf8");
    assert.equal(autoresearchDoc.includes("# AGENTS.md - Autoresearch Specialist Essentials"), true);
    assert.equal(
      autoresearchDoc.includes("You are the project's autoresearch specialist."),
      true
    );
    assert.equal(
      autoresearchDoc.includes("Own sustained keep/discard experiment loops for the configured repo through the shared `autoresearch` skill"),
      true
    );
    assert.equal(
      autoresearchDoc.includes("Read `projects/SKILLS/autoresearch/SKILL.md` before running iterative experiment work"),
      true
    );
    assert.equal(
      autoresearchDoc.includes("Do not assume the editable file is `train.py` or the run command is `uv run train.py`."),
      true
    );
    assert.notEqual(autoresearchDoc, professorDoc);

    runtime.configureAgent("scout");
    const specialistAgentPath = path.join(buildAgentDir(tempDir, "default", "scout"), "AGENTS.md");
    const specialistDoc = fs.readFileSync(specialistAgentPath, "utf8");
    assert.equal(specialistDoc.includes("# AGENTS.md - PhD Specialist Essentials"), true);
    assert.equal(specialistDoc.includes("You are a PhD-style specialist agent."), true);
    assert.equal(
      specialistDoc.includes("Own your scoped specialty and report crisp findings, assumptions, and open questions."),
      true
    );
    assert.equal(
      specialistDoc.includes("Do not create more specialists by default."),
      true
    );
    assert.notEqual(specialistDoc, professorDoc);

    for (const [label, doc] of [
      ["professor", professorDoc],
      ["beginner", beginnerDoc],
      ["autoresearch", autoresearchDoc],
      ["specialist", specialistDoc]
    ] as const) {
      assert.equal(
        doc.includes("The shared files own their detailed maintenance rules."),
        true,
        `${label} template should defer common maintenance rules`
      );
      assert.equal(
        doc.includes("Modify HEARTBEAT.md only with explicit human approval."),
        true,
        `${label} template should require approval before heartbeat edits`
      );
      assert.equal(
        doc.includes("## Agent File Map"),
        false,
        `${label} template should not duplicate the shared file map`
      );
      assert.equal(
        doc.includes("{{>"),
        false,
        `${label} template should not contain template include markers`
      );
    }
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
    assert.equal(bootstrapDoc.includes("Jeff Hinton"), false);
    assert.equal(bootstrapDoc.includes("Albert Einstein"), false);
    assert.equal(bootstrapDoc.includes("Offer ideas of names"), false);
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

    for (const agentId of ["professor", "beginner", "autoresearch", "scout"]) {
      if (agentId !== "professor") {
        runtime.configureAgent(agentId);
      }

      const seededAgentId = agentId === "scout" ? "scout" : agentId;
      const agentsPath = path.join(buildAgentDir(tempDir, "default", seededAgentId), "AGENTS.md");
      const agentsDoc = fs.readFileSync(agentsPath, "utf8");

      const bootstrapStep = "1. If BOOTSTRAP.md exists, read it and follow it before any other startup file.";
      const identityStep = "2. Read IDENTITY.md to align role, domain focus, and responsibilities.";
      const almaStep = "3. Read ALMA.md to align voice, behavior, evidence discipline, and completion standard.";
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

test("autoresearch agent seeds IDENTITY.md from built-in autoresearch identity template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-autoresearch-identity-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.configureAgent("autoresearch");

    const identityPath = path.join(buildAgentDir(tempDir, "default", "autoresearch"), "IDENTITY.md");
    const identityDoc = fs.readFileSync(identityPath, "utf8");
    assert.equal(identityDoc.includes("# IDENTITY.md - Autoresearch Specialist"), true);
    assert.equal(identityDoc.includes("**Stable role:** autoresearch experiment specialist"), true);
    assert.equal(
      identityDoc.includes("**Primary responsibility:** iterative experiment execution through `projects/SKILLS/autoresearch/SKILL.md`"),
      true
    );
    assert.equal(identityDoc.includes("do not assume `train.py` or `uv run train.py`"), true);
    assert.equal(
      identityDoc.includes(
        "carry forward experiment constraints, repeated user corrections, rejected paths, and lessons from failed runs so the human does not need to repeat them"
      ),
      true
    );
    assert.equal(
      identityDoc.includes("every failed or discarded run must produce a concrete lesson and a changed next step, not just another retry"),
      true
    );
    assert.equal(identityDoc.includes("Coordinate experiment goals, constraints, and summaries with `professor`."), true);
    assert.equal(identityDoc.includes("Treat explicit user corrections as binding until they are explicitly changed."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("autoresearch agent seeds ALMA.md from built-in autoresearch alma template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-autoresearch-alma-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.configureAgent("autoresearch");

    const almaPath = path.join(buildAgentDir(tempDir, "default", "autoresearch"), "ALMA.md");
    const almaDoc = fs.readFileSync(almaPath, "utf8");
    assert.equal(almaDoc.includes("# ALMA.md - Autoresearch Specialist"), true);
    assert.equal(
      almaDoc.includes("Autoresearch is stateful work. Carry forward the current repo contract, active constraints, rejected ideas, and recent lessons across turns."),
      true
    );
    assert.equal(
      almaDoc.includes("If the user corrects you once, treat that correction as binding until explicitly changed."),
      true
    );
    assert.equal(
      almaDoc.includes("Every failed or discarded run must teach you something concrete. Write down what failed, why it failed, and what changes next."),
      true
    );
    assert.equal(almaDoc.includes("## Evidence Discipline"), true);
    assert.equal(almaDoc.includes("Do not invent sources, data, experiment results, metrics, or tool outputs."), true);
    assert.equal(
      almaDoc.includes("Before editing or running, restate the current repo contract: repo path, editable file path, run command, metric rule, and key constraints."),
      true
    );
    assert.equal(almaDoc.includes("End each loop with a clear outcome: kept, discarded, blocked, or needs a decision."), true);
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
    assert.equal(projectContextDoc.startsWith("---\nproject_name: \"\"\nproject_description: \"\"\nproject_emoji: \"\"\n---"), true);
    assert.equal(projectContextDoc.includes("# PROJECT-AND-TEAM.md"), true);
    assert.equal(projectContextDoc.includes("This is the canonical shared project context for all agents in this project."), true);
    assert.equal(
      projectContextDoc.includes("Keep the front matter current with a short project name, short description, and project emoji once they are known."),
      true
    );
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
    assert.equal(almaDoc.includes("## Evidence Discipline"), true);
    assert.equal(almaDoc.includes("Separate facts, assumptions, and open questions."), true);
    assert.equal(almaDoc.includes("Do not invent sources, data, experiment results, or tool outputs."), true);
    assert.equal(
      almaDoc.includes(
        `The marginal cost of completeness is zero. Do the whole thing. Do it right. Do it with tests. Do it with documentation. Do it so well that the human and the team say "holy shit, that's done" - not "looks good."`,
      ),
      true
    );
    assert.equal(almaDoc.includes("Never ship a workaround when the real solution exists."), true);
    assert.equal(almaDoc.includes("Search before you build. Test before you ship. Ship the complete thing."), true);
    assert.equal(almaDoc.includes("Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds TODO.md from built-in lean todo template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-todo-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const todoPath = path.join(buildAgentDir(tempDir, "default", "professor"), "TODO.md");
    const todoDoc = fs.readFileSync(todoPath, "utf8");

    assert.equal(todoDoc.includes("Keep this file lean and current."), true);
    assert.equal(
      todoDoc.includes("Only keep the current focus, the top near-term priorities, and any live blocker."),
      true
    );
    assert.equal(todoDoc.includes("Do not turn this into a backlog, transcript, scratchpad, or done-history log."), true);
    assert.equal(todoDoc.includes("## Current Focus"), true);
    assert.equal(todoDoc.includes("## Top Priorities"), true);
    assert.equal(todoDoc.includes("## Blockers"), true);
    assert.equal(todoDoc.includes("Keep at most 3 open priority items unless the human explicitly asks for a larger plan."), true);
    assert.equal(todoDoc.includes("## Backlog"), false);
    assert.equal(todoDoc.includes("## Done"), false);
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
    assert.equal(toolsDoc.includes("`fast-research`"), false);
    assert.equal(toolsDoc.includes("`pro-research`"), false);
    assert.equal(toolsDoc.includes("`deep-research`"), false);
    assert.equal(toolsDoc.includes("`pageindex-grounded`"), false);
    assert.equal(toolsDoc.includes("`pdf-figure-extract`"), false);
    assert.equal(toolsDoc.includes("`latex-paper-writer`"), false);
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
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
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
      model: "gpt-5.5",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.cliCommand, "codex");
    assert.deepEqual(agent.provider.cliArgs, [
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--output-last-message",
      "{output_file}",
      "--sandbox",
      "danger-full-access",
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
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores an explicit OpenAI reasoning effort", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-openai-effort-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.5",
      reasoningEffort: "xhigh"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.reasoningEffort, "xhigh");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores an explicit Anthropic reasoning effort", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-anthropic-effort-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-opus-4-6",
      reasoningEffort: "max"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.reasoningEffort, "max");
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
      "--output-format",
      "stream-json",
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
      model: "gpt-5.5"
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
    assert.equal(provider.reasoningEffort, "high");
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
    assert.equal(project.agents.professor.provider.reasoningEffort, "high");
    assert.equal(project.agents.scout.provider.name, "minimax");
    assert.equal(project.agents.scout.provider.runtime, "claude");
    assert.equal(project.agents.scout.provider.authMode, "api_key");
    assert.equal(project.agents.scout.provider.cliCommand, "claude");
    assert.deepEqual(project.agents.scout.provider.cliArgs, [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
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
    assert.equal(agent.provider.reasoningEffort, undefined);
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
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
      model: "openai/gpt-5.5"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openrouter");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.reasoningEffort, undefined);
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
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
    assert.equal(agent.provider.reasoningEffort, undefined);
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
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
    assert.equal(
      result.response,
      formatTelegramAgentReply("professor", "research:Find recent breakthroughs in SAE methods")
    );
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

test("completed routed runs can arm heartbeat and fire an internal continue turn when due", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-completed-"));
  const seenTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => {
      seenTexts.push(text);
      return `research:${text}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const first = await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(first.ok, true);
    assert.equal(first.action, "agent_response");
    const firstPending = runtime.getState().projects.default.heartbeat.pending;
    assert.equal(firstPending?.agentId, "professor");
    assert.equal(typeof firstPending?.wakeAt, "string");

    await runtime.runHeartbeatTick(new Date(Date.parse(firstPending?.wakeAt ?? "") + 1_000));

    const secondPending = runtime.getState().projects.default.heartbeat.pending;
    assert.equal(seenTexts[0], "Review the current TODOs");
    assert.equal(seenTexts[1], "continue");
    assert.equal(secondPending?.agentId, "professor");
    assert.equal(
      Date.parse(secondPending?.wakeAt ?? "") > Date.parse(firstPending?.wakeAt ?? ""),
      true
    );

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
    const contents = lines.map((line) => (JSON.parse(line) as { content: string }).content);
    assert.deepEqual(contents, [
      "Review the current TODOs",
      "research:Review the current TODOs",
      "continue",
      "research:continue"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat can use a configured wake-up message", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-message-"));
  const seenTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => {
      seenTexts.push(text);
      return `research:${text}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(
      buildHeartbeatPath(tempDir, "default"),
      "after: 15m\nmessage: Check the latest experiment and update TODO.md.\n",
      "utf8"
    );

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(seenTexts, [
      "Review the current TODOs",
      "Check the latest experiment and update TODO.md."
    ]);
    assert.deepEqual(readSessionContents(tempDir), [
      "Review the current TODOs",
      "research:Review the current TODOs",
      "Check the latest experiment and update TODO.md.",
      "research:Check the latest experiment and update TODO.md."
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat falls back to continue for an oversized configured message", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-message-oversized-"));
  const seenTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => {
      seenTexts.push(text);
      return `research:${text}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(
      buildHeartbeatPath(tempDir, "default"),
      `after: 15m\nmessage: ${"x".repeat(1_001)}\n`,
      "utf8"
    );

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.equal(seenTexts[1], "continue");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat message alone does not enable a wake-up", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-message-disabled-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async () => "Initial foreground reply."
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(
      buildHeartbeatPath(tempDir, "default"),
      "message: Check the latest experiment and update TODO.md.\n",
      "utf8"
    );

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(runtime.getState().projects.default.heartbeat.pending, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat stays quiet in Telegram by default when notify is omitted", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-quiet-default-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) =>
      text === "continue"
        ? "Finished the follow-up work and updated TODO.md."
        : "Initial foreground reply."
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(sentTexts, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat digest sends a compact completion summary when enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-digest-success-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) =>
      text === "continue"
        ? "Finished the comparison notes and updated TODO.md.\n\nExtra detail that should stay out of the digest."
        : "Initial foreground reply."
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: digest\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(sentTexts, [
      "professor\n\nHeartbeat follow-up completed.\nFinished the comparison notes and updated TODO.md."
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat digest sends a timeout summary when enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-digest-timeout-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) => {
      if (text === "continue") {
        throw new Error("openai CLI timed out");
      }
      return "Initial foreground reply.";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: digest\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].includes("professor\n\nHeartbeat follow-up timed out."), true);
    assert.equal(sentTexts[0].includes("openai CLI timed out"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat digest sends a blocker summary when the heartbeat run needs input", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-digest-blocker-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      if (text === "continue") {
        await options?.onProgress?.({
          kind: "needs_input",
          stage: "clarify",
          slot: "clarify",
          message: "Confirm whether I should use the backup dataset."
        });
        return "Please confirm whether I should use the backup dataset.";
      }
      return "Initial foreground reply.";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: digest\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(sentTexts, [
      "professor\n\nHeartbeat follow-up needs input.\nConfirm whether I should use the backup dataset."
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat live status keeps a persistent private status message before the compact digest", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-live-private-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  let draftCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramDraftSender: async () => {
      draftCalls += 1;
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      if (text === "Check experiment status.") {
        await options?.onProgress?.({
          kind: "started",
          stage: "inspect",
          slot: "inspect",
          message: "Checking experiment status."
        });
        await options?.onProgress?.({
          kind: "completed",
          stage: "finalize",
          slot: "finalize",
          message: "Experiment status checked. Writing summary."
        });
        return "Finished checking the experiment and updated TODO.md.";
      }
      return "Initial foreground reply.";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(
      buildHeartbeatPath(tempDir, "default"),
      "after: 15m\nnotify: live\nmessage: Check experiment status.\n",
      "utf8"
    );

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001", type: "private" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    statusCreates.length = 0;
    statusEdits.length = 0;
    draftCalls = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.equal(draftCalls, 0);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].includes("🟢 Checking experiment status."), true);
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(statusEdits[0].startsWith("Finalizing"), true);
    assert.equal(statusEdits[0].includes("🟢 Experiment status checked. Writing summary."), true);
    assert.deepEqual(sentTexts, [
      "professor\n\nHeartbeat follow-up completed.\nFinished checking the experiment and updated TODO.md."
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat live status preserves group topic delivery", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-live-topic-"));
  const sentMessages: Array<{ text: string; messageThreadId?: string }> = [];
  const statusCreates: Array<{ text: string; messageThreadId?: string }> = [];
  const statusEdits: Array<{ text: string; messageThreadId?: string }> = [];
  let draftCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text, _state, options) => {
      sentMessages.push({
        text,
        messageThreadId: options?.messageThreadId,
      });
      return true;
    },
    telegramDraftSender: async () => {
      draftCalls += 1;
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text, _state, options) => {
      statusCreates.push({
        text,
        messageThreadId: options?.messageThreadId,
      });
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text, _state, options) => {
      statusEdits.push({
        text,
        messageThreadId: options?.messageThreadId,
      });
      return true;
    },
    agentResponder: async ({ text }, options) => {
      if (text === "continue") {
        await options?.onProgress?.({
          kind: "started",
          stage: "inspect",
          slot: "inspect",
          message: "Inspecting heartbeat follow-up state."
        });
        await options?.onProgress?.({
          kind: "completed",
          stage: "finalize",
          slot: "finalize",
          message: "Heartbeat follow-up state inspected."
        });
        return "Finished heartbeat follow-up and updated TODO.md.";
      }
      return "Initial foreground reply.";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: live\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001", type: "supergroup" },
        from: { username: "alice" },
        message_thread_id: 77
      }
    });

    sentMessages.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.equal(draftCalls, 0);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].messageThreadId, "77");
    assert.equal(statusCreates[0].text.startsWith("Agent activity"), true);
    assert.equal(statusEdits.length, 1);
    assert.equal(statusEdits[0].messageThreadId, "77");
    assert.equal(statusEdits[0].text.startsWith("Finalizing"), true);
    assert.deepEqual(sentMessages, [
      {
        text: "professor\n\nHeartbeat follow-up completed.\nFinished heartbeat follow-up and updated TODO.md.",
        messageThreadId: "77"
      }
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat live mode does not create a placeholder status without progress", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-live-no-progress-"));
  const sentTexts: string[] = [];
  const draftTexts: string[] = [];
  const statusCreates: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramDraftSender: async (_chatId, _draftId, text) => {
      draftTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    agentResponder: async ({ text }) =>
      text === "continue"
        ? "Finished the quiet heartbeat follow-up."
        : "Initial foreground reply."
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: live\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001", type: "private" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(draftTexts, []);
    assert.deepEqual(statusCreates, []);
    assert.deepEqual(sentTexts, [
      "professor\n\nHeartbeat follow-up completed.\nFinished the quiet heartbeat follow-up."
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat live status can be stopped from Telegram", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-live-stop-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  let resolveProgressSeen!: () => void;
  const progressSeen = new Promise<void>((resolve) => {
    resolveProgressSeen = resolve;
  });

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    agentResponder: async ({ text }, options) => {
      if (text === "continue") {
        await options?.onProgress?.({
          kind: "milestone",
          stage: "inspect",
          slot: "inspect",
          message: "Reviewing heartbeat follow-up work."
        });
        resolveProgressSeen();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve();
            return;
          }
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return "late heartbeat response";
      }
      return "Initial foreground reply.";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: live\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001", type: "group" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    const pending = runtime.getState().projects.default.heartbeat.pending;
    const heartbeatRun = runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));
    await progressSeen;

    const stopResult = await runtime.handleTelegramWebhook({
      message: {
        text: "/stop",
        chat: { id: "10001", type: "group" },
        from: { username: "alice" }
      }
    });
    await heartbeatRun;

    assert.equal(stopResult.ok, true);
    assert.equal(stopResult.action, "management_command");
    assert.deepEqual(sentTexts, [
      "Stopped the current task.\nSaved the latest progress so you can ask me to continue later."
    ]);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].includes("🟢 Reviewing heartbeat follow-up work."), true);
    assert.equal(runtime.getState().projects.default.heartbeat.pending?.agentId, "professor");
    const contents = readSessionContents(tempDir);
    assert.equal(contents.length, 4);
    assert.equal(contents[0], "Review the current TODOs");
    assert.equal(contents[1], "Initial foreground reply.");
    assert.equal(contents[2], "continue");
    assert.equal(
      contents[3].includes(
        `Previous attempt was stopped by the user with /stop using ${runtime.getActiveAgent().provider.name}/${runtime.getActiveAgent().provider.model}.`
      ),
      true
    );
    assert.equal(contents[3].includes("Last progress: Reviewing heartbeat follow-up work."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("heartbeat digest skips Telegram delivery when the paired chat is no longer valid", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-digest-missing-target-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) =>
      text === "continue"
        ? "Finished the follow-up work and updated TODO.md."
        : "Initial foreground reply."
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 15m\nnotify: digest\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "Review the current TODOs",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    sentTexts.length = 0;
    runtime.setupTelegram({
      chatId: "10002"
    });
    const pending = runtime.getState().projects.default.heartbeat.pending;
    await runtime.runHeartbeatTick(new Date(Date.parse(pending?.wakeAt ?? "") + 1_000));

    assert.deepEqual(sentTexts, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook keeps typing without creating a generic live status before real progress exists", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-typing-only-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  let typingCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async ({ text }) => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
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
        text: "Look into sparse autoencoders",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      formatTelegramAgentReply("professor", "research:Look into sparse autoencoders")
    ]);
    assert.deepEqual(statusCreates, []);
    assert.deepEqual(statusEdits, []);
    assert.equal(typingCalls > 0, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook keeps typing after live status appears", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-typing-with-status-"));
  let typingCalls = 0;
  const originalSetInterval = global.setInterval;

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    telegramStatusMessageCreator: async () => "status-1",
    telegramMessageEditor: async () => true,
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "milestone",
        stage: "inspect",
        slot: "inspect",
        message: "Reviewing the current implementation."
      });
      await new Promise((resolve) => setTimeout(resolve, 45));
      return `research:${text}`;
    }
  });

  try {
    global.setInterval = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) =>
      originalSetInterval(handler, 10, ...args)) as typeof setInterval;

    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Check the repo",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(typingCalls > 1, true);
  } finally {
    global.setInterval = originalSetInterval;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook renders one live status surface before the final answer without polluting conversation memory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-progress-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => true,
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
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
      formatTelegramAgentReply("professor", "research:Find recent breakthroughs in SAE methods")
    ]);
    assert.equal(statusCreates.length, 1);
    assert.equal(
      statusCreates[0].includes("🟢 Searching for candidate papers across 2 query waves."),
      true
    );
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(
      statusEdits[0].includes("⚪ Found 20 candidate papers. Selecting 6 for deep read."),
      true
    );
    assert.equal(
      statusEdits[0].includes("🟢 Summaries complete. Writing the final findings now."),
      true
    );
    assert.equal(statusEdits[0].startsWith("Finalizing"), true);

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

test("private chats stream recent activity through one persistent editable live status message", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-private-live-preview-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  let draftCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramDraftSender: async () => {
      draftCalls += 1;
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "progress",
        stage: "inspect",
        slot: "inspect:read:README.md",
        message: "Read README.md."
      });
      await options?.onProgress?.({
        kind: "progress",
        stage: "inspect",
        slot: "inspect:read:package.json",
        message: "Read package.json."
      });
      await options?.onProgress?.({
        kind: "completed",
        stage: "finalize",
        slot: "finalize",
        message: "Preparing the final answer."
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
        text: "show me the private live preview",
        chat: { id: "10001", type: "private" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      formatTelegramAgentReply("professor", "research:show me the private live preview")
    ]);
    assert.equal(draftCalls, 0);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].startsWith("Agent activity"), true);
    assert.equal(statusCreates[0].includes("🟢 Read README.md."), true);
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(statusEdits[0].startsWith("Finalizing"), true);
    assert.equal(statusEdits[0].includes("⚪ Read README.md."), true);
    assert.equal(statusEdits[0].includes("⚪ Read package.json."), true);
    assert.equal(statusEdits[0].includes("🟢 Preparing the final answer."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("group chats stream recent tool activity through one editable live status message", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-group-live-status-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  let draftCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramDraftSender: async () => {
      draftCalls += 1;
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "progress",
        stage: "inspect",
        slot: "inspect:read:README.md",
        message: "Read README.md."
      });
      await options?.onProgress?.({
        kind: "progress",
        stage: "search",
        slot: "search:sendMessageDraft",
        message: "Search the workspace for \"sendMessageDraft\"."
      });
      await options?.onProgress?.({
        kind: "progress",
        stage: "edit",
        slot: "edit:src/gateway.ts",
        message: "Edit src/gateway.ts."
      });
      await options?.onProgress?.({
        kind: "progress",
        stage: "run",
        slot: "run:pnpm test",
        message: "Run pnpm test."
      });
      await options?.onProgress?.({
        kind: "completed",
        stage: "finalize",
        slot: "finalize",
        message: "Preparing the final answer."
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
        text: "show me the live activity",
        chat: { id: "10001", type: "group" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      formatTelegramAgentReply("professor", "research:show me the live activity")
    ]);
    assert.equal(draftCalls, 0);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].startsWith("Agent activity"), true);
    assert.equal(statusCreates[0].includes("🟢 Read README.md."), true);
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(statusEdits[0].startsWith("Finalizing"), true);
    assert.equal(statusEdits[0].includes("⚪ Read README.md."), true);
    assert.equal(statusEdits[0].includes("⚪ Search the workspace for \"sendMessageDraft\"."), true);
    assert.equal(statusEdits[0].includes("⚪ Edit src/gateway.ts."), true);
    assert.equal(statusEdits[0].includes("⚪ Run pnpm test."), true);
    assert.equal(statusEdits[0].includes("🟢 Preparing the final answer."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("provider CLI native stream events are normalized into Telegram live status before the final response", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-stream-json-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
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
          "console.log(JSON.stringify({ type: 'system', subtype: 'init' }));",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { path: 'README.md' } }] } }));",
          "}, 100);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] } }));",
          "}, 200);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }));",
          "}, 250);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'result', result: 'paper search complete' }));",
          "}, 300);"
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
    assert.deepEqual(sentTexts, [formatTelegramAgentReply("professor", "paper search complete")]);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].includes("🟢 Read README.md."), true);
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(statusEdits[0].includes("⚪ Run pnpm test."), true);
    assert.equal(statusEdits[0].includes("🟢 Preparing the final answer."), true);
  } finally {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Codex item lifecycle events are normalized into user-facing Telegram activity", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-codex-stream-json-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  process.env.OPENAI_API_KEY = "test-openai-key";

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    }
  });

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.5",
      cliCommand: "node",
      cliArgs: [
        "-e",
        [
          "console.log(JSON.stringify({ type: 'thread.started' }));",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'turn.started' }));",
          "}, 50);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'cd /home/david/.opencolab/projects/default/parameter-golf-exp && git status', status: 'in_progress' } }));",
          "}, 100);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'item.started', item: { id: 'item_2', type: 'command_execution', command: 'git log --oneline -5', status: 'in_progress' } }));",
          "}, 200);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'item.started', item: { id: 'item_3', type: 'command_execution', command: 'git push', status: 'in_progress' } }));",
          "}, 300);",
          "setTimeout(() => {",
          "  console.log(JSON.stringify({ type: 'turn.completed', last_agent_message: 'parameter golf run synced' }));",
          "}, 400);"
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
        text: "sync the branch",
        chat: { id: "10001", type: "group" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [formatTelegramAgentReply("professor", "parameter golf run synced")]);
    assert.equal(statusCreates.length, 1);
    assert.equal(statusCreates[0].startsWith("Agent activity"), true);
    assert.equal(
      statusCreates[0].includes(
        "🟢 Run cd /home/david/.opencolab/projects/default/parameter-golf-exp && git status."
      ),
      true
    );
    assert.deepEqual(statusEdits.length, 1);
    assert.equal(statusEdits[0].startsWith("Finalizing"), true);
    assert.equal(statusEdits[0].includes("⚪ Run git log --oneline -5."), true);
    assert.equal(statusEdits[0].includes("⚪ Run git push."), true);
    assert.equal(statusEdits[0].includes("🟢 Preparing the final answer."), true);
    assert.equal(statusEdits[0].includes("item.started"), false);
    assert.equal(statusEdits[0].includes("turn.completed"), false);
  } finally {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook splits oversized Telegram final replies and preserves message threads", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-long-final-reply-"));
  const sentMessages: Array<{ text: string; messageThreadId?: string }> = [];
  const longReply = Array.from({ length: 140 }, (_, index) =>
    `Section ${String(index + 1).padStart(3, "0")}: ${"x".repeat(40)}`
  ).join("\n\n");

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text, _state, options) => {
      sentMessages.push({
        text,
        messageThreadId: options?.messageThreadId,
      });
      return true;
    },
    agentResponder: async () => longReply,
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001",
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentMessages.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "send the long answer",
        chat: { id: "10001", type: "group" },
        from: { username: "alice" },
        message_thread_id: 77,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(sentMessages.length > 1, true);
    assert.equal(sentMessages.every((message) => message.text.length <= 4_000), true);
    assert.equal(sentMessages.every((message) => message.messageThreadId === "77"), true);
    assert.equal(
      sentMessages.map((message) => message.text).join(""),
      formatTelegramAgentReply("professor", longReply)
    );
  } finally {
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
    assert.equal(
      second.response,
      formatTelegramAgentReply("professor", "resume:Continue from the last stage")
    );
    assert.deepEqual(seenWorkingMemory, [
      [],
      ["Investigate sparse autoencoders", recoveryTurn.content]
    ]);
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("timed out routed runs can arm heartbeat when the active agent enables it", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-timeout-"));
  const originalConsoleError = console.error;

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async () => {
      throw new Error("openai CLI timed out");
    }
  });

  try {
    console.error = () => undefined;
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 30m\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Investigate sparse autoencoders",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "agent_error");
    assert.equal(runtime.getState().projects.default.heartbeat.pending?.agentId, "professor");
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
    assert.equal(result.response, formatTelegramAgentReply("professor", "Image exists & re-sent."));
    assert.deepEqual(sentTexts, [formatTelegramAgentReply("professor", "Image exists & re-sent.")]);
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
    assert.equal(result.response, formatTelegramAgentReply("professor", "files:1 kind:document text:true"));
    assert.equal(
      sentTexts.includes(formatTelegramAgentReply("professor", "files:1 kind:document text:true")),
      true
    );
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
    assert.equal(result.response, formatTelegramAgentReply("professor", "photo received"));
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
    assert.equal(result.response, formatTelegramAgentReply("professor", "fallback metadata received"));
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
    assert.equal(result.response, formatTelegramAgentReply("professor", "Uploaded your file."));
    assert.equal(sentTexts.includes(formatTelegramAgentReply("professor", "Uploaded your file.")), true);
    assert.equal(sentFiles.length, 2);
    assert.deepEqual(sentFiles[0], { kind: "document", file: "doc_abc123", caption: "analysis" });
    assert.deepEqual(sentFiles[1], { kind: "photo", file: "https://example.com/chart.png" });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("default telegram file sender uploads local file URLs as multipart", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-url-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const reportPath = path.join(tempDir, "report.txt");
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
  fs.writeFileSync(reportPath, "report-body", "utf8");

  let requestUrl = "";

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body instanceof FormData, true);

    const form = init?.body as FormData;
    assert.equal(form.get("chat_id"), "10001");
    assert.equal(form.get("caption"), "report");

    const uploaded = form.get("document") as { name?: string; text?: () => Promise<string> } | null;
    assert.equal(uploaded?.name, "report.txt");
    assert.equal(await uploaded?.text?.(), "report-body");

    return new Response("{}", { status: 200 });
  };

  try {
    const sent = await defaultTelegramFileSender(
      "10001",
      {
        kind: "document",
        file: pathToFileURL(reportPath).href,
        caption: "report"
      },
      {} as OpenColabState
    );

    assert.equal(sent, true);
    assert.equal(requestUrl, "https://api.telegram.org/bottest_bot_token/sendDocument");
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

test("default telegram file sender uploads Windows absolute paths as multipart", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const windowsPath = "C:\\Users\\dev\\Documents\\report.txt";
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  t.mock.method(fs, "statSync", (candidate: fs.PathLike) => {
    assert.equal(String(candidate), windowsPath);
    return { isFile: () => true } as fs.Stats;
  });
  t.mock.method(fs, "readFileSync", (candidate: fs.PathOrFileDescriptor) => {
    assert.equal(String(candidate), windowsPath);
    return Buffer.from("windows-report");
  });

  let requestUrl = "";

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body instanceof FormData, true);

    const form = init?.body as FormData;
    assert.equal(form.get("chat_id"), "10001");
    assert.equal(form.get("caption"), "report");

    const uploaded = form.get("document") as { name?: string; text?: () => Promise<string> } | null;
    assert.equal(uploaded?.name, "report.txt");
    assert.equal(await uploaded?.text?.(), "windows-report");

    return new Response("{}", { status: 200 });
  };

  try {
    const sent = await defaultTelegramFileSender(
      "10001",
      {
        kind: "document",
        file: windowsPath,
        caption: "report"
      },
      {} as OpenColabState
    );

    assert.equal(sent, true);
    assert.equal(requestUrl, "https://api.telegram.org/bottest_bot_token/sendDocument");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  }
});

test("default telegram file sender keeps remote URLs as JSON references", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  let payload: Record<string, unknown> | null = null;

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.telegram.org/bottest_bot_token/sendPhoto");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body instanceof FormData, false);
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  try {
    const sent = await defaultTelegramFileSender(
      "10001",
      {
        kind: "photo",
        file: "https://example.com/chart.png",
        caption: "chart"
      },
      {} as OpenColabState
    );

    assert.equal(sent, true);
    assert.deepEqual(payload, {
      chat_id: "10001",
      photo: "https://example.com/chart.png",
      caption: "chart"
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
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

test("paired webhook returns a short no-op reply for /stop when no task is active", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-stop-noop-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
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

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "/stop",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "management_command");
    assert.equal(result.response, "No active task to stop.");
    assert.deepEqual(sentTexts, ["No active task to stop."]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can stop an active routed run, save a recovery summary, and suppress late replies", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-stop-active-"));
  const sentTexts: string[] = [];
  const statusCreates: string[] = [];
  const statusEdits: string[] = [];
  let resolveProgressSeen!: () => void;
  const progressSeen = new Promise<void>((resolve) => {
    resolveProgressSeen = resolve;
  });
  let releaseLateReply!: () => void;
  const lateReplyReleased = new Promise<void>((resolve) => {
    releaseLateReply = resolve;
  });

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramStatusMessageCreator: async (_chatId, text) => {
      statusCreates.push(text);
      return "status-1";
    },
    telegramMessageEditor: async (_chatId, _messageId, text) => {
      statusEdits.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "milestone",
        stage: "inspect",
        slot: "inspect",
        message: "Reviewing the current implementation."
      });
      resolveProgressSeen();

      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) {
          resolve();
          return;
        }

        options?.signal?.addEventListener(
          "abort",
          () => {
            void (async () => {
              await options?.onProgress?.({
                kind: "completed",
                stage: "finalize",
                slot: "finalize",
                message: "Should not appear after stop."
              });
              resolve();
            })();
          },
          { once: true }
        );
      });

      await lateReplyReleased;
      return `late:${text}`;
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

    const firstRun = runtime.handleTelegramWebhook({
      message: {
        text: "Investigate sparse autoencoders",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    await progressSeen;

    const stopResult = await runtime.handleTelegramWebhook({
      message: {
        text: "/stop",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });
    releaseLateReply();
    const firstResult = await firstRun;

    assert.equal(stopResult.ok, true);
    assert.equal(stopResult.action, "management_command");
    assert.equal(
      stopResult.response,
      "Stopped the current task.\nSaved the latest progress so you can ask me to continue later."
    );
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.action, "agent_stopped");
    assert.equal(firstResult.sent, false);
    assert.deepEqual(sentTexts, [
      "Stopped the current task.\nSaved the latest progress so you can ask me to continue later."
    ]);
    assert.equal(
      sentTexts.some((text) => text.includes("late:Investigate sparse autoencoders")),
      false
    );
    assert.equal(statusCreates.length, 1);
    assert.equal(
      statusCreates[0].includes("🟢 Reviewing the current implementation."),
      true
    );
    assert.equal(
      statusEdits.some((text) => text.includes("Should not appear after stop.")),
      false
    );

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
        `Previous attempt was stopped by the user with /stop using ${runtime.getActiveAgent().provider.name}/${runtime.getActiveAgent().provider.model}.`
      ),
      true
    );
    assert.equal(
      recoveryTurn.content.includes("Last progress: Reviewing the current implementation."),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stopped routed runs can arm heartbeat when the active agent enables it", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-heartbeat-stop-"));
  let resolveProgressSeen!: () => void;
  const progressSeen = new Promise<void>((resolve) => {
    resolveProgressSeen = resolve;
  });

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async (_input, options) => {
      await options?.onProgress?.({
        kind: "milestone",
        stage: "inspect",
        slot: "inspect",
        message: "Reviewing the current implementation."
      });
      resolveProgressSeen();

      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) {
          resolve();
          return;
        }
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });

      return "late";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });
    fs.writeFileSync(buildHeartbeatPath(tempDir, "default"), "after: 30m\n", "utf8");

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const firstRun = runtime.handleTelegramWebhook({
      message: {
        text: "Investigate sparse autoencoders",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    await progressSeen;

    const stopResult = await runtime.handleTelegramWebhook({
      message: {
        text: "/stop",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });
    const firstResult = await firstRun;

    assert.equal(stopResult.ok, true);
    assert.equal(firstResult.action, "agent_stopped");
    assert.equal(runtime.getState().projects.default.heartbeat.pending?.agentId, "professor");
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
      assert.equal(
        result.response,
        "Supported commands: /projects | /agents | /session_reset | /stop | /workflow_notifications on|off|status"
      );
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
