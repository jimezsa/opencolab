import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRuntime } from "../src/runtime.js";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "dist", "src", "cli.js");

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

test("upgrade help describes the main-branch upgrade flow", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-upgrade-help-"));

  try {
    const result = runCli(tempDir, ["upgrade", "--help"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes("Upgrade the current install to the latest origin/main"),
      true,
    );
    assert.equal(
      result.stdout.includes("Always switches the install to branch main and fast-forwards to origin/main."),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
