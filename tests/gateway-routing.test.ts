/**
 * Bot-scoped Telegram routing.
 * Covers the guarantee this feature exists for: a message to a bot reaches that bot's
 * project and agent, and never touches the globally active project or another chat.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime, type OpenColabRuntime } from "../src/runtime.js";

interface SentMessage {
  chatId: string;
  text: string;
}

interface Harness {
  tempDir: string;
  runtime: OpenColabRuntime;
  sent: SentMessage[];
  respondedAs: string[];
  release?: () => void;
}

const ALPHA_CHAT = "1000001";
const BETA_CHAT = "2000002";

function agentReply(agentId: string, text: string): string {
  return `${agentId}\n\n${text}`;
}

/**
 * Two projects, each with its own paired bot:
 *   alpha_bot -> project alpha (agents: professor, scout)
 *   beta_bot  -> project beta  (agents: professor)
 * The globally active project is left as `beta` so any routing that still consults
 * global state would answer from the wrong project.
 */
async function createHarness(
  label: string,
  options: {
    respond?: (input: { text: string }) => Promise<string>;
  } = {},
): Promise<Harness> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `opencolab-routing-${label}-`));
  const sent: SentMessage[] = [];
  const respondedAs: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (chatId, text) => {
      sent.push({ chatId, text });
      return true;
    },
    telegramTypingSender: async () => true,
    telegramStatusMessageCreator: async () => "1",
    telegramMessageEditor: async () => true,
    telegramIdentityFetcher: async (token) => ({
      telegramBotId: `tg-${token}`,
      username: `${token}_handle`,
    }),
    agentResponder: options.respond
      ? async (input) => options.respond!(input)
      : async (input) => `echo:${input.text}`,
  });

  runtime.init();
  runtime.createProject("alpha");
  // configureAgent also selects the new agent, so put alpha's default back to professor.
  runtime.configureAgent("scout");
  runtime.useAgent("professor");
  runtime.createProject("beta");

  await runtime.addTelegramBot({
    token: "alpha_bot",
    botId: "alpha_bot",
    projectId: "alpha",
    chatId: ALPHA_CHAT,
  });
  await runtime.addTelegramBot({
    token: "beta_bot",
    botId: "beta_bot",
    projectId: "beta",
    chatId: BETA_CHAT,
  });
  runtime.markTelegramPaired(ALPHA_CHAT, "alpha_bot");
  runtime.markTelegramPaired(BETA_CHAT, "beta_bot");

  // Deliberately point global state at beta; alpha routing must ignore it.
  runtime.useProject("beta");

  return { tempDir, runtime, sent, respondedAs };
}

function message(chatId: string, text: string): unknown {
  return {
    message: {
      text,
      chat: { id: chatId, type: "private" },
      from: { username: "alice" },
    },
  };
}

function sessionDirFor(tempDir: string, projectId: string, agentId: string): string {
  return path.join(
    tempDir,
    "projects",
    projectId,
    "AGENTS",
    agentId,
    "memory",
    "Session",
  );
}

/** Session folders only; the store also keeps a pointer file alongside them. */
function listSessionFolders(tempDir: string, projectId: string, agentId: string): string[] {
  const sessionsDir = sessionDirFor(tempDir, projectId, agentId);
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }
  return fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function readSessionText(tempDir: string, projectId: string, agentId: string): string {
  const sessionsDir = sessionDirFor(tempDir, projectId, agentId);
  if (!fs.existsSync(sessionsDir)) {
    return "";
  }
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        chunks.push(fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(sessionsDir);
  return chunks.join("\n");
}

test("each bot routes to its own project regardless of the active project", async () => {
  const h = await createHarness("basic");

  try {
    assert.equal(h.runtime.getState().activeProjectId, "beta");

    const alpha = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "alpha question"),
      { botId: "alpha_bot" },
    );
    assert.equal(alpha.ok, true);
    assert.equal(alpha.action, "agent_response");

    const beta = await h.runtime.handleTelegramWebhook(
      message(BETA_CHAT, "beta question"),
      { botId: "beta_bot" },
    );
    assert.equal(beta.ok, true);
    assert.equal(beta.action, "agent_response");

    // Conversation memory proves which agent actually ran.
    assert.equal(readSessionText(h.tempDir, "alpha", "professor").includes("alpha question"), true);
    assert.equal(readSessionText(h.tempDir, "beta", "professor").includes("beta question"), true);
    assert.equal(readSessionText(h.tempDir, "alpha", "professor").includes("beta question"), false);
    assert.equal(readSessionText(h.tempDir, "beta", "professor").includes("alpha question"), false);

    // Routing never moves global state.
    assert.equal(h.runtime.getState().activeProjectId, "beta");
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("replies, and nothing else, land in the originating chat", async () => {
  const h = await createHarness("isolation");

  try {
    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "only alpha"), {
      botId: "alpha_bot",
    });

    assert.equal(h.sent.length > 0, true);
    assert.equal(
      h.sent.every((entry) => entry.chatId === ALPHA_CHAT),
      true,
      "no message may leak into another bot's chat",
    );
    assert.equal(
      h.sent.some((entry) => entry.text === agentReply("professor", "echo:only alpha")),
      true,
    );
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a bot only accepts its own paired chat", async () => {
  const h = await createHarness("auth");

  try {
    // Alpha's chat id presented to beta's bot must be refused.
    const crossed = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "wrong door"),
      { botId: "beta_bot" },
    );
    assert.equal(crossed.ok, false);
    assert.equal(crossed.action, "unauthorized_chat");
    assert.equal(crossed.sent, false);
    assert.equal(h.sent.length, 0);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("unknown, disabled, and token-less bots are refused without any Telegram call", async () => {
  const h = await createHarness("refusals");

  try {
    const unknown = await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "hi"), {
      botId: "nope",
    });
    assert.equal(unknown.action, "unknown_bot");
    assert.equal(unknown.sent, false);

    h.runtime.setTelegramBotEnabled("alpha_bot", false);
    const disabled = await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "hi"), {
      botId: "alpha_bot",
    });
    assert.equal(disabled.action, "unknown_bot");
    h.runtime.setTelegramBotEnabled("alpha_bot", true);

    const tokenEnvVar = h.runtime.getTelegramBotSummary("alpha_bot").tokenEnvVar;
    const saved = process.env[tokenEnvVar];
    delete process.env[tokenEnvVar];
    try {
      const noToken = await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "hi"), {
        botId: "alpha_bot",
      });
      assert.equal(noToken.action, "token_missing");
      assert.equal(noToken.response.includes(tokenEnvVar), true);
      // Critically: it does not borrow beta's token and answer anyway.
      assert.equal(noToken.sent, false);
    } finally {
      if (saved !== undefined) {
        process.env[tokenEnvVar] = saved;
      }
    }

    assert.equal(h.sent.length, 0);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("/agents switches only the asking chat's target agent", async () => {
  const h = await createHarness("agents");

  try {
    const picker = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/agents"),
      { botId: "alpha_bot" },
    );
    assert.equal(picker.action, "management_command");
    assert.equal(picker.response.includes("Agents in alpha"), true);
    assert.equal(picker.response.includes("scout"), true);

    const chosen = await h.runtime.handleTelegramWebhook(
      {
        callback_query: {
          id: "cb1",
          data: "agt:use:scout",
          message: { message_id: 5, chat: { id: ALPHA_CHAT, type: "private" } },
          from: { username: "alice" },
        },
      },
      { botId: "alpha_bot" },
    );
    assert.equal(chosen.action, "management_command");
    assert.equal(chosen.response.includes("scout"), true);

    // Only this bot's target moved.
    assert.equal(h.runtime.getTelegramBotSummary("alpha_bot").agentId, "scout");
    assert.equal(h.runtime.getTelegramBotSummary("beta_bot").agentId, null);
    // The project's own active agent is untouched, so the CLI and web UI are unaffected.
    assert.equal(h.runtime.getState().projects.alpha.activeAgentId, "professor");
    assert.equal(h.runtime.getState().activeProjectId, "beta");

    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "now you"), {
      botId: "alpha_bot",
    });
    assert.equal(readSessionText(h.tempDir, "alpha", "scout").includes("now you"), true);
    assert.equal(
      readSessionText(h.tempDir, "alpha", "professor").includes("now you"),
      false,
    );
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("/projects in a pinned chat reports the binding and changes nothing", async () => {
  const h = await createHarness("projects-inert");

  try {
    const before = JSON.stringify(h.runtime.getState());
    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/projects"),
      { botId: "alpha_bot" },
    );

    assert.equal(result.action, "management_command");
    assert.equal(result.response.includes("bound to project 'alpha'"), true);
    assert.equal(result.response.includes("/agents"), true);
    assert.equal(JSON.stringify(h.runtime.getState()), before);

    // Even a forged project callback cannot move a pinned chat.
    const forged = await h.runtime.handleTelegramWebhook(
      {
        callback_query: {
          id: "cb2",
          data: "prj:use:beta",
          message: { message_id: 6, chat: { id: ALPHA_CHAT, type: "private" } },
          from: { username: "alice" },
        },
      },
      { botId: "alpha_bot" },
    );
    assert.equal(forged.response.includes("bound to project 'alpha'"), true);
    assert.equal(h.runtime.getState().activeProjectId, "beta");
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("/whoami names the chat's project and agent", async () => {
  const h = await createHarness("whoami");

  try {
    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/whoami"),
      { botId: "alpha_bot" },
    );
    assert.equal(result.response.includes("Bot: @alpha_bot_handle (alpha_bot)"), true);
    assert.equal(result.response.includes("Mode: pinned"), true);
    assert.equal(result.response.includes("Project: alpha"), true);
    assert.equal(result.response.includes("Agent: professor"), true);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("/session_reset resets the resolved agent, not the globally active one", async () => {
  const h = await createHarness("session-reset");

  try {
    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "first"), {
      botId: "alpha_bot",
    });
    assert.equal(listSessionFolders(h.tempDir, "alpha", "professor").length, 1);

    const reset = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/session_reset"),
      { botId: "alpha_bot" },
    );
    assert.equal(reset.response.includes("Session reset for professor (project alpha)"), true);

    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "second"), {
      botId: "alpha_bot",
    });
    assert.equal(listSessionFolders(h.tempDir, "alpha", "professor").length, 2);
    // beta's agent was never touched.
    assert.equal(fs.existsSync(sessionDirFor(h.tempDir, "beta", "professor")), false);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a bot bound to a deleted project explains itself instead of answering", async () => {
  const h = await createHarness("orphan");

  try {
    // Simulate the project disappearing from under the binding.
    const state = h.runtime.getState();
    const nextProjects = { ...state.projects };
    delete nextProjects.alpha;
    fs.writeFileSync(
      path.join(h.tempDir, "opencolab.json"),
      JSON.stringify({ ...state, activeProjectId: "beta", projects: nextProjects }, null, 2),
      "utf8",
    );

    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "still there?"),
      { botId: "alpha_bot" },
    );

    // Normalization disables an orphaned binding, so the bot stops responding entirely
    // rather than silently answering from whatever project happens to be active.
    assert.equal(result.ok, false);
    assert.equal(result.action, "unknown_bot");
    assert.equal(
      readSessionText(h.tempDir, "beta", "professor").includes("still there?"),
      false,
    );
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a pinned agent that was deleted falls back for one turn and says so", async () => {
  const h = await createHarness("agent-fallback");

  try {
    h.runtime.bindTelegramBot("alpha_bot", { projectId: "alpha", agentId: "scout" });
    assert.equal(h.runtime.getTelegramBotSummary("alpha_bot").agentId, "scout");

    // Drop the pinned agent directly on disk, as another process might.
    const state = h.runtime.getState();
    const alpha = state.projects.alpha;
    const agents = { ...alpha.agents };
    delete agents.scout;
    fs.writeFileSync(
      path.join(h.tempDir, "opencolab.json"),
      JSON.stringify(
        {
          ...state,
          projects: {
            ...state.projects,
            alpha: { ...alpha, activeAgentId: "professor", agents },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "carry on"),
      { botId: "alpha_bot" },
    );
    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(
      readSessionText(h.tempDir, "alpha", "professor").includes("carry on"),
      true,
    );
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("two bots run turns concurrently while one agent serializes its own turns", async () => {
  const gates = new Map<string, () => void>();
  const started: string[] = [];
  const finished: string[] = [];

  const h = await createHarness("concurrency", {
    respond: async (input) => {
      started.push(input.text);
      await new Promise<void>((resolve) => {
        gates.set(input.text, resolve);
      });
      finished.push(input.text);
      return `done:${input.text}`;
    },
  });

  const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timed out waiting for condition");
  };

  try {
    const alphaTurn = h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "A1"), {
      botId: "alpha_bot",
    });
    const betaTurn = h.runtime.handleTelegramWebhook(message(BETA_CHAT, "B1"), {
      botId: "beta_bot",
    });

    // Different projects, different agents: both get to run at once.
    await waitFor(() => started.length === 2);
    assert.deepEqual([...started].sort(), ["A1", "B1"]);

    // A second turn for alpha's agent must wait for the first to finish.
    const alphaSecond = h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "A2"), {
      botId: "alpha_bot",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(started.includes("A2"), false, "same agent must not run twice at once");

    gates.get("A1")?.();
    gates.get("B1")?.();
    await alphaTurn;
    await betaTurn;

    await waitFor(() => started.includes("A2"));
    gates.get("A2")?.();
    await alphaSecond;

    assert.deepEqual(finished.slice(0, 1).length, 1);
    assert.equal(finished.includes("A2"), true);
  } finally {
    for (const release of gates.values()) {
      release();
    }
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("/stop cancels only the asking bot's in-flight run", async () => {
  const gates = new Map<string, () => void>();
  const started: string[] = [];

  const h = await createHarness("stop", {
    respond: async (input) => {
      started.push(input.text);
      await new Promise<void>((resolve) => {
        gates.set(input.text, resolve);
      });
      return `done:${input.text}`;
    },
  });

  const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timed out waiting for condition");
  };

  try {
    const alphaTurn = h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "A-long"), {
      botId: "alpha_bot",
    });
    const betaTurn = h.runtime.handleTelegramWebhook(message(BETA_CHAT, "B-long"), {
      botId: "beta_bot",
    });
    await waitFor(() => started.length === 2);

    const stopped = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/stop"),
      { botId: "alpha_bot" },
    );
    assert.equal(stopped.action, "management_command");
    assert.equal(stopped.response.includes("Stopped the current task."), true);

    gates.get("A-long")?.();
    const alphaResult = await alphaTurn;
    assert.equal(alphaResult.action, "agent_stopped");

    // Beta's run was never touched.
    gates.get("B-long")?.();
    const betaResult = await betaTurn;
    assert.equal(betaResult.action, "agent_response");
    assert.equal(
      h.sent.some(
        (entry) =>
          entry.chatId === BETA_CHAT && entry.text.includes("done:B-long"),
      ),
      true,
    );
  } finally {
    for (const release of gates.values()) {
      release();
    }
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("one project owns at most one enabled bot", async () => {
  const h = await createHarness("conflict");

  try {
    await assert.rejects(
      () =>
        h.runtime.addTelegramBot({
          token: "second_alpha",
          botId: "alpha_two",
          projectId: "alpha",
        }),
      /already bound to Telegram bot 'alpha_bot'/,
    );

    assert.throws(
      () => h.runtime.bindTelegramBot("beta_bot", { projectId: "alpha" }),
      /already bound to Telegram bot 'alpha_bot'/,
    );

    // The rejected bind left no trace.
    assert.equal(h.runtime.getTelegramBotSummary("beta_bot").projectId, "beta");
    assert.deepEqual(
      h.runtime.listTelegramBotSummaries().map((bot) => bot.id),
      ["alpha_bot", "beta_bot"],
    );
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a rejected token binds nothing and writes no secret", async () => {
  const h = await createHarness("bad-token");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-routing-bad-token-"));

  try {
    const runtime = createRuntime(tempDir, {
      telegramIdentityFetcher: async () => null,
    });
    runtime.init();

    await assert.rejects(
      () => runtime.addTelegramBot({ token: "123:bogus", botId: "ghost" }),
      /Telegram rejected that token/,
    );

    assert.deepEqual(runtime.listTelegramBotSummaries(), []);
    const envPath = path.join(tempDir, ".env.local");
    const envLocal = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    assert.equal(envLocal.includes("123:bogus"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("opencolab.json never stores a bot token", async () => {
  const h = await createHarness("no-secrets");

  try {
    const raw = fs.readFileSync(path.join(h.tempDir, "opencolab.json"), "utf8");
    assert.equal(raw.includes("alpha_bot"), true, "fixture sanity: the bot is persisted");
    const parsed = JSON.parse(raw) as {
      telegramBots: Record<string, { tokenEnvVar: string }>;
    };
    for (const bot of Object.values(parsed.telegramBots)) {
      assert.equal(bot.tokenEnvVar.startsWith("TELEGRAM_BOT_TOKEN"), true);
      assert.equal(/^\d+:/.test(bot.tokenEnvVar), false);
    }
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("removing a bot leaves the other one fully working", async () => {
  const h = await createHarness("remove");

  try {
    const removed = h.runtime.removeTelegramBot("beta_bot");
    assert.equal(removed.botId, "beta_bot");
    assert.equal(removed.tokenRemoved, true);
    assert.equal(process.env[removed.tokenEnvVar], undefined);

    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "still here"),
      { botId: "alpha_bot" },
    );
    assert.equal(result.action, "agent_response");

    const gone = await h.runtime.handleTelegramWebhook(message(BETA_CHAT, "hello?"), {
      botId: "beta_bot",
    });
    assert.equal(gone.action, "unknown_bot");
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("pollable bots exclude disabled and token-less profiles", async () => {
  const h = await createHarness("pollable");

  try {
    assert.deepEqual(
      h.runtime.listTelegramPollableBots().map((bot) => bot.botId).sort(),
      ["alpha_bot", "beta_bot"],
    );

    h.runtime.setTelegramBotEnabled("beta_bot", false);
    assert.deepEqual(
      h.runtime.listTelegramPollableBots().map((bot) => bot.botId),
      ["alpha_bot"],
    );

    const tokenEnvVar = h.runtime.getTelegramBotSummary("alpha_bot").tokenEnvVar;
    const saved = process.env[tokenEnvVar];
    delete process.env[tokenEnvVar];
    try {
      assert.deepEqual(h.runtime.listTelegramPollableBots(), []);
    } finally {
      if (saved !== undefined) {
        process.env[tokenEnvVar] = saved;
      }
    }
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a floating bot keeps the legacy behavior of following the active project", async () => {
  const h = await createHarness("floating");

  try {
    h.runtime.unbindTelegramBot("alpha_bot");
    assert.equal(h.runtime.getTelegramBotSummary("alpha_bot").scope, "floating");
    assert.equal(h.runtime.getState().activeProjectId, "beta");

    // beta_bot still owns project beta, so the floating bot is the one that moves.
    h.runtime.useProject("alpha");
    const result = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "legacy route"),
      { botId: "alpha_bot" },
    );
    assert.equal(result.action, "agent_response");
    assert.equal(
      readSessionText(h.tempDir, "alpha", "professor").includes("legacy route"),
      true,
    );

    // And /projects is a real picker again for a floating bot.
    const picker = await h.runtime.handleTelegramWebhook(
      message(ALPHA_CHAT, "/projects"),
      { botId: "alpha_bot" },
    );
    assert.equal(picker.response.includes("Tap a project to switch."), true);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("project notification owners resolve per project and are absent when unbound", async () => {
  const h = await createHarness("owners");

  try {
    assert.equal(h.runtime.resolveTelegramBotContextForProject("alpha")?.botId, "alpha_bot");
    assert.equal(h.runtime.resolveTelegramBotContextForProject("beta")?.botId, "beta_bot");

    h.runtime.createProject("gamma");
    // A project with no bot has no owner: notifications are skipped, never rerouted.
    assert.equal(h.runtime.resolveTelegramBotContextForProject("gamma"), null);

    h.runtime.removeTelegramBot("alpha_bot");
    assert.equal(h.runtime.resolveTelegramBotContextForProject("alpha"), null);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a heartbeat digest goes to the bot that owns that project", async () => {
  const h = await createHarness("heartbeat-owner", {
    respond: async (input) =>
      input.text === "continue" ? "Heartbeat work done." : "Foreground reply.",
  });

  try {
    fs.writeFileSync(
      path.join(h.tempDir, "projects", "alpha", "AGENTS", "professor", "HEARTBEAT.md"),
      "after: 15m\nnotify: digest\n",
      "utf8",
    );

    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "kick things off"), {
      botId: "alpha_bot",
    });

    h.sent.length = 0;
    const pending = h.runtime.getState().projects.alpha.heartbeat.pending;
    assert.notEqual(pending, null);
    await h.runtime.runHeartbeatTick(
      new Date(Date.parse(pending?.wakeAt ?? "") + 1_000),
    );

    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].chatId, ALPHA_CHAT, "alpha's digest must not reach beta's chat");
    assert.equal(h.sent[0].text.includes("Heartbeat work done."), true);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});

test("a heartbeat for an unbound project is skipped rather than misdelivered", async () => {
  const h = await createHarness("heartbeat-unbound", {
    respond: async (input) =>
      input.text === "continue" ? "Heartbeat work done." : "Foreground reply.",
  });

  try {
    fs.writeFileSync(
      path.join(h.tempDir, "projects", "alpha", "AGENTS", "professor", "HEARTBEAT.md"),
      "after: 15m\nnotify: digest\n",
      "utf8",
    );
    await h.runtime.handleTelegramWebhook(message(ALPHA_CHAT, "kick things off"), {
      botId: "alpha_bot",
    });

    // Remove alpha's bot while a heartbeat is armed. beta_bot stays, and must not inherit it.
    h.runtime.removeTelegramBot("alpha_bot");
    h.sent.length = 0;

    const pending = h.runtime.getState().projects.alpha.heartbeat.pending;
    assert.notEqual(pending, null);
    await h.runtime.runHeartbeatTick(
      new Date(Date.parse(pending?.wakeAt ?? "") + 1_000),
    );

    assert.deepEqual(h.sent, []);
  } finally {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  }
});
