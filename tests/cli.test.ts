import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRuntime } from "../src/runtime.js";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "dist", "src", "cli.js");
const PACKAGE_VERSION = (() => {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof parsed.version === "string" && parsed.version.trim()
    ? parsed.version.trim()
    : "unknown";
})();

function runCli(rootDir: string, args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      OPENCOLAB_ROOT: rootDir
    },
    encoding: "utf8"
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

test("setup api-key saves one provider key without changing the active agent runtime", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-api-key-"));
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const initialRuntime = createRuntime(tempDir);
    initialRuntime.init();
    const initialAgent = initialRuntime.getActiveAgent();

    const result = runCli(tempDir, [
      "setup",
      "api-key",
      "--provider",
      "gemini",
      "--api-key",
      "gemini_cli_test_key"
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes("Provider API key saved."), true);
    assert.equal(result.stdout.includes("Provider: gemini"), true);
    assert.equal(result.stdout.includes("Env var: GEMINI_API_KEY"), true);

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("GEMINI_API_KEY=gemini_cli_test_key"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const reloadedAgent = reloadedRuntime.getActiveAgent();
    assert.equal(reloadedAgent.provider.name, initialAgent.provider.name);
    assert.equal(reloadedAgent.provider.model, initialAgent.provider.model);
    assert.equal(reloadedAgent.provider.authMode, initialAgent.provider.authMode);
  } finally {
    if (previousGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setup model stores native reasoning effort for supported models", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-setup-model-effort-"));

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const result = runCli(tempDir, [
      "setup",
      "model",
      "--provider",
      "openai",
      "--auth",
      "oauth",
      "--model",
      "gpt-5.4",
      "--reasoning-effort",
      "xhigh"
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes("Provider configured: openai"), true);
    assert.equal(result.stdout.includes("Model: gpt-5.4"), true);
    assert.equal(result.stdout.includes("Auth mode: oauth"), true);
    assert.equal(result.stdout.includes("Reasoning effort: xhigh"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const reloadedAgent = reloadedRuntime.getActiveAgent();
    assert.equal(reloadedAgent.provider.name, "openai");
    assert.equal(reloadedAgent.provider.authMode, "oauth");
    assert.equal(reloadedAgent.provider.reasoningEffort, "xhigh");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bare CLI help shows the installed version immediately", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-version-help-"));

  try {
    const result = runCli(tempDir, []);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(`OpenColab v${PACKAGE_VERSION}`), true);
    assert.equal(result.stdout.includes("multi-agent research lab"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--version prints the installed CLI version", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-version-flag-"));

  try {
    const result = runCli(tempDir, ["--version"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `opencolab ${PACKAGE_VERSION}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("version command prints the installed CLI version", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-version-command-"));

  try {
    const result = runCli(tempDir, ["version"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `opencolab ${PACKAGE_VERSION}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server add stores a Runpod target and gpu server list shows it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-gpu-server-"));

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const addResult = runCli(tempDir, [
      "gpu",
      "server",
      "add",
      "--provider",
      "runpod",
      "--server-id",
      "runpod-a100",
      "--datacenter-id",
      "US-KS-2",
      "--gpu-type",
      "NVIDIA A100 80GB PCIe",
      "--gpu-count",
      "1",
      "--volume-name",
      "default-runpod-a100",
      "--volume-size-gb",
      "200"
    ]);

    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
    assert.equal(addResult.stdout.includes("GPU server configured: runpod-a100"), true);
    assert.equal(addResult.stdout.includes("Provider: runpod"), true);

    const listResult = runCli(tempDir, ["gpu", "server", "list"]);
    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
    assert.equal(listResult.stdout.includes("runpod-a100 [runpod] 1x NVIDIA A100 80GB PCIe @ US-KS-2"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const target = reloadedRuntime.getExecutionTarget("runpod-a100");
    assert.equal(target.volume.name, "default-runpod-a100");
    assert.equal(target.volume.sizeGb, 200);
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2"]);
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server add accepts ordered location and GPU candidates", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-gpu-server-candidates-"));

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const addResult = runCli(tempDir, [
      "gpu",
      "server",
      "add",
      "--provider",
      "runpod",
      "--server-id",
      "runpod-flex",
      "--location",
      "US-KS-2,CA-MTL-1",
      "--gpu-type",
      "NVIDIA A100 80GB PCIe,NVIDIA RTX 4090",
      "--gpu-count",
      "1"
    ]);

    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
    assert.equal(addResult.stdout.includes("GPU candidates: NVIDIA A100 80GB PCIe, NVIDIA RTX 4090"), true);
    assert.equal(addResult.stdout.includes("Location candidates: US-KS-2, CA-MTL-1"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const target = reloadedRuntime.getExecutionTarget("runpod-flex");
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2", "CA-MTL-1"]);
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server help describes the availability command", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-gpu-server-help-"));

  try {
    const result = runCli(tempDir, ["gpu", "server", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes("opencolab gpu server availability --server-id <id>"),
      true
    );
    assert.equal(
      result.stdout.includes("Check live Runpod datacenter and GPU availability for one target"),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu job help describes the exec command", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-gpu-job-help-"));

  try {
    const result = runCli(tempDir, ["gpu", "job", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes("opencolab gpu job exec --run-id <id> --command <command>"),
      true
    );
    assert.equal(
      result.stdout.includes("Run one bounded remote command over the launched Pod SSH path"),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("upgrade help describes git and packaged install flows", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-upgrade-help-"));

  try {
    const result = runCli(tempDir, ["upgrade", "--help"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes("Upgrade an installer-managed OpenColab or a git/source checkout"),
      true,
    );
    assert.equal(
      result.stdout.includes("Git/source installs switch to branch main and fast-forward to origin/main."),
      true,
    );
    assert.equal(
      result.stdout.includes("One-link installer installs upgrade the managed package or managed clone behind the shim."),
      true,
    );
    assert.equal(
      result.stdout.includes("Generic package installs without installer metadata print package-manager upgrade guidance instead."),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
