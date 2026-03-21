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
