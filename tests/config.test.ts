import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

test("loadConfig reads .env.local values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-config-test-"));
  const envPath = path.join(tempDir, ".env.local");

  fs.writeFileSync(
    envPath,
    ["OPENAI_API_KEY=test_key_123", "OPENCOLAB_PORT=5050", "OPENCOLAB_FORCE_MOCK_CLI=0"].join(
      "\n"
    ),
    "utf8"
  );

  const oldOpenAi = process.env.OPENAI_API_KEY;
  const oldPort = process.env.OPENCOLAB_PORT;
  const oldForceMock = process.env.OPENCOLAB_FORCE_MOCK_CLI;

  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENCOLAB_PORT;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;

  try {
    const config = loadConfig(tempDir);
    assert.equal(process.env.OPENAI_API_KEY, "test_key_123");
    assert.equal(config.localApiPort, 5050);
    assert.equal(config.forceMockCodex, false);
  } finally {
    if (oldOpenAi === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = oldOpenAi;
    }

    if (oldPort === undefined) {
      delete process.env.OPENCOLAB_PORT;
    } else {
      process.env.OPENCOLAB_PORT = oldPort;
    }

    if (oldForceMock === undefined) {
      delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    } else {
      process.env.OPENCOLAB_FORCE_MOCK_CLI = oldForceMock;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig defaults to real codex mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-config-default-"));
  const oldForceMock = process.env.OPENCOLAB_FORCE_MOCK_CLI;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;

  try {
    const config = loadConfig(tempDir);
    assert.equal(config.forceMockCodex, false);
  } finally {
    if (oldForceMock === undefined) {
      delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    } else {
      process.env.OPENCOLAB_FORCE_MOCK_CLI = oldForceMock;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
