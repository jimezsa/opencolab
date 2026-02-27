import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { renderWebPage } from "./web/page.js";

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(text);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function startHttpServer(port = loadConfig().localApiPort): void {
  const runtime = createRuntime();
  const { orchestrator } = runtime;

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      const pathname = url.pathname;

      if (method === "GET" && pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderWebPage());
        return;
      }

      if (method === "GET" && pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && pathname === "/api/runs") {
        const projectName = url.searchParams.get("project") ?? undefined;
        sendJson(response, 200, orchestrator.listRuns(projectName));
        return;
      }

      const runStatusMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (method === "GET" && runStatusMatch) {
        sendJson(response, 200, orchestrator.getRunStatus(runStatusMatch[1]));
        return;
      }

      const runActionMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(approve|pause|stop)$/);
      if (method === "POST" && runActionMatch) {
        const [, runId, action] = runActionMatch;
        if (action === "approve") {
          orchestrator.approveRun(runId);
        }
        if (action === "pause") {
          orchestrator.pauseRun(runId);
        }
        if (action === "stop") {
          orchestrator.stopRun(runId);
        }
        sendJson(response, 200, { ok: true, runId, action });
        return;
      }

      const runChatsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/chats$/);
      if (method === "GET" && runChatsMatch) {
        sendJson(response, 200, orchestrator.listChats(runChatsMatch[1]));
        return;
      }

      const chatMessagesMatch = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (method === "GET" && chatMessagesMatch) {
        sendJson(response, 200, orchestrator.viewChat(chatMessagesMatch[1]));
        return;
      }

      const meetingsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/meetings$/);
      if (method === "GET" && meetingsMatch) {
        sendJson(response, 200, orchestrator.listMeetings(meetingsMatch[1]));
        return;
      }

      if (method === "POST" && pathname === "/api/telegram/inbound") {
        const body = await readJson(request);
        const runId = String(body.runId ?? "");
        const sender = String(body.sender ?? "human");
        const text = String(body.text ?? "");

        if (!runId || !text) {
          sendJson(response, 400, { error: "runId and text are required" });
          return;
        }

        orchestrator.recordTelegramInbound(runId, sender, text);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && pathname === "/api/telegram/webhook") {
        const body = await readJson(request);
        const inbound = parseTelegramWebhookPayload(body);
        if (!inbound) {
          sendJson(response, 200, { ok: true, ignored: true });
          return;
        }

        const result = await orchestrator.handleTelegramWebhookMessage(
          inbound.chatId,
          inbound.sender,
          inbound.text
        );
        sendJson(response, 200, result);
        return;
      }

      sendText(response, 404, "Not found");
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`OpenColab web running on http://127.0.0.1:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      runtime.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseTelegramWebhookPayload(
  body: Record<string, unknown>
): { chatId: string; sender: string; text: string } | null {
  const message = asRecord(body.message) ?? asRecord(body.edited_message);
  if (!message) {
    return null;
  }

  const text = String(message.text ?? "").trim();
  if (!text) {
    return null;
  }

  const chat = asRecord(message.chat);
  if (!chat || chat.id === undefined || chat.id === null) {
    return null;
  }

  const from = asRecord(message.from);
  const sender = formatTelegramSender(from);

  return {
    chatId: String(chat.id),
    sender,
    text
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function formatTelegramSender(from: Record<string, unknown> | null): string {
  if (!from) {
    return "human";
  }

  const username = String(from.username ?? "").trim();
  if (username) {
    return username;
  }

  const firstName = String(from.first_name ?? "").trim();
  const lastName = String(from.last_name ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) {
    return fullName;
  }

  const id = String(from.id ?? "").trim();
  if (id) {
    return `telegram_user_${id}`;
  }

  return "human";
}
