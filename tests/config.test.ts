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
      "# local test env",
      "OPENAI_API_KEY=test_key_123",
      "OPENCOLAB_FORCE_MOCK_CLI=0",
      "TELEGRAM_CHAT_ID=10001"
    ].join("\n"),
    "utf8"
  );

  const oldOpenAi = process.env.OPENAI_API_KEY;
  const oldForceMock = process.env.OPENCOLAB_FORCE_MOCK_CLI;
  const oldChatId = process.env.TELEGRAM_CHAT_ID;

  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
  delete process.env.TELEGRAM_CHAT_ID;

  try {
    const config = loadConfig(tempDir);
    assert.equal(process.env.OPENAI_API_KEY, "test_key_123");
    assert.equal(config.forceMockCli, false);
    assert.equal(config.telegramChatId, "10001");
  } finally {
    if (oldOpenAi === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = oldOpenAi;
    }

    if (oldForceMock === undefined) {
      delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    } else {
      process.env.OPENCOLAB_FORCE_MOCK_CLI = oldForceMock;
    }

    if (oldChatId === undefined) {
      delete process.env.TELEGRAM_CHAT_ID;
    } else {
      process.env.TELEGRAM_CHAT_ID = oldChatId;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
