/**
 * Telegram long-polling transport.
 * Pulls updates from Telegram and forwards them into the runtime webhook handler.
 */
import type { OpenColabRuntime } from "./runtime.js";
import { resolveTelegramBotToken } from "./secrets.js";

interface TelegramUpdate {
  update_id: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
}

export interface TelegramPollingHandle {
  stop: () => void;
}

interface PollingOptions {
  logger?: (message: string) => void;
}

export function startTelegramPolling(
  runtime: OpenColabRuntime,
  options: PollingOptions = {}
): TelegramPollingHandle | null {
  const log = options.logger ?? (() => undefined);
  const token = resolveTelegramBotToken();

  if (!token) {
    log("Telegram polling skipped: bot token is not configured.");
    return null;
  }
  const tokenValue = token;

  let running = true;
  const inFlight = new Set<Promise<unknown>>();
  void pollLoop();

  return {
    stop: () => {
      running = false;
    }
  };

  async function pollLoop(): Promise<void> {
    let offset = await primeOffset(tokenValue, log);

    while (running) {
      try {
        const updates = await getUpdates(tokenValue, offset);
        for (const update of updates) {
          const task = Promise.resolve(runtime.handleTelegramWebhook(update))
            .catch((error) => {
              log(
                `Telegram update ${String(update.update_id)} failed: ${
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
        log(
          `Telegram polling error: ${error instanceof Error ? error.message : String(error)}`
        );
        await sleep(2000);
      }
    }
  }
}

async function primeOffset(token: string, logger: (message: string) => void): Promise<number | undefined> {
  try {
    await deleteWebhook(token);
  } catch (error) {
    logger(
      `Could not clear Telegram webhook; continuing with polling. ${
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

/**
 * Looks up the bot's public @username via getMe so onboarding can show a
 * direct t.me link. Returns null when the token is missing or the call fails.
 */
export async function fetchTelegramBotUsername(): Promise<string | null> {
  const token = resolveTelegramBotToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as TelegramResponse<{ username?: unknown }>;
    if (!body.ok || !body.result) {
      return null;
    }

    const username =
      typeof body.result.username === "string" ? body.result.username.trim() : "";
    return username ? username : null;
  } catch {
    return null;
  }
}

/**
 * Waits for the first inbound Telegram message and returns its chat details.
 * Pending updates are drained first so a stale message cannot trigger pairing.
 * Returns null on timeout, a missing token, or a polling conflict (HTTP 409).
 */
export async function waitForTelegramHandshake(
  options: TelegramHandshakeOptions = {}
): Promise<TelegramHandshakeResult | null> {
  const log = options.logger ?? (() => undefined);
  const token = resolveTelegramBotToken();
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
