import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIgnite } from "../src/ignite.js";
import { createRuntime } from "../src/runtime.js";

const ESC_INPUT = "\u001b";

test("ignite configures project, provider, telegram, and optional agent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-"));
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "science",
    "codex",
    "gpt-5.3-codex",
    "OPENAI_API_KEY",
    "codex",
    "exec,-",
    "y",
    "TELEGRAM_BOT_TOKEN",
    "10001",
    "n",
    "y",
    "scout",
    ""
  ];
  const prompts: string[] = [];
  const outputs: string[] = [];
  let syncCalls = 0;

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: (line) => {
          outputs.push(line);
        }
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        }
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");
    assert.equal(syncCalls, 1);

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "science");
    assert.equal(project.provider.name, "codex");
    assert.equal(project.provider.model, "gpt-5.3-codex");
    assert.equal(project.provider.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.equal(project.provider.cliCommand, "codex");
    assert.deepEqual(project.provider.cliArgs, ["exec", "-"]);

    assert.equal(state.telegram.botTokenEnvVar, "TELEGRAM_BOT_TOKEN");
    assert.equal(state.telegram.chatId, "10001");
    assert.equal(state.telegram.paired, false);

    assert.equal(agent.id, "scout");
    assert.equal(agent.path, "projects/science/subagents/scout");

    assert.equal(prompts.length > 0, true);
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite lets Esc skip a step and continue", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-esc-"));
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    ESC_INPUT,
    "codex",
    "gpt-5.3-codex",
    "OPENAI_API_KEY",
    "codex",
    "exec,-",
    ESC_INPUT,
    "n"
  ];
  const outputs: string[] = [];
  let syncCalls = 0;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        }
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        }
      }
    );

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "default");
    assert.equal(project.provider.name, "codex");
    assert.equal(project.provider.model, "gpt-5.3-codex");
    assert.equal(project.provider.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.equal(state.telegram.chatId, null);
    assert.equal(agent.id, "researcher_agent");
    assert.equal(syncCalls, 0);
    assert.equal(outputs.some((line) => line.trim() === "Step skipped."), true);
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
