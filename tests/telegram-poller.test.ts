import test from "node:test";
import assert from "node:assert/strict";
import type { OpenColabRuntime } from "../src/runtime.js";
import { startTelegramPolling } from "../src/telegram-poller.js";

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
    assert.equal(logs.includes("Telegram update 101 failed: provider exploded"), true);
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

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
