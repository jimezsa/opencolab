import type { OpenColabConfig } from "./config.js";
import type { CodexAgentInput } from "./codex-agent.js";
import type {
  ConversationMessage,
  GatewayResult,
  OpenColabState,
  TelegramInbound
} from "./types.js";
import { nowIso, randomDigits } from "./utils.js";

export type TelegramSender = (
  chatId: string,
  text: string,
  state: OpenColabState
) => Promise<boolean>;

interface GatewayDependencies {
  getState: () => OpenColabState;
  saveState: (next: OpenColabState) => void;
  readConversation: (chatId: string, limit: number) => ConversationMessage[];
  appendConversation: (chatId: string, message: ConversationMessage) => void;
  respond: (input: CodexAgentInput) => Promise<string>;
  telegramSender?: TelegramSender;
}

export class TelegramGateway {
  private readonly sender: TelegramSender;

  constructor(
    private readonly config: OpenColabConfig,
    private readonly deps: GatewayDependencies
  ) {
    this.sender = deps.telegramSender ?? defaultTelegramSender;
  }

  async startPairing(): Promise<{ code: string; expiresAt: string; sent: boolean }> {
    const state = this.deps.getState();
    if (!state.telegram.chatId) {
      throw new Error("Telegram chatId is not configured. Run 'opencolab setup telegram'.");
    }

    const code = randomDigits(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const next: OpenColabState = {
      ...state,
      telegram: {
        ...state.telegram,
        paired: false,
        pairedAt: null,
        pendingPairingCode: code,
        pendingPairingExpiresAt: expiresAt
      }
    };

    this.deps.saveState(next);

    const sent = await this.sender(
      state.telegram.chatId,
      [
        "OpenColab pairing request",
        `Code: ${code}`,
        "Enter this code in your terminal:",
        `opencolab setup telegram pair complete --code ${code}`,
        `Expires: ${expiresAt}`
      ].join("\n"),
      next
    );

    if (!sent) {
      throw new Error(
        `Could not send pairing code to Telegram. Ensure bot token is configured (env var or literal token).`
      );
    }

    return { code, expiresAt, sent };
  }

  completePairing(code: string): { pairedAt: string } {
    const state = this.deps.getState();
    const pendingCode = state.telegram.pendingPairingCode;
    const pendingExpiresAt = state.telegram.pendingPairingExpiresAt;

    if (!pendingCode || !pendingExpiresAt) {
      throw new Error("No active pairing code. Run 'opencolab setup telegram pair start' first.");
    }

    if (Date.parse(pendingExpiresAt) < Date.now()) {
      throw new Error("Pairing code expired. Start a new pairing request.");
    }

    if (String(code).trim() !== String(pendingCode).trim()) {
      throw new Error("Invalid pairing code.");
    }

    const pairedAt = nowIso();
    const next: OpenColabState = {
      ...state,
      telegram: {
        ...state.telegram,
        paired: true,
        pairedAt,
        pendingPairingCode: null,
        pendingPairingExpiresAt: null
      }
    };

    this.deps.saveState(next);
    return { pairedAt };
  }

  async handleWebhook(body: unknown): Promise<GatewayResult> {
    const inbound = parseTelegramWebhookPayload(body);
    if (!inbound) {
      return {
        ok: true,
        action: "ignored",
        response: "",
        sent: false
      };
    }

    const state = this.deps.getState();

    if (!state.telegram.chatId || inbound.chatId !== state.telegram.chatId) {
      return {
        ok: false,
        action: "unauthorized_chat",
        response: "Unauthorized chat id",
        sent: false
      };
    }

    if (!state.telegram.paired) {
      const response = "Pairing required. Run 'opencolab setup telegram pair start' in your terminal.";
      const sent = await this.sender(inbound.chatId, response, state);
      return {
        ok: false,
        action: "pairing_required",
        response,
        sent
      };
    }

    const history = this.deps.readConversation(inbound.chatId, 8);
    const response = await this.deps.respond({
      chatId: inbound.chatId,
      sender: inbound.sender,
      text: inbound.text,
      history
    });

    this.deps.appendConversation(inbound.chatId, {
      role: "user",
      content: inbound.text,
      at: nowIso()
    });

    this.deps.appendConversation(inbound.chatId, {
      role: "assistant",
      content: response,
      at: nowIso()
    });

    const sent = await this.sender(inbound.chatId, response, state);

    return {
      ok: true,
      action: "agent_response",
      response,
      sent
    };
  }
}

export async function defaultTelegramSender(
  chatId: string,
  text: string,
  state: OpenColabState
): Promise<boolean> {
  const token = resolveSecretReference(state.telegram.botTokenEnvVar);
  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}

function resolveSecretReference(reference: string): string | null {
  const value = reference.trim();
  if (!value) {
    return null;
  }

  const fromEnv = process.env[value];
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  // Backward-compatible fallback for users who entered a raw token in setup.
  if (looksLikeLiteralSecret(value)) {
    return value;
  }

  return null;
}

function looksLikeLiteralSecret(value: string): boolean {
  return value.includes(":") || value.startsWith("sk-");
}

function parseTelegramWebhookPayload(body: unknown): TelegramInbound | null {
  const root = asRecord(body);
  if (!root) {
    return null;
  }

  const message = asRecord(root.message) ?? asRecord(root.edited_message);
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

  return {
    chatId: String(chat.id),
    sender: parseSender(asRecord(message.from)),
    text
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}
