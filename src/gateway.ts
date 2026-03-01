import { ensureAgentFiles } from "./agent.js";
import type { OpenColabConfig } from "./config.js";
import type { CodexAgentInput } from "./codex-agent.js";
import {
  createDefaultAgentConfig,
  createDefaultProjectState,
  ensureProjectAndAgent,
  getActiveProject
} from "./project-config.js";
import type {
  ConversationMessage,
  GatewayResult,
  OpenColabState,
  TelegramFileKind,
  TelegramFilePayload,
  TelegramInbound,
  TelegramOutboundFile
} from "./types.js";
import { resolveSecretReference } from "./secrets.js";
import { nowIso, randomDigits } from "./utils.js";

export type TelegramSender = (
  chatId: string,
  text: string,
  state: OpenColabState
) => Promise<boolean>;

export type TelegramTypingSender = (chatId: string, state: OpenColabState) => Promise<boolean>;
export type TelegramFileSender = (
  chatId: string,
  file: TelegramOutboundFile,
  state: OpenColabState
) => Promise<boolean>;

interface GatewayDependencies {
  getState: () => OpenColabState;
  saveState: (next: OpenColabState) => void;
  readConversation: (chatId: string, limit: number) => ConversationMessage[];
  appendConversation: (chatId: string, message: ConversationMessage) => void;
  resetConversationSession: () => string;
  respond: (input: CodexAgentInput) => Promise<string>;
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
}

export class TelegramGateway {
  private readonly sender: TelegramSender;
  private readonly typingSender: TelegramTypingSender;
  private readonly fileSender: TelegramFileSender;

  constructor(
    private readonly config: OpenColabConfig,
    private readonly deps: GatewayDependencies
  ) {
    this.sender = deps.telegramSender ?? defaultTelegramSender;
    this.typingSender = deps.telegramTypingSender ?? defaultTelegramTypingSender;
    this.fileSender = deps.telegramFileSender ?? defaultTelegramFileSender;
  }

  async startPairing(): Promise<{ code: string; expiresAt: string; sent: boolean }> {
    const state = ensureProjectAndAgent(this.deps.getState());
    const project = getActiveProject(state);

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
        `Project: ${project.id}`,
        `Code: ${code}`,
        "Enter this code in your terminal:",
        `opencolab setup telegram pair complete --code ${code}`,
        `Expires: ${expiresAt}`
      ].join("\n"),
      next
    );

    if (!sent) {
      throw new Error(
        "Could not send pairing code to Telegram. Ensure bot token is configured (env var or literal token)."
      );
    }

    return { code, expiresAt, sent };
  }

  completePairing(code: string): { pairedAt: string } {
    const state = ensureProjectAndAgent(this.deps.getState());
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

    const state = ensureProjectAndAgent(this.deps.getState());
    const project = getActiveProject(state);

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

    let commandResult: { nextState?: OpenColabState; response: string } | null = null;
    try {
      commandResult = this.tryHandleManagementCommand(inbound, state);
    } catch (error) {
      commandResult = {
        response: error instanceof Error ? error.message : String(error)
      };
    }
    if (commandResult) {
      if (commandResult.nextState) {
        this.deps.saveState(commandResult.nextState);
      }

      const sent = await this.sender(inbound.chatId, commandResult.response, state);
      return {
        ok: true,
        action: "management_command",
        response: commandResult.response,
        sent
      };
    }

    const history = this.deps.readConversation(inbound.chatId, 8);
    const stopTyping = this.startTypingFeedback(inbound.chatId, state);
    let response = "";

    try {
      response = await this.deps.respond({
        chatId: inbound.chatId,
        sender: inbound.sender,
        text: inbound.text,
        files: inbound.files,
        history
      });
    } finally {
      stopTyping();
    }

    const outbound = parseOutboundAgentResponse(response);
    const assistantLog = buildAssistantLogContent(outbound.text, outbound.files);

    this.deps.appendConversation(inbound.chatId, {
      role: "user",
      content: inbound.text,
      at: nowIso()
    });

    this.deps.appendConversation(inbound.chatId, {
      role: "assistant",
      content: assistantLog,
      at: nowIso()
    });

    let sent = true;
    let sentAny = false;

    if (outbound.text) {
      const textSent = await this.sender(inbound.chatId, outbound.text, state);
      sent = sent && textSent;
      sentAny = sentAny || textSent;
    }

    for (const file of outbound.files) {
      const fileSent = await this.fileSender(inbound.chatId, file, state);
      sent = sent && fileSent;
      sentAny = sentAny || fileSent;
    }

    if (!outbound.text && outbound.files.length === 0) {
      sent = false;
    } else if (sentAny && !sent) {
      sent = false;
    }

    const responseText = outbound.text || summarizeOutboundFiles(outbound.files);

    return {
      ok: true,
      action: "agent_response",
      response: responseText,
      sent
    };
  }

  private tryHandleManagementCommand(
    inbound: TelegramInbound,
    state: OpenColabState
  ): { nextState?: OpenColabState; response: string } | null {
    const text = inbound.commandText.trim();
    if (!text.startsWith("/")) {
      return null;
    }

    const tokens = text.split(/\s+/);
    const scope = tokens[0]?.toLowerCase();
    const action = tokens[1]?.toLowerCase();
    const value = tokens[2];

    if (scope === "/project") {
      if (action === "list") {
        return {
          response: this.renderProjectList(state)
        };
      }

      if (action === "create") {
        if (!value) {
          return {
            response: "Usage: /project create <project_id>"
          };
        }

        const projectId = normalizeEntityId(value);
        if (state.projects[projectId]) {
          return {
            response: `Project already exists: ${projectId}`
          };
        }

        const currentProject = getActiveProject(state);
        const project = createDefaultProjectState(projectId);
        project.provider = { ...currentProject.provider };

        const nextState = ensureProjectAndAgent({
          ...state,
          activeProjectId: project.id,
          projects: {
            ...state.projects,
            [project.id]: project
          }
        });

        const activeAgent = project.agents[project.activeAgentId];
        ensureAgentFiles(this.config.rootDir, activeAgent);

        return {
          nextState,
          response: `Project created and selected: ${project.id}`
        };
      }

      if (action === "use") {
        if (!value) {
          return {
            response: "Usage: /project use <project_id>"
          };
        }

        const projectId = normalizeEntityId(value);
        const target = state.projects[projectId];
        if (!target) {
          return {
            response: `Unknown project: ${projectId}`
          };
        }

        const nextState = ensureProjectAndAgent({
          ...state,
          activeProjectId: projectId
        });

        const activeAgent = target.agents[target.activeAgentId] ?? Object.values(target.agents)[0];
        if (activeAgent) {
          ensureAgentFiles(this.config.rootDir, activeAgent);
        }

        return {
          nextState,
          response: `Active project: ${projectId}`
        };
      }

      return {
        response: "Project commands: /project list | /project create <project_id> | /project use <project_id>"
      };
    }

    if (scope === "/agent") {
      const project = getActiveProject(state);

      if (action === "list") {
        return {
          response: this.renderAgentList(project)
        };
      }

      if (action === "create") {
        if (!value) {
          return {
            response: "Usage: /agent create <agent_id>"
          };
        }

        const agentId = normalizeEntityId(value);
        if (project.agents[agentId]) {
          return {
            response: `Agent already exists in project '${project.id}': ${agentId}`
          };
        }

        const agent = createDefaultAgentConfig(project.id, agentId);
        const nextState = ensureProjectAndAgent({
          ...state,
          projects: {
            ...state.projects,
            [project.id]: {
              ...project,
              activeAgentId: agent.id,
              agents: {
                ...project.agents,
                [agent.id]: agent
              }
            }
          }
        });

        ensureAgentFiles(this.config.rootDir, agent);

        return {
          nextState,
          response: `Agent created and selected: ${agent.id} (project ${project.id})`
        };
      }

      if (action === "use") {
        if (!value) {
          return {
            response: "Usage: /agent use <agent_id>"
          };
        }

        const agentId = normalizeEntityId(value);
        if (!project.agents[agentId]) {
          return {
            response: `Unknown agent in project '${project.id}': ${agentId}`
          };
        }

        const nextState = ensureProjectAndAgent({
          ...state,
          projects: {
            ...state.projects,
            [project.id]: {
              ...project,
              activeAgentId: agentId
            }
          }
        });

        ensureAgentFiles(this.config.rootDir, project.agents[agentId]);

        return {
          nextState,
          response: `Active agent: ${agentId} (project ${project.id})`
        };
      }

      return {
        response: "Agent commands: /agent list | /agent create <agent_id> | /agent use <agent_id>"
      };
    }

    if (scope === "/session") {
      if (action === "reset") {
        const sessionId = this.deps.resetConversationSession();
        return {
          response: `Session reset. New session: ${sessionId}`
        };
      }

      return {
        response: "Session commands: /session reset"
      };
    }

    return {
      response:
        "Supported commands: /project list | /project create <project_id> | /project use <project_id> | /agent list | /agent create <agent_id> | /agent use <agent_id> | /session reset"
    };
  }

  private renderProjectList(state: OpenColabState): string {
    const entries = Object.values(state.projects).sort((a, b) => a.id.localeCompare(b.id));
    const lines = entries.map((project) => {
      const marker = project.id === state.activeProjectId ? "*" : "-";
      return `${marker} ${project.id} (active agent: ${project.activeAgentId})`;
    });

    return [`Projects (${entries.length})`, ...lines].join("\n");
  }

  private renderAgentList(project: OpenColabState["projects"][string]): string {
    const entries = Object.values(project.agents).sort((a, b) => a.id.localeCompare(b.id));
    const lines = entries.map((agent) => {
      const marker = agent.id === project.activeAgentId ? "*" : "-";
      return `${marker} ${agent.id} (${agent.path})`;
    });

    return [`Agents in ${project.id} (${entries.length})`, ...lines].join("\n");
  }

  private startTypingFeedback(chatId: string, state: OpenColabState): () => void {
    let running = true;

    const tick = async (): Promise<void> => {
      if (!running) {
        return;
      }

      try {
        await this.typingSender(chatId, state);
      } catch {
        // Typing feedback is best-effort.
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 4000);

    return () => {
      running = false;
      clearInterval(timer);
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

export async function defaultTelegramTypingSender(
  chatId: string,
  state: OpenColabState
): Promise<boolean> {
  const token = resolveSecretReference(state.telegram.botTokenEnvVar);
  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing"
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function defaultTelegramFileSender(
  chatId: string,
  file: TelegramOutboundFile,
  state: OpenColabState
): Promise<boolean> {
  const token = resolveSecretReference(state.telegram.botTokenEnvVar);
  if (!token) {
    return false;
  }

  const method = resolveTelegramFileMethod(file.kind);
  const fileField = resolveTelegramFileField(file.kind);

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    [fileField]: file.file
  };

  if (file.caption && supportsCaption(file.kind)) {
    payload.caption = file.caption;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return response.ok;
  } catch {
    return false;
  }
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

  const text = String(message.text ?? message.caption ?? "").trim();
  const files = parseInboundFiles(message);
  if (!text && files.length === 0) {
    return null;
  }

  const chat = asRecord(message.chat);
  if (!chat || chat.id === undefined || chat.id === null) {
    return null;
  }

  return {
    chatId: String(chat.id),
    sender: parseSender(asRecord(message.from)),
    commandText: text,
    text: buildInboundText(text, files),
    files
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

function normalizeEntityId(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Identifier is required.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid identifier '${trimmed}'. Use only letters, numbers, underscore, or hyphen.`
    );
  }

  return trimmed;
}

function parseInboundFiles(message: Record<string, unknown>): TelegramFilePayload[] {
  const payloads: TelegramFilePayload[] = [];

  const document = asRecord(message.document);
  if (document) {
    const payload = buildFilePayload("document", document);
    if (payload) {
      payloads.push(payload);
    }
  }

  const audio = asRecord(message.audio);
  if (audio) {
    const payload = buildFilePayload("audio", audio);
    if (payload) {
      payloads.push(payload);
    }
  }

  const video = asRecord(message.video);
  if (video) {
    const payload = buildFilePayload("video", video);
    if (payload) {
      payloads.push(payload);
    }
  }

  const voice = asRecord(message.voice);
  if (voice) {
    const payload = buildFilePayload("voice", voice);
    if (payload) {
      payloads.push(payload);
    }
  }

  const videoNote = asRecord(message.video_note);
  if (videoNote) {
    const payload = buildFilePayload("video_note", videoNote);
    if (payload) {
      payloads.push(payload);
    }
  }

  const animation = asRecord(message.animation);
  if (animation) {
    const payload = buildFilePayload("animation", animation);
    if (payload) {
      payloads.push(payload);
    }
  }

  const sticker = asRecord(message.sticker);
  if (sticker) {
    const payload = buildFilePayload("sticker", sticker);
    if (payload) {
      payloads.push(payload);
    }
  }

  const photos = Array.isArray(message.photo) ? message.photo.map(asRecord).filter(Boolean) : [];
  const bestPhoto = photos[photos.length - 1];
  if (bestPhoto) {
    const payload = buildFilePayload("photo", bestPhoto);
    if (payload) {
      payloads.push(payload);
    }
  }

  return payloads;
}

function buildFilePayload(kind: TelegramFileKind, source: Record<string, unknown>): TelegramFilePayload | null {
  const fileId = asStringValue(source.file_id);
  if (!fileId) {
    return null;
  }

  const payload: TelegramFilePayload = {
    kind,
    fileId
  };

  const uniqueId = asStringValue(source.file_unique_id);
  if (uniqueId) {
    payload.fileUniqueId = uniqueId;
  }

  const fileName = asStringValue(source.file_name);
  if (fileName) {
    payload.fileName = fileName;
  }

  const mimeType = asStringValue(source.mime_type);
  if (mimeType) {
    payload.mimeType = mimeType;
  }

  const size = asNumberValue(source.file_size);
  if (size !== null) {
    payload.fileSize = size;
  }

  const duration = asNumberValue(source.duration);
  if (duration !== null) {
    payload.durationSec = duration;
  }

  const width = asNumberValue(source.width);
  if (width !== null) {
    payload.width = width;
  }

  const height = asNumberValue(source.height);
  if (height !== null) {
    payload.height = height;
  }

  return payload;
}

function buildInboundText(baseText: string, files: TelegramFilePayload[]): string {
  const lines: string[] = [];

  if (baseText) {
    lines.push(baseText);
  }

  if (files.length > 0) {
    lines.push("[telegram_files]");
    files.forEach((file, index) => {
      lines.push(
        `${index + 1}. kind=${file.kind} file_id=${file.fileId}` +
          (file.fileName ? ` file_name=${file.fileName}` : "") +
          (file.mimeType ? ` mime_type=${file.mimeType}` : "") +
          (file.fileSize !== undefined ? ` file_size=${String(file.fileSize)}` : "")
      );
    });
  }

  return lines.join("\n").trim();
}

function parseOutboundAgentResponse(raw: string): { text: string; files: TelegramOutboundFile[] } {
  const lines = raw.split(/\r?\n/);
  const remaining: string[] = [];
  const files: TelegramOutboundFile[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("@telegram-file")) {
      remaining.push(line);
      continue;
    }

    const payloadRaw = trimmed.slice("@telegram-file".length).trim();
    if (!payloadRaw) {
      continue;
    }

    try {
      const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
      const file = normalizeOutboundFile(payload);
      if (file) {
        files.push(file);
      }
    } catch {
      remaining.push(line);
    }
  }

  return {
    text: remaining.join("\n").trim(),
    files
  };
}

function normalizeOutboundFile(source: Record<string, unknown>): TelegramOutboundFile | null {
  const kind = asOutboundKind(source.kind);
  if (!kind) {
    return null;
  }

  const file = asStringValue(source.file);
  if (!file) {
    return null;
  }

  const caption = asStringValue(source.caption);
  return {
    kind,
    file,
    ...(caption ? { caption } : {})
  };
}

function asOutboundKind(value: unknown): TelegramFileKind | null {
  const parsed = asStringValue(value);
  if (!parsed) {
    return null;
  }

  return isTelegramFileKind(parsed) ? parsed : null;
}

function isTelegramFileKind(value: string): value is TelegramFileKind {
  return (
    value === "document" ||
    value === "photo" ||
    value === "audio" ||
    value === "video" ||
    value === "voice" ||
    value === "video_note" ||
    value === "animation" ||
    value === "sticker"
  );
}

function buildAssistantLogContent(text: string, files: TelegramOutboundFile[]): string {
  if (files.length === 0) {
    return text;
  }

  const lines: string[] = [];
  if (text) {
    lines.push(text);
  }
  lines.push("[telegram_outbound_files]");
  files.forEach((file, index) => {
    lines.push(
      `${index + 1}. kind=${file.kind} file=${file.file}` +
        (file.caption ? ` caption=${file.caption}` : "")
    );
  });

  return lines.join("\n").trim();
}

function summarizeOutboundFiles(files: TelegramOutboundFile[]): string {
  if (files.length === 0) {
    return "";
  }

  const nouns = files.map((file) => file.kind).join(", ");
  return `Sent ${String(files.length)} file(s): ${nouns}`;
}

function resolveTelegramFileMethod(kind: TelegramFileKind): string {
  switch (kind) {
    case "document":
      return "sendDocument";
    case "photo":
      return "sendPhoto";
    case "audio":
      return "sendAudio";
    case "video":
      return "sendVideo";
    case "voice":
      return "sendVoice";
    case "video_note":
      return "sendVideoNote";
    case "animation":
      return "sendAnimation";
    case "sticker":
      return "sendSticker";
  }
}

function resolveTelegramFileField(kind: TelegramFileKind): string {
  switch (kind) {
    case "document":
      return "document";
    case "photo":
      return "photo";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "voice":
      return "voice";
    case "video_note":
      return "video_note";
    case "animation":
      return "animation";
    case "sticker":
      return "sticker";
  }
}

function supportsCaption(kind: TelegramFileKind): boolean {
  return kind !== "sticker" && kind !== "video_note";
}

function asStringValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function asNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
