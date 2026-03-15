import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAgentPromptForInput, ensureAgentFiles } from "../src/agent.js";
import { ConversationStore } from "../src/conversation.js";
import { createDefaultAgentConfig } from "../src/project-config.js";
import { createRuntime } from "../src/runtime.js";

test("conversation store builds memory from today's active session and yesterday summary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-memory-store-"));
  const store = new ConversationStore(tempDir);
  const agentPath = "projects/default/AGENTS/professor";

  try {
    const sessionRoot = path.join(tempDir, agentPath, "memory", "Session");
    const activeSessionId = "session-20260311-0002";
    const olderSessionId = "session-20260310-0001";
    fs.mkdirSync(path.join(sessionRoot, olderSessionId), { recursive: true });
    fs.mkdirSync(path.join(sessionRoot, activeSessionId), { recursive: true });
    fs.writeFileSync(path.join(sessionRoot, ".active-session"), `${activeSessionId}\n`, "utf8");

    const yesterday = "2026-03-10";
    const today = "2026-03-11";
    fs.writeFileSync(
      path.join(sessionRoot, olderSessionId, `${yesterday}.jsonl`),
      [
        JSON.stringify({ role: "user", content: "Need a plan for memory layers", at: `${yesterday}T09:00:00.000Z` }),
        JSON.stringify({ role: "assistant", content: "I'll propose short, mid, and long term memory.", at: `${yesterday}T09:01:00.000Z` }),
      ].join("\n") + "\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sessionRoot, activeSessionId, `${yesterday}.jsonl`),
      [
        JSON.stringify({ role: "user", content: "Keep it simple and only carry yesterday forward.", at: `${yesterday}T17:00:00.000Z` }),
        JSON.stringify({ role: "assistant", content: "Understood. I'll keep only the previous day summary.", at: `${yesterday}T17:01:00.000Z` }),
      ].join("\n") + "\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sessionRoot, activeSessionId, `${today}.jsonl`),
      [
        JSON.stringify({ role: "user", content: "turn-1", at: `${today}T09:00:00.000Z` }),
        JSON.stringify({ role: "assistant", content: "reply-1", at: `${today}T09:01:00.000Z` }),
        JSON.stringify({ role: "user", content: "turn-2", at: `${today}T09:02:00.000Z` }),
        JSON.stringify({ role: "assistant", content: "reply-2", at: `${today}T09:03:00.000Z` }),
        JSON.stringify({ role: "user", content: "turn-3", at: `${today}T09:04:00.000Z` }),
      ].join("\n") + "\n",
      "utf8"
    );

    const memory = store.readPromptMemory(agentPath, 4, new Date("2026-03-11T12:00:00.000Z"));
    assert.deepEqual(
      memory.workingMemory.map((entry) => entry.content),
      ["reply-1", "turn-2", "reply-2", "turn-3"]
    );
    assert.equal(memory.previousDaySummary.includes("# DAILY MEMORY - 2026-03-10"), true);
    assert.equal(memory.previousDaySummary.includes("Sessions covered: 2"), true);
    assert.equal(memory.previousDaySummary.includes("Keep it simple and only carry yesterday forward."), true);

    const dailySummaryPath = path.join(tempDir, agentPath, "memory", "Daily", "2026-03-10.md");
    assert.equal(fs.existsSync(dailySummaryPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent prompt excludes bootstrap scaffolding and includes structured memory sections", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-memory-prompt-"));
  const agent = createDefaultAgentConfig("default");

  try {
    ensureAgentFiles(tempDir, agent);
    const agentDir = path.join(tempDir, agent.path);
    fs.writeFileSync(path.join(agentDir, "BOOTSTRAP.md"), "# BOOTSTRAP\n\nBOOTSTRAP_SENTINEL\n", "utf8");
    fs.writeFileSync(path.join(agentDir, "MEMORY.md"), "# MEMORY\n\nUser prefers concise plans.\n", "utf8");
    fs.mkdirSync(path.join(agentDir, "SKILLS", "solo-mode"), { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "SKILLS", "solo-mode", "SKILL.md"),
      "# Solo Mode\n\nAgent-local workflow.\n",
      "utf8"
    );

    const prompt = buildAgentPromptForInput(
      tempDir,
      agent,
      {
        workingMemory: [
          { role: "user", content: "current-turn-1", at: "2026-03-11T10:00:00.000Z" },
          { role: "assistant", content: "current-reply-1", at: "2026-03-11T10:01:00.000Z" },
        ],
        previousDaySummary: "# DAILY MEMORY - 2026-03-10\n\n- User wanted simpler memory.\n"
      },
      "Implement the simple version."
    );

    assert.equal(prompt.includes("BOOTSTRAP_SENTINEL"), false);
    assert.equal(prompt.includes("[LONG_TERM_MEMORY]"), true);
    assert.equal(prompt.includes("User prefers concise plans."), true);
    assert.equal(prompt.includes("[SHARED_SKILLS]"), true);
    assert.equal(prompt.includes("[AGENT_LOCAL_SKILLS]"), true);
    assert.equal(prompt.includes("Available agent-local skills: solo-mode"), true);
    assert.equal(prompt.includes("[RECENT_EPISODIC_MEMORY]"), true);
    assert.equal(prompt.includes("User wanted simpler memory."), true);
    assert.equal(prompt.includes("Working memory (active session, current UTC day):"), true);
    assert.equal(prompt.includes("USER: current-turn-1"), true);
    assert.equal(prompt.includes("ASSISTANT: current-reply-1"), true);
    assert.equal(prompt.includes("This run may be delivered through Telegram."), true);
    assert.equal(prompt.includes('@telegram-progress {"phase":"<planning|searching|downloading|reading|summarizing|drafting|done|info>"'), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime passes structured working memory to the agent responder", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-memory-runtime-"));
  const seenWorkingMemorySizes: number[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ memory }) => {
      seenWorkingMemorySizes.push(memory.workingMemory.length);
      return `wm:${String(memory.workingMemory.length)} prev:${String(memory.previousDaySummary.length)}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const first = await runtime.handleTelegramWebhook({
      message: {
        text: "first message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });
    const second = await runtime.handleTelegramWebhook({
      message: {
        text: "second message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(first.response, "wm:0 prev:0");
    assert.equal(second.response, "wm:2 prev:0");
    assert.deepEqual(seenWorkingMemorySizes, [0, 2]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
