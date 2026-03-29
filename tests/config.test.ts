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
    [
      "OPENAI_API_KEY=test_key_123",
      "OPENCOLAB_PORT=5050",
      "OPENCOLAB_FORCE_MOCK_CLI=0",
      "OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS=1200000"
    ].join("\n"),
    "utf8"
  );

  const oldOpenAi = process.env.OPENAI_API_KEY;
  const oldPort = process.env.OPENCOLAB_PORT;
  const oldForceMock = process.env.OPENCOLAB_FORCE_MOCK_CLI;
  const oldProviderTimeout = process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;

  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENCOLAB_PORT;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
  delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;

  try {
    const config = loadConfig(tempDir);
    assert.equal(process.env.OPENAI_API_KEY, "test_key_123");
    assert.equal(config.localApiPort, 5050);
    assert.equal(config.forceMockCodex, false);
    assert.equal(config.providerCliTimeoutMs, 1200000);
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

    if (oldProviderTimeout === undefined) {
      delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
    } else {
      process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS = oldProviderTimeout;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig defaults to real codex mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-config-default-"));
  const oldForceMock = process.env.OPENCOLAB_FORCE_MOCK_CLI;
  const oldProviderTimeout = process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
  delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;

  try {
    const config = loadConfig(tempDir);
    assert.equal(config.forceMockCodex, false);
    assert.equal(config.providerCliTimeoutMs, 1800000);
  } finally {
    if (oldForceMock === undefined) {
      delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    } else {
      process.env.OPENCOLAB_FORCE_MOCK_CLI = oldForceMock;
    }

    if (oldProviderTimeout === undefined) {
      delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
    } else {
      process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS = oldProviderTimeout;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig ignores the legacy Codex timeout env var", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-config-ignore-legacy-timeout-"));
  const oldProviderTimeout = process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
  const oldLegacyTimeout = process.env.OPENCOLAB_CODEX_TIMEOUT_MS;

  delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
  process.env.OPENCOLAB_CODEX_TIMEOUT_MS = "900000";

  try {
    const config = loadConfig(tempDir);
    assert.equal(config.providerCliTimeoutMs, 1800000);
  } finally {
    if (oldProviderTimeout === undefined) {
      delete process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS;
    } else {
      process.env.OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS = oldProviderTimeout;
    }

    if (oldLegacyTimeout === undefined) {
      delete process.env.OPENCOLAB_CODEX_TIMEOUT_MS;
    } else {
      process.env.OPENCOLAB_CODEX_TIMEOUT_MS = oldLegacyTimeout;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig reads .env values when .env.local is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-config-env-file-"));
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, "ANTHROPIC_API_KEY=anthropic_test_key\n", "utf8");

  const oldAnthropic = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    loadConfig(tempDir);
    assert.equal(process.env.ANTHROPIC_API_KEY, "anthropic_test_key");
  } finally {
    if (oldAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = oldAnthropic;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
