import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { readProjectState, updateProjectState } from "../src/project-config.js";

test("project state defaults to codex provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-default-"));

  try {
    const config = loadConfig(tempDir);
    const state = readProjectState(config);

    assert.equal(state.agent.id, "research_agent");
    assert.equal(state.agent.files.agents, "AGENTS.md");
    assert.equal(state.agent.files.identity, "IDENTITY.md");
    assert.equal(state.agent.files.soul, "SOUL.md");
    assert.equal(state.agent.files.tools, "TOOLS.md");
    assert.equal(state.agent.files.user, "USER.md");
    assert.equal(state.agent.files.memory, "MEMORY.md");

    assert.equal(state.provider.name, "codex");
    assert.equal(state.provider.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.equal(state.telegram.paired, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state normalizes supported provider name", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-provider-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        provider: {
          name: "claude_code"
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.provider.name, "claude_code");
    assert.equal(loaded.provider.apiKeyEnvVar, "ANTHROPIC_API_KEY");
    assert.equal(loaded.provider.cliCommand, "claude");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state persists updates in opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-persist-"));

  try {
    const config = loadConfig(tempDir);

    updateProjectState(config, (current) => ({
      ...current,
      provider: {
        ...current.provider,
        model: "gpt-5-research"
      },
      telegram: {
        ...current.telegram,
        chatId: "10001",
        paired: true,
        pairedAt: "2026-02-27T00:00:00.000Z"
      }
    }));

    const loaded = readProjectState(config);

    assert.equal(loaded.provider.model, "gpt-5-research");
    assert.equal(loaded.telegram.chatId, "10001");
    assert.equal(loaded.telegram.paired, true);
    assert.equal(fs.existsSync(config.projectConfigPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
