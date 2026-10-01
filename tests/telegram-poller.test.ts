import test from "node:test";
import assert from "node:assert/strict";
import type { OpenColabRuntime } from "../src/runtime.js";
import {
  fetchTelegramBotIdentity,
  fetchTelegramBotUsername,
  startTelegramPolling,
  waitForTelegramHandshake,
} from "../src/telegram-poller.js";

const TEST_BOTS = [{ botId: "default", token: "test_bot_token" }];

test("polling advances offset after a failed update", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  let pollingHandle: { stop: () => void } | null = null;
  const fetchUrls: string[] = [];
  const logs: string[] = [];
  let handledUpdates = 0;
  let resolveOffsetAdvanced!: () => void;
  const offsetAdvanced = new Promise<void>((resolve) => {
    resolveOffsetAdvanced = resolve;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    fetchUrls.push(url);

    if (url.includes("/deleteWebhook")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.includes("/getUpdates?timeout=0")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.includes("/getUpdates?timeout=25")) {
      const requestUrl = new URL(url);
      const offset = requestUrl.searchParams.get("offset");

      if (offset === "102") {
        resolveOffsetAdvanced();
        pollingHandle?.stop();
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 101 }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  };

  const runtime = {
    listTelegramPollableBots: () => TEST_BOTS,
    handleTelegramWebhook: async () => {
      handledUpdates += 1;
      throw new Error("provider exploded");
    }
  } as unknown as OpenColabRuntime;

  try {
    pollingHandle = startTelegramPolling(runtime, {
      logger: (message) => {
        logs.push(message);
      }
    });

    assert.notEqual(pollingHandle, null);

    await Promise.race([
      offsetAdvanced,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for polling offset to advance")), 250);
      })
    ]);

    await wait(20);

    assert.equal(handledUpdates, 1);
    assert.equal(fetchUrls.some((url) => url.includes("offset=102")), true);
    assert.equal(
      logs.includes("[bot default] Telegram update 101 failed: provider exploded"),
      true
    );
  } finally {
    pollingHandle?.stop();
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previousToken;
    }
  }
});

test("polling can dispatch /stop while a previous update is still running", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  let pollingHandle: { stop: () => void } | null = null;
  const handledTexts: string[] = [];
  let resolveLongTask!: () => void;
  const longTaskReleased = new Promise<void>((resolve) => {
    resolveLongTask = resolve;
  });
  let resolveStopSeen!: () => void;
  const stopSeen = new Promise<void>((resolve) => {
    resolveStopSeen = resolve;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/deleteWebhook")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.includes("/getUpdates?timeout=0")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.includes("/getUpdates?timeout=25")) {
      const requestUrl = new URL(url);
      const offset = requestUrl.searchParams.get("offset");

      if (offset === "203") {
        pollingHandle?.stop();
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 201,
              message: {
                text: "long task",
                chat: { id: "10001" },
                from: { username: "alice" }
              }
            },
            {
              update_id: 202,
              message: {
                text: "/stop",
                chat: { id: "10001" },
                from: { username: "alice" }
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  };

  const runtime = {
    listTelegramPollableBots: () => TEST_BOTS,
    handleTelegramWebhook: async (update: { message?: { text?: string } }) => {
      const text = update.message?.text ?? "";
      handledTexts.push(text);
      if (text === "long task") {
        await longTaskReleased;
      }
      if (text === "/stop") {
        resolveStopSeen();
      }
    }
  } as unknown as OpenColabRuntime;

  try {
    pollingHandle = startTelegramPolling(runtime);
    assert.notEqual(pollingHandle, null);

    await Promise.race([
      stopSeen,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for /stop to be dispatched")), 250);
      })
    ]);

    assert.deepEqual(handledTexts.slice(0, 2), ["long task", "/stop"]);
    resolveLongTask();
    await wait(20);
  } finally {
    pollingHandle?.stop();
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previousToken;
    }
  }
});

test("waitForTelegramHandshake drains stale updates and returns the first fresh message", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const fetchUrls: string[] = [];
  const sentMessages: Array<{ chatId: unknown; text: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    fetchUrls.push(url);

    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }

    if (url.includes("/getUpdates?timeout=0")) {
      // A stale message is already pending when onboarding starts.
      return jsonResponse({
        ok: true,
        result: [
          {
            update_id: 500,
            message: {
              text: "old message",
              chat: { id: "99999", type: "private" },
              from: { username: "stale" },
            },
          },
        ],
      });
    }

    if (url.includes("/getUpdates?timeout=1")) {
      const offset = new URL(url).searchParams.get("offset");
      if (offset === "501") {
        return jsonResponse({
          ok: true,
          result: [
            {
              update_id: 501,
              message: {
                text: "hello",
                chat: { id: "55555", type: "private" },
                from: { username: "alice" },
              },
            },
          ],
        });
      }

      // A wrong/absent offset means the stale update was not drained.
      return jsonResponse({
        ok: true,
        result: [
          {
            update_id: 500,
            message: {
              text: "old message",
              chat: { id: "99999", type: "private" },
              from: { username: "stale" },
            },
          },
        ],
      });
    }

    if (url.includes("/sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        chat_id?: unknown;
        text?: unknown;
      };
      sentMessages.push({ chatId: body.chat_id, text: body.text });
      return jsonResponse({ ok: true, result: {} });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  };

  try {
    const result = await waitForTelegramHandshake({
      token: "test_bot_token",
      timeoutMs: 2000,
      pollTimeoutSeconds: 1,
      acknowledgeText: "Paired ✅",
    });

    assert.notEqual(result, null);
    assert.equal(result?.chatId, "55555");
    assert.equal(result?.chatType, "private");
    assert.equal(result?.sender, "alice");
    assert.equal(result?.text, "hello");
    assert.deepEqual(sentMessages, [{ chatId: "55555", text: "Paired ✅" }]);
    assert.equal(
      fetchUrls.some((url) => url.includes("/deleteWebhook")),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken(previousToken);
  }
});

test("waitForTelegramHandshake returns null when no message arrives before the timeout", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
  let waitingTicks = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes("/getUpdates?timeout=0")) {
      return jsonResponse({ ok: true, result: [] });
    }
    if (url.includes("/getUpdates")) {
      await wait(10);
      return jsonResponse({ ok: true, result: [] });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  };

  try {
    const result = await waitForTelegramHandshake({
      token: "test_bot_token",
      timeoutMs: 40,
      pollTimeoutSeconds: 1,
      onWaiting: () => {
        waitingTicks += 1;
      },
    });

    assert.equal(result, null);
    assert.equal(waitingTicks >= 1, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken(previousToken);
  }
});

test("waitForTelegramHandshake returns null on a polling conflict", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
  const logs: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes("/getUpdates?timeout=0")) {
      return jsonResponse({ ok: true, result: [] });
    }
    if (url.includes("/getUpdates")) {
      return new Response("Conflict", { status: 409 });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  };

  try {
    const result = await waitForTelegramHandshake({
      token: "test_bot_token",
      timeoutMs: 2000,
      pollTimeoutSeconds: 1,
      logger: (message) => {
        logs.push(message);
      },
    });

    assert.equal(result, null);
    assert.equal(
      logs.some((message) => message.includes("conflict")),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken(previousToken);
  }
});

test("fetchTelegramBotUsername returns the bot username from getMe", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/getMe")) {
      return jsonResponse({
        ok: true,
        result: { id: 7000000001, username: "opencolab_bot" }
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  };

  try {
    const username = await fetchTelegramBotUsername("test_bot_token");
    assert.equal(username, "opencolab_bot");
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken(previousToken);
  }
});

test("fetchTelegramBotIdentity returns the bot id and username, and null on a bad token", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/bot good_token/getMe".replace(" ", ""))) {
      return jsonResponse({ ok: true, result: { id: 42, username: "@handle_bot" } });
    }
    return new Response("Unauthorized", { status: 401 });
  };

  try {
    const ok = await fetchTelegramBotIdentity("good_token");
    assert.deepEqual(ok, { telegramBotId: "42", username: "handle_bot" });

    const bad = await fetchTelegramBotIdentity("bad_token");
    assert.equal(bad, null);

    const empty = await fetchTelegramBotIdentity("   ");
    assert.equal(empty, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function restoreToken(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = previous;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("polling runs one independent loop per bot and tags updates with the receiving bot", async () => {
  const originalFetch = globalThis.fetch;
  let pollingHandle: { stop: () => void; refresh: () => void; activeBotIds: () => string[] } | null =
    null;
  const seen: Array<{ botId: string; updateId: number }> = [];
  const delivered = new Set<string>();

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes("/getUpdates?timeout=0")) {
      return jsonResponse({ ok: true, result: [] });
    }
    if (url.includes("/getUpdates?timeout=25")) {
      // Each bot's loop uses its own token in the URL, so the update it receives is
      // unambiguous without reading anything from the payload.
      const botToken = url.includes("/bottoken_a/") ? "token_a" : "token_b";
      if (delivered.has(botToken)) {
        return longPollResponse({ ok: true, result: [] });
      }
      delivered.add(botToken);
      return longPollResponse({
        ok: true,
        result: [{ update_id: botToken === "token_a" ? 11 : 22 }]
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  };

  const runtime = {
    listTelegramPollableBots: () => [
      { botId: "bot_a", token: "token_a" },
      { botId: "bot_b", token: "token_b" }
    ],
    handleTelegramWebhook: async (
      update: { update_id: number },
      source: { botId: string }
    ) => {
      seen.push({ botId: source.botId, updateId: update.update_id });
      return { ok: true };
    }
  } as unknown as OpenColabRuntime;

  try {
    pollingHandle = startTelegramPolling(runtime, { logger: () => undefined });
    assert.notEqual(pollingHandle, null);
    assert.deepEqual(pollingHandle?.activeBotIds(), ["bot_a", "bot_b"]);

    await waitUntil(() => seen.length === 2);
    assert.deepEqual(
      [...seen].sort((a, b) => a.botId.localeCompare(b.botId)),
      [
        { botId: "bot_a", updateId: 11 },
        { botId: "bot_b", updateId: 22 }
      ]
    );
  } finally {
    pollingHandle?.stop();
    globalThis.fetch = originalFetch;
  }
});

test("the polling supervisor starts and stops loops as the registry changes", async () => {
  const originalFetch = globalThis.fetch;
  let pollingHandle: { stop: () => void; refresh: () => void; activeBotIds: () => string[] } | null =
    null;
  let bots = [{ botId: "bot_a", token: "token_a" }];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }
    return longPollResponse({ ok: true, result: [] });
  };

  const runtime = {
    listTelegramPollableBots: () => bots,
    handleTelegramWebhook: async () => ({ ok: true })
  } as unknown as OpenColabRuntime;

  try {
    pollingHandle = startTelegramPolling(runtime, { logger: () => undefined });
    assert.deepEqual(pollingHandle?.activeBotIds(), ["bot_a"]);

    // A CLI process adds a bot while the gateway runs.
    bots = [
      { botId: "bot_a", token: "token_a" },
      { botId: "bot_b", token: "token_b" }
    ];
    pollingHandle?.refresh();
    assert.deepEqual(pollingHandle?.activeBotIds(), ["bot_a", "bot_b"]);

    // ...then removes one.
    bots = [{ botId: "bot_b", token: "token_b" }];
    pollingHandle?.refresh();
    assert.deepEqual(pollingHandle?.activeBotIds(), ["bot_b"]);

    // A rotated token replaces the loop so the stale secret stops being used.
    bots = [{ botId: "bot_b", token: "token_b_rotated" }];
    pollingHandle?.refresh();
    assert.deepEqual(pollingHandle?.activeBotIds(), ["bot_b"]);
  } finally {
    pollingHandle?.stop();
    globalThis.fetch = originalFetch;
  }
});

test("a revoked token stops only its own loop", async () => {
  const originalFetch = globalThis.fetch;
  let pollingHandle: { stop: () => void; refresh: () => void; activeBotIds: () => string[] } | null =
    null;
  const logs: string[] = [];
  let healthyPolls = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/deleteWebhook")) {
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes("/botrevoked/")) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (url.includes("/getUpdates?timeout=25")) {
      healthyPolls += 1;
    }
    return longPollResponse({ ok: true, result: [] });
  };

  const runtime = {
    listTelegramPollableBots: () => [
      { botId: "dead_bot", token: "revoked" },
      { botId: "live_bot", token: "good" }
    ],
    handleTelegramWebhook: async () => ({ ok: true })
  } as unknown as OpenColabRuntime;

  try {
    pollingHandle = startTelegramPolling(runtime, {
      logger: (message) => {
        logs.push(message);
      }
    });

    await waitUntil(() =>
      logs.some((line) => line.includes("[bot dead_bot] Telegram rejected the token"))
    );
    await waitUntil(() => healthyPolls > 0);
  } finally {
    pollingHandle?.stop();
    globalThis.fetch = originalFetch;
  }
});

/** Mirrors Telegram's long poll just enough to yield to the macrotask queue. */
async function longPollResponse(body: unknown): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return jsonResponse(body);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
