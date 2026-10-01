/**
 * Telegram long-polling transport.
 * Runs one independent loop per enabled bot and forwards each update into the runtime
 * tagged with the bot that received it. One bot failing never stops the others, and the
 * botId always comes from the loop that owns the token, never from the update payload.
 */
import type { OpenColabRuntime } from "./runtime.js";

interface TelegramUpdate {
  update_id: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
}

export interface TelegramPollingHandle {
  stop: () => void;
  /** Starts/stops loops so they match the current registry. Safe to call repeatedly. */
  refresh: () => void;
  /** Bot ids with a live loop, for diagnostics and tests. */
  activeBotIds: () => string[];
}

/** One pollable bot: an enabled profile whose token is present. */
export interface TelegramPollableBot {
  botId: string;
  token: string;
}

interface PollingOptions {
  logger?: (message: string) => void;
}

interface BotLoop {
  token: string;
  stop: () => void;
}

export function startTelegramPolling(
  runtime: OpenColabRuntime,
  options: PollingOptions = {}
): TelegramPollingHandle | null {
  const log = options.logger ?? (() => undefined);
  const loops = new Map<string, BotLoop>();
  let running = true;

  const handle: TelegramPollingHandle = {
    stop: () => {
      running = false;
      for (const loop of loops.values()) {
        loop.stop();
      }
      loops.clear();
    },
    refresh: () => {
      if (!running) {
        return;
      }
      syncLoops();
    },
    activeBotIds: () => [...loops.keys()].sort()
  };

  syncLoops();

  if (loops.size === 0) {
    log("Telegram polling skipped: no enabled bot has a token configured.");
  }

  return handle;

  function syncLoops(): void {
    let desired: TelegramPollableBot[];
    try {
      desired = runtime.listTelegramPollableBots();
    } catch (error) {
      log(
        `Telegram polling could not read the bot registry: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    const desiredById = new Map(desired.map((bot) => [bot.botId, bot]));

    for (const [botId, loop] of [...loops.entries()]) {
      const next = desiredById.get(botId);
      // A rotated token needs a fresh loop so the old one stops using the stale secret.
      if (!next || next.token !== loop.token) {
        loop.stop();
        loops.delete(botId);
        log(`Telegram polling stopped for bot '${botId}'.`);
      }
    }

    for (const bot of desired) {
      if (loops.has(bot.botId)) {
        continue;
      }
      loops.set(bot.botId, startBotLoop(bot));
      log(`Telegram polling started for bot '${bot.botId}'.`);
    }
  }

  function startBotLoop(bot: TelegramPollableBot): BotLoop {
    let loopRunning = true;
    const inFlight = new Set<Promise<unknown>>();

    void (async () => {
      let offset = await primeOffset(bot.token, log, bot.botId);

      while (loopRunning && running) {
        try {
          const updates = await getUpdates(bot.token, offset);
          for (const update of updates) {
            const task = Promise.resolve(
              runtime.handleTelegramWebhook(update, { botId: bot.botId })
            )
              .catch((error) => {
                log(
                  `[bot ${bot.botId}] Telegram update ${String(update.update_id)} failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              })
              .finally(() => {
                inFlight.delete(task);
              });
            inFlight.add(task);
            offset = update.update_id + 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("HTTP 401")) {
            // A revoked or wrong token never recovers by retrying; stop just this bot.
            log(
              `[bot ${bot.botId}] Telegram rejected the token (HTTP 401). Polling stopped for this bot; ` +
                "re-add it with 'opencolab telegram bot add'."
            );
            loopRunning = false;
            break;
          }
          if (message.includes("HTTP 409")) {
            log(
              `[bot ${bot.botId}] Telegram polling conflict (HTTP 409): another process is consuming ` +
                "this bot's updates. Stop the other gateway or give this bot its own token."
            );
          } else {
            log(`[bot ${bot.botId}] Telegram polling error: ${message}`);
          }
          await sleep(2000);
        }
      }
    })();

    return {
      token: bot.token,
      stop: () => {
        loopRunning = false;
      }
    };
  }
}

async function primeOffset(
  token: string,
  logger: (message: string) => void,
  botId?: string
): Promise<number | undefined> {
  const label = botId ? `[bot ${botId}] ` : "";
  try {
    await deleteWebhook(token);
  } catch (error) {
    logger(
      `${label}Could not clear Telegram webhook; continuing with polling. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const updates = await getUpdates(token, undefined, 0);
    if (updates.length === 0) {
      return undefined;
    }

    return updates[updates.length - 1].update_id + 1;
  } catch {
    return undefined;
  }
}

async function deleteWebhook(token: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      drop_pending_updates: false
    })
  });

  if (!response.ok) {
    throw new Error(`deleteWebhook failed with HTTP ${String(response.status)}`);
  }
}

async function getUpdates(
  token: string,
  offset?: number,
  timeout = 25
): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams();
  params.set("timeout", String(timeout));
  if (offset !== undefined) {
    params.set("offset", String(offset));
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`getUpdates failed with HTTP ${String(response.status)}`);
  }

  const body = (await response.json()) as TelegramResponse<TelegramUpdate[]>;
  if (!body.ok || !Array.isArray(body.result)) {
    throw new Error("getUpdates returned an invalid payload");
  }

  return body.result;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface TelegramHandshakeResult {
  chatId: string;
  chatType: string;
  sender: string;
  text: string;
}

export interface TelegramHandshakeOptions {
  /** Token of the bot to listen on. Required: handshake never guesses a bot. */
  token: string;
  /** Overall time to wait for an inbound message before giving up. */
  timeoutMs?: number;
  /** Long-poll timeout per getUpdates call, in seconds. */
  pollTimeoutSeconds?: number;
  /** Called roughly once per long-poll cycle with seconds elapsed so far. */
  onWaiting?: (elapsedSeconds: number) => void;
  /** Optional message sent back to the chat once a message is received. */
  acknowledgeText?: string;
  logger?: (message: string) => void;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_HANDSHAKE_POLL_TIMEOUT_SECONDS = 25;

export interface TelegramBotIdentity {
  telegramBotId: string;
  username: string | null;
}

/**
 * Validates a token and returns the bot's real Telegram identity.
 * Binding must never be persisted without this succeeding, so the operator never has to
 * type a username and a bad token fails before anything is written.
 */
export async function fetchTelegramBotIdentity(
  token: string
): Promise<TelegramBotIdentity | null> {
  if (!token.trim()) {
    return null;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as TelegramResponse<{
      id?: unknown;
      username?: unknown;
    }>;
    if (!body.ok || !body.result || body.result.id === undefined || body.result.id === null) {
      return null;
    }

    const username =
      typeof body.result.username === "string" ? body.result.username.trim() : "";
    return {
      telegramBotId: String(body.result.id),
      username: username ? username.replace(/^@/u, "") : null
    };
  } catch {
    return null;
  }
}

/**
 * Looks up a bot's public @username so onboarding can show a direct t.me link.
 * Returns null when the token is missing or the call fails.
 */
export async function fetchTelegramBotUsername(
  token: string
): Promise<string | null> {
  const identity = await fetchTelegramBotIdentity(token);
  return identity?.username ?? null;
}

/**
 * Waits for the first inbound Telegram message and returns its chat details.
 * Pending updates are drained first so a stale message cannot trigger pairing.
 * Returns null on timeout, a missing token, or a polling conflict (HTTP 409).
 */
export async function waitForTelegramHandshake(
  options: TelegramHandshakeOptions
): Promise<TelegramHandshakeResult | null> {
  const log = options.logger ?? (() => undefined);
  const token = options.token.trim();
  if (!token) {
    log("Telegram handshake skipped: bot token is not configured.");
    return null;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const pollTimeout =
    options.pollTimeoutSeconds ?? DEFAULT_HANDSHAKE_POLL_TIMEOUT_SECONDS;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  let offset = await primeOffset(token, log);

  while (Date.now() < deadline) {
    let updates: TelegramUpdate[];
    try {
      updates = await getUpdates(token, offset, pollTimeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("HTTP 409")) {
        log(
          "Telegram handshake conflict: another poller is consuming updates. Stop the gateway and retry."
        );
        return null;
      }
      log(`Telegram handshake polling error: ${message}`);
      await sleep(2000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const handshake = parseHandshakeUpdate(update);
      if (handshake) {
        if (options.acknowledgeText) {
          await sendTelegramText(token, handshake.chatId, options.acknowledgeText).catch(
            () => undefined
          );
        }
        return handshake;
      }
    }

    options.onWaiting?.(Math.round((Date.now() - startedAt) / 1000));
  }

  return null;
}

function parseHandshakeUpdate(update: TelegramUpdate): TelegramHandshakeResult | null {
  const root = update as unknown as Record<string, unknown>;
  const message = asRecord(root.message) ?? asRecord(root.edited_message);
  if (!message) {
    return null;
  }

  const text = String(message.text ?? message.caption ?? "").trim();
  if (!text) {
    return null;
  }

  const chat = asRecord(message.chat);
  if (!chat || chat.id === undefined || chat.id === null) {
    return null;
  }

  return {
    chatId: String(chat.id),
    chatType: parseChatType(chat),
    sender: parseSender(asRecord(message.from)),
    text
  };
}

async function sendTelegramText(
  token: string,
  chatId: string,
  text: string
): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  return response.ok;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseChatType(chat: Record<string, unknown>): string {
  const type = String(chat.type ?? "").trim().toLowerCase();
  if (
    type === "private" ||
    type === "group" ||
    type === "supergroup" ||
    type === "channel"
  ) {
    return type;
  }
  return "unknown";
}

function parseSender(from: Record<string, unknown> | null): string {
  if (!from) {
    return "telegram_user";
  }

  const username = String(from.username ?? "").trim();
  if (username) {
    return username;
  }

  const first = String(from.first_name ?? "").trim();
  const last = String(from.last_name ?? "").trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) {
    return fullName;
  }

  const id = String(from.id ?? "").trim();
  return id ? `telegram_user_${id}` : "telegram_user";
}
