import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

test("run lifecycle reaches waiting approval and completion", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-test-"));
  const runtime = createRuntime(tempDir);

  try {
    const { orchestrator } = runtime;
    orchestrator.createProject("paper-proj");

    const started = await orchestrator.startRun({
      projectName: "paper-proj",
      goal: "Summarize sparse autoencoder methods"
    });

    assert.equal(started.status, "waiting_approval");

    const status = orchestrator.getRunStatus(started.runId);
    assert.equal(status.run.status, "waiting_approval");
    assert.equal(status.tasks.length, 3);
    assert.ok(status.approval);
    assert.equal(status.approval?.status, "pending");

    const chats = orchestrator.listChats(started.runId);
    assert.equal(chats.length, 1);

    const meetings = orchestrator.listMeetings(started.runId);
    assert.equal(meetings.length, 3);

    orchestrator.approveRun(started.runId);

    const afterApproval = orchestrator.getRunStatus(started.runId);
    assert.equal(afterApproval.run.status, "completed");
  } finally {
    runtime.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("skill sync loads SKILLS directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-skill-test-"));

  try {
    const skillDir = path.join(tempDir, "SKILLS", "paper-search");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: paper-search\ndescription: Search and summarize papers\n---\n\nUse this skill for paper triage.\n`,
      "utf8"
    );

    const runtime = createRuntime(tempDir);
    try {
      const rows = runtime.orchestrator.syncSkills();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].skillName, "paper-search");
      assert.equal(rows[0].description, "Search and summarize papers");
    } finally {
      runtime.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("default agent context files exist for every agent workspace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-files-"));
  const runtime = createRuntime(tempDir);

  try {
    const required = ["SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "AGENTS.md"];
    const agentIds = [
      "professor_codex",
      "student_claude_1",
      "student_codex_1",
      "student_gemini_1"
    ];

    for (const agentId of agentIds) {
      const workspace = path.join(tempDir, "projects", "_default", "agents", agentId);
      for (const fileName of required) {
        const fullPath = path.join(workspace, fileName);
        assert.equal(fs.existsSync(fullPath), true, `${fullPath} should exist`);
      }
    }
  } finally {
    runtime.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram commands can target a run and apply run actions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-telegram-"));
  const oldChatId = process.env.TELEGRAM_CHAT_ID;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = "10001";

  const runtime = createRuntime(tempDir);
  try {
    const { orchestrator } = runtime;
    orchestrator.createProject("telegram-proj");

    const started = await orchestrator.startRun({
      projectName: "telegram-proj",
      goal: "Validate telegram command routing"
    });

    const runId = started.runId;

    const setRun = await orchestrator.handleTelegramWebhookMessage(
      "10001",
      "alice",
      `/run ${runId}`
    );
    assert.equal(setRun.ok, true);
    assert.equal(setRun.action, "run_set");

    const freeText = await orchestrator.handleTelegramWebhookMessage(
      "10001",
      "alice",
      "Please compare the latest outputs."
    );
    assert.equal(freeText.ok, true);
    assert.equal(freeText.action, "message_recorded");

    const status = await orchestrator.handleTelegramWebhookMessage("10001", "alice", "/status");
    assert.equal(status.ok, true);
    assert.equal(status.action, "status");
    assert.equal(status.response.includes(`Run ${runId}`), true);

    const approve = await orchestrator.handleTelegramWebhookMessage("10001", "alice", "/approve");
    assert.equal(approve.ok, true);
    assert.equal(approve.action, "approve");

    const runStatus = orchestrator.getRunStatus(runId);
    assert.equal(runStatus.run.status, "completed");

    const chats = orchestrator.listChats(runId);
    assert.equal(chats.length > 0, true);
    const messages = orchestrator.viewChat(chats[0].chatId);
    assert.equal(
      messages.some(
        (message) =>
          message.sender === "telegram:alice" &&
          message.content.includes("Please compare the latest outputs.")
      ),
      true
    );
  } finally {
    runtime.close();
    if (oldChatId === undefined) {
      delete process.env.TELEGRAM_CHAT_ID;
    } else {
      process.env.TELEGRAM_CHAT_ID = oldChatId;
    }
    if (oldBotToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = oldBotToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram webhook rejects unauthorized chat id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-telegram-auth-"));
  const oldChatId = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_CHAT_ID = "10001";

  const runtime = createRuntime(tempDir);
  try {
    const result = await runtime.orchestrator.handleTelegramWebhookMessage(
      "99999",
      "mallory",
      "/help"
    );
    assert.equal(result.ok, false);
    assert.equal(result.action, "unauthorized_chat");
  } finally {
    runtime.close();
    if (oldChatId === undefined) {
      delete process.env.TELEGRAM_CHAT_ID;
    } else {
      process.env.TELEGRAM_CHAT_ID = oldChatId;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
