import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { getSetting, openDb, setSetting } from "../src/db.js";

test("settings are persisted in opencolab.db", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-settings-test-"));

  try {
    const config = loadConfig(tempDir);
    const db = openDb(config);
    try {
      setSetting(db, "telegram.bot_token", "token_abc123");
      setSetting(db, "opencolab.force_mock_cli", "0");

      assert.equal(getSetting(db, "telegram.bot_token"), "token_abc123");
      assert.equal(getSetting(db, "opencolab.force_mock_cli"), "0");
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
