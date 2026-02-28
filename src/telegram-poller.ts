import type { OpenColabRuntime } from "./runtime.js";
import { resolveSecretReference } from "./secrets.js";

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
  const state = runtime.getState();
  const token = resolveSecretReference(state.telegram.botTokenEnvVar);

  if (!token) {
    log("Telegram polling skipped: bot token is not configured.");
    return null;
  }
  const tokenValue = token;

  let running = true;
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
          await runtime.handleTelegramWebhook(update);
        }

        if (updates.length > 0) {
          offset = updates[updates.length - 1].update_id + 1;
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
