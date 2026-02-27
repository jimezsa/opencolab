import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { openDb, setSetting } from "../src/db.js";
import {
  ensureProjectConfiguration,
  getProjectSetting,
  setProjectSetting
} from "../src/project-config.js";

test("project settings are persisted in opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-settings-test-"));

  try {
    const config = loadConfig(tempDir);
    const db = openDb(config);
    try {
      ensureProjectConfiguration(config, db);
      setProjectSetting(config, "telegram.bot_token", "token_abc123");
      setProjectSetting(config, "opencolab.force_mock_cli", "0");

      assert.equal(getProjectSetting(config, "telegram.bot_token"), "token_abc123");
      assert.equal(getProjectSetting(config, "opencolab.force_mock_cli"), "0");
      assert.equal(fs.existsSync(config.projectConfigPath), true);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project settings migrate from opencolab.db on first run", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-settings-migrate-test-"));

  try {
    const config = loadConfig(tempDir);
    const db = openDb(config);
    try {
      setSetting(db, "telegram.bot_token", "legacy_token");
      setSetting(db, "telegram.chat_id", "10001");
      setSetting(db, "opencolab.force_mock_cli", "0");

      const projectConfig = ensureProjectConfiguration(config, db);
      assert.equal(projectConfig.settings["telegram.bot_token"], "legacy_token");
      assert.equal(projectConfig.settings["telegram.chat_id"], "10001");
      assert.equal(projectConfig.settings["opencolab.force_mock_cli"], "0");
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
