import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { startTelegramPolling, type TelegramPollingHandle } from "./telegram-poller.js";

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });

  response.end(JSON.stringify(data));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

interface HttpServerOptions {
  telegramPolling?: boolean;
}

export function startHttpServer(
  port = loadConfig().localApiPort,
  cwd = process.cwd(),
  options: HttpServerOptions = {}
): void {
  const runtime = createRuntime(cwd);
  runtime.init();
  const telegramPollingEnabled = options.telegramPolling ?? true;
  const poller: TelegramPollingHandle | null = telegramPollingEnabled
    ? startTelegramPolling(runtime, { logger: (message) => console.log(message) })
    : null;

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, runtime.getState());
        return;
      }

      if (method === "POST" && url.pathname === "/api/telegram/webhook") {
        const body = await readJson(request);
        const result = await runtime.handleTelegramWebhook(body);
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`OpenColab gateway listening on http://127.0.0.1:${port}`);
  });

  const shutdown = () => {
    poller?.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
