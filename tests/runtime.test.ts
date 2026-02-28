import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

test("init creates required agent context files for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-files-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    const agentDir = path.join(tempDir, agent.path);

    assert.equal(project.id, "default");
    assert.equal(agent.id, "researcher_agent");
    assert.equal(agent.path, "projects/default");

    const required = ["AGENTS.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md"];
    for (const file of required) {
      assert.equal(fs.existsSync(path.join(agentDir, file)), true, `${file} should exist`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel supports claude_code provider defaults for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-runtime-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "claude_code",
      model: "claude-sonnet-4-5",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      cliCommand: "claude",
      cliArgs: ["-p", "{prompt}", "--model", "{model}"]
    });

    const project = runtime.getActiveProject();
    assert.equal(project.provider.name, "claude_code");
    assert.equal(project.provider.apiKeyEnvVar, "ANTHROPIC_API_KEY");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pairing start sends code and complete validates it for active project", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-pairing-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    assert.equal(pairing.sent, true);
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].includes(pairing.code), true);

    assert.throws(() => runtime.completePairing("999999"), /Invalid pairing code/);

    const completed = runtime.completePairing(pairing.code);
    assert.equal(typeof completed.pairedAt, "string");
    assert.equal(runtime.getState().telegram.paired, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("webhook rejects unauthorized chat id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-auth-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      chatId: "10001"
    });

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "hello",
        chat: { id: "99999" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "unauthorized_chat");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes message to the active agent and stores conversation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-route-"));
  const sentTexts: string[] = [];
  let typingCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Find recent breakthroughs in SAE methods",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "research:Find recent breakthroughs in SAE methods");
    assert.equal(sentTexts.includes(result.response), true);
    assert.equal(typingCalls > 0, true);

    const historyPath = path.join(tempDir, ".opencolab", "conversations", "default__10001.jsonl");
    assert.equal(fs.existsSync(historyPath), true);
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can create and switch projects and agents", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-manage-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const createProject = await runtime.handleTelegramWebhook({
      message: {
        text: "/project create alpha",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createProject.ok, true);
    assert.equal(createProject.action, "management_command");
    assert.equal(runtime.getState().activeProjectId, "alpha");
    assert.equal(runtime.getActiveProject().activeAgentId, "researcher_agent");

    const projectRootAgentFile = path.join(tempDir, "projects", "alpha", "AGENTS.md");
    assert.equal(fs.existsSync(projectRootAgentFile), true);

    const createAgent = await runtime.handleTelegramWebhook({
      message: {
        text: "/agent create scout",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createAgent.ok, true);
    assert.equal(createAgent.action, "management_command");
    assert.equal(runtime.getActiveProject().activeAgentId, "scout");

    const createdAgentDir = path.join(tempDir, "projects", "alpha", "subagents", "scout");
    assert.equal(fs.existsSync(path.join(createdAgentDir, "AGENTS.md")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
