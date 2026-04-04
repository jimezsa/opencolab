/**
 * Telegram gateway and routing logic.
 * Enforces pairing/auth, handles management commands, and forwards user input to agents.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureAgentFiles } from "./agent.js";
import type { OpenColabConfig } from "./config.js";
import type {
  ProviderAgentInput,
  ProviderRespondOptions,
} from "./provider-agent.js";
import {
  ensureProjectAndAgent,
  getActiveAgent as getProjectActiveAgent,
  getActiveProject,
} from "./project-config.js";
import type {
  AgentMemoryContext,
  ConversationMessage,
  GatewayResult,
  OpenColabState,
  ProviderConfig,
  TaskProgressEvent,
  TelegramFileKind,
  TelegramFilePayload,
  TelegramInbound,
  TelegramInlineButton,
  TelegramMessageOptions,
  TelegramOutboundFile,
} from "./types.js";
import { resolveTelegramBotToken } from "./secrets.js";
import { ensureDir, nowIso, randomDigits } from "./utils.js";

export type TelegramSender = (
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramDraftSender = (
  chatId: string,
  draftId: number,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramStatusMessageCreator = (
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
) => Promise<string | null>;

export type TelegramMessageEditor = (
  chatId: string,
  messageId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramTypingSender = (
  chatId: string,
  state: OpenColabState,
) => Promise<boolean>;
export type TelegramFileSender = (
  chatId: string,
  file: TelegramOutboundFile,
  state: OpenColabState,
) => Promise<boolean>;

export type TelegramCallbackAnswerer = (
  callbackQueryId: string,
  text: string | undefined,
  state: OpenColabState,
) => Promise<boolean>;

interface GatewayDependencies {
  getState: () => OpenColabState;
  saveState: (next: OpenColabState) => void;
  readConversationMemory: (chatId: string, limit: number) => AgentMemoryContext;
  appendConversation: (chatId: string, message: ConversationMessage) => void;
  resetConversationSession: () => string;
  respond: (
    input: ProviderAgentInput,
    options?: ProviderRespondOptions,
  ) => Promise<string>;
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
  telegramCallbackAnswerer?: TelegramCallbackAnswerer;
  telegramDraftSender?: TelegramDraftSender;
  telegramStatusMessageCreator?: TelegramStatusMessageCreator;
  telegramMessageEditor?: TelegramMessageEditor;
}

const TELEGRAM_FILE_FETCH_TIMEOUT_MS = 10_000;
const MAX_TELEGRAM_ERROR_CHARS = 1_500;
const MAX_TELEGRAM_CALLBACK_TEXT_CHARS = 180;
const EDITABLE_STATUS_THROTTLE_MS = 3_000;
const DRAFT_STATUS_THROTTLE_MS = 1_200;
const MAX_LIVE_STATUS_LINES = 4;
const MAX_GROUP_LIVE_STATUS_LINES = 5;
const SUPPORTED_TELEGRAM_COMMANDS_TEXT =
  "Supported commands: /projects | /agents | /session_reset";

interface ManagementCommandResult {
  nextState?: OpenColabState;
  response: string;
  options?: TelegramMessageOptions;
  callbackAnswerText?: string;
}

interface RequestProgressState {
  lastMeaningfulMessage: string | null;
}

interface LiveStatusLine {
  slot: string;
  message: string;
  kind: TaskProgressEvent["kind"];
  updatedAt: number;
}

type LiveStatusTransport = "draft" | "editable" | "disabled";

class TelegramLiveStatusSession {
  private readonly preferredTransport: LiveStatusTransport;
  private readonly draftId: number;
  private readonly lines = new Map<string, LiveStatusLine>();
  private transport: LiveStatusTransport | null = null;
  private editableMessageId: string | null = null;
  private activated = false;
  private lastRenderedText = "";
  private lastSentAt = 0;
  private closed = false;
  private queue = Promise.resolve();

  constructor(
    private readonly chatId: string,
    private readonly state: OpenColabState,
    private readonly inbound: TelegramInbound,
    private readonly draftSender: TelegramDraftSender,
    private readonly statusMessageCreator: TelegramStatusMessageCreator,
    private readonly messageEditor: TelegramMessageEditor,
  ) {
    this.preferredTransport = inbound.chatType === "private" ? "draft" : "editable";
    this.draftId = Math.max(1, Date.now() % 2_000_000_000);
  }

  push(event: TaskProgressEvent): Promise<void> {
    if (this.closed) {
      return this.queue;
    }

    this.applyEvent(event);
    return this.enqueue(() => this.flush(this.shouldBypassThrottle(event)));
  }

  close(): Promise<void> {
    this.closed = true;
    return this.queue.catch(() => undefined);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch(() => undefined);
    return this.queue;
  }

  private applyEvent(event: TaskProgressEvent): void {
    const message = normalizeProgressMessage(event.message);
    if (!message) {
      return;
    }

    const slot = this.resolveSlot(event);
    this.lines.set(slot, {
      slot,
      message,
      kind: event.kind,
      updatedAt: Date.now(),
    });

    const ordered = [...this.lines.values()].sort((left, right) => left.updatedAt - right.updatedAt);
    while (ordered.length > this.maxLineCount()) {
      const first = ordered.shift();
      if (!first) {
        break;
      }
      this.lines.delete(first.slot);
    }
  }

  private shouldBypassThrottle(event: TaskProgressEvent): boolean {
    return (
      event.kind === "warning" ||
      event.kind === "needs_input" ||
      event.kind === "completed"
    );
  }

  private async flush(force = false): Promise<void> {
    if (this.closed) {
      return;
    }

    const rendered = this.render();
    if (!rendered) {
      return;
    }

    const now = Date.now();
    const throttleMs = this.transport === "draft" ? DRAFT_STATUS_THROTTLE_MS : EDITABLE_STATUS_THROTTLE_MS;
    if (!force && rendered === this.lastRenderedText) {
      return;
    }
    if (!force && this.activated && now - this.lastSentAt < throttleMs) {
      return;
    }

    const sent = await this.send(rendered);
    if (!sent) {
      return;
    }

    this.activated = true;
    this.lastRenderedText = rendered;
    this.lastSentAt = now;
  }

  private render(): string | null {
    const lines = [...this.lines.values()].sort((left, right) => left.updatedAt - right.updatedAt);
    if (lines.length === 0) {
      return null;
    }
    const visibleLines = lines;
    const latestKind = visibleLines[visibleLines.length - 1]?.kind ?? "started";
    const heading =
      latestKind === "warning"
        ? "Attention needed"
        : latestKind === "needs_input"
          ? "Need input"
          : latestKind === "completed"
            ? "Finalizing"
            : this.showsActivityFeed()
              ? "Agent activity"
              : "Working on it";

    return [
      heading,
      "",
      ...visibleLines.map((line) => `- ${line.message}`),
    ].join("\n");
  }

  private async send(text: string): Promise<boolean> {
    const options = this.inbound.messageThreadId
      ? { messageThreadId: this.inbound.messageThreadId }
      : undefined;

    if (this.transport === "draft") {
      return safeSendTelegramDraft(
        this.draftSender,
        this.chatId,
        this.draftId,
        text,
        this.state,
        options,
      );
    }

    if (this.transport === "editable") {
      if (!this.editableMessageId) {
        return false;
      }
      return safeEditTelegramMessage(
        this.messageEditor,
        this.chatId,
        this.editableMessageId,
        text,
        this.state,
        options,
      );
    }

    if (this.preferredTransport === "draft") {
      const sentDraft = await safeSendTelegramDraft(
        this.draftSender,
        this.chatId,
        this.draftId,
        text,
        this.state,
        options,
      );
      if (sentDraft) {
        this.transport = "draft";
        return true;
      }
    }

    const messageId = await safeCreateTelegramStatusMessage(
      this.statusMessageCreator,
      this.chatId,
      text,
      this.state,
      options,
    );
    if (messageId) {
      this.transport = "editable";
      this.editableMessageId = messageId;
      return true;
    }

    this.transport = "disabled";
    return false;
  }

  private showsActivityFeed(): boolean {
    return (
      this.inbound.chatType === "group" ||
      this.inbound.chatType === "supergroup" ||
      this.inbound.chatType === "channel"
    );
  }

  private maxLineCount(): number {
    return this.showsActivityFeed()
      ? MAX_GROUP_LIVE_STATUS_LINES
      : MAX_LIVE_STATUS_LINES;
  }

  private resolveSlot(event: TaskProgressEvent): string {
    if (!this.showsActivityFeed()) {
      return (
        normalizeProgressMessage(event.stage ?? "") ||
        normalizeProgressMessage(event.kind === "completed" ? "finalize" : event.kind) ||
        resolveProgressSlot(event)
      );
    }
    return resolveProgressSlot(event);
  }
}

export class TelegramGateway {
  private readonly sender: TelegramSender;
  private readonly draftSender: TelegramDraftSender;
  private readonly statusMessageCreator: TelegramStatusMessageCreator;
  private readonly messageEditor: TelegramMessageEditor;
  private readonly typingSender: TelegramTypingSender;
  private readonly fileSender: TelegramFileSender;
  private readonly callbackAnswerer: TelegramCallbackAnswerer;

  constructor(
    private readonly config: OpenColabConfig,
    private readonly deps: GatewayDependencies,
  ) {
    this.sender = deps.telegramSender ?? defaultTelegramSender;
    this.draftSender = deps.telegramDraftSender ?? defaultTelegramDraftSender;
    this.statusMessageCreator =
      deps.telegramStatusMessageCreator ?? defaultTelegramStatusMessageCreator;
    this.messageEditor = deps.telegramMessageEditor ?? defaultTelegramMessageEditor;
    this.typingSender =
      deps.telegramTypingSender ?? defaultTelegramTypingSender;
    this.fileSender = deps.telegramFileSender ?? defaultTelegramFileSender;
    this.callbackAnswerer =
      deps.telegramCallbackAnswerer ?? defaultTelegramCallbackAnswerer;
  }

  async startPairing(): Promise<{
    code: string;
    expiresAt: string;
    sent: boolean;
  }> {
    const state = ensureProjectAndAgent(this.deps.getState());

    if (!state.telegram.chatId) {
      throw new Error(
        "Telegram chatId is not configured. Run 'opencolab setup telegram'.",
      );
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
        pendingPairingExpiresAt: expiresAt,
      },
    };

    this.deps.saveState(next);

    const sent = await this.sender(
      state.telegram.chatId,
      [
        "Welcome to OpenColab Pairing! ✨",
        "You've unlocked the first step of your research adventure! 🌊🐙",
        `🔑 Code: ${code}`,
        ` or run: opencolab setup telegram pair complete --code ${code}`,
        "⏰ Code valid for 10 minutes. Let’s dive in!",
      ].join("\n"),
      next,
    );

    if (!sent) {
      throw new Error(
        "Could not send pairing code to Telegram. Ensure bot token is configured (env var or literal token).",
      );
    }

    return { code, expiresAt, sent };
  }

  completePairing(code: string): { pairedAt: string } {
    const state = ensureProjectAndAgent(this.deps.getState());
    const pendingCode = state.telegram.pendingPairingCode;
    const pendingExpiresAt = state.telegram.pendingPairingExpiresAt;

    if (!pendingCode || !pendingExpiresAt) {
      throw new Error(
        "No active pairing code. Run 'opencolab setup telegram pair start' first.",
      );
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
        pendingPairingExpiresAt: null,
      },
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
        sent: false,
      };
    }

    const state = ensureProjectAndAgent(this.deps.getState());
    const project = getActiveProject(state);
    const activeAgent = getProjectActiveAgent(project);

    if (!state.telegram.chatId || inbound.chatId !== state.telegram.chatId) {
      return {
        ok: false,
        action: "unauthorized_chat",
        response: "Unauthorized chat id",
        sent: false,
      };
    }

    if (!state.telegram.paired) {
      const response =
        "Pairing required. Run 'opencolab setup telegram pair start' in your terminal.";
      const sent = await this.sender(inbound.chatId, response, state);
      return {
        ok: false,
        action: "pairing_required",
        response,
        sent,
      };
    }

    let commandResult: ManagementCommandResult | null = null;
    try {
      commandResult = this.tryHandleManagementCommand(inbound, state);
    } catch (error) {
      commandResult = {
        response: error instanceof Error ? error.message : String(error),
        callbackAnswerText: "Command failed.",
      };
    }
    if (commandResult) {
      const responseState = commandResult.nextState
        ? ensureProjectAndAgent(commandResult.nextState)
        : state;
      if (commandResult.nextState) {
        this.deps.saveState(commandResult.nextState);
      }

      if (inbound.callbackQueryId) {
        await safeAnswerTelegramCallback(
          this.callbackAnswerer,
          inbound.callbackQueryId,
          truncateTelegramCallbackText(commandResult.callbackAnswerText ?? commandResult.response),
          responseState,
        );
      }

      const sent = await this.sender(
        inbound.chatId,
        commandResult.response,
        responseState,
        {
          ...commandResult.options,
          ...(inbound.messageThreadId ? { messageThreadId: inbound.messageThreadId } : {}),
        },
      );
      return {
        ok: true,
        action: "management_command",
        response: commandResult.response,
        sent,
      };
    }

    const memory = this.deps.readConversationMemory(inbound.chatId, 8);
    let stopTyping: (() => void) | null = null;
    const progressState = createRequestProgressState();
    const replyOptions = inbound.messageThreadId
      ? { messageThreadId: inbound.messageThreadId }
      : undefined;
    const liveStatus = new TelegramLiveStatusSession(
      inbound.chatId,
      state,
      inbound,
      this.draftSender,
      this.statusMessageCreator,
      this.messageEditor,
    );
    let progressQueue = Promise.resolve();
    let inboundText = "";
    let appendedUserTurn = false;

    try {
      stopTyping = this.startTypingFeedback(inbound.chatId, state);
      const resolvedFiles = await resolveInboundFiles(
        this.config,
        project.path,
        inbound.files,
      );
      inboundText = buildInboundText(inbound.text, resolvedFiles);
      this.deps.appendConversation(inbound.chatId, {
        role: "user",
        content: inboundText,
        at: nowIso(),
      });
      appendedUserTurn = true;
      const response = await this.deps.respond(
        {
          chatId: inbound.chatId,
          sender: inbound.sender,
          text: inboundText,
          files: resolvedFiles,
          memory,
        },
        {
          onProgress: (event) => {
            progressQueue = progressQueue
              .then(async () =>
                this.sendProgressUpdate(
                  event,
                  progressState,
                  liveStatus,
                ),
              )
              .catch(() => undefined);
            return progressQueue;
          },
        },
      );
      await progressQueue;
      await liveStatus.close();

      const outbound = parseOutboundAgentResponse(
        response,
        path.resolve(this.config.rootDir, activeAgent.path),
      );
      const assistantLog = buildAssistantLogContent(
        outbound.text,
        outbound.files,
      );

      this.deps.appendConversation(inbound.chatId, {
        role: "assistant",
        content: assistantLog,
        at: nowIso(),
      });

      let sent = true;
      let sentAny = false;

      if (outbound.text) {
        const textSent = await this.sender(inbound.chatId, outbound.text, state, replyOptions);
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

      const responseText =
        outbound.text || summarizeOutboundFiles(outbound.files);

      return {
        ok: true,
        action: "agent_response",
        response: responseText,
        sent,
      };
    } catch (error) {
      await progressQueue.catch(() => undefined);
      await liveStatus.close();
      const response = buildAgentFailureMessage(
        error,
        progressState.lastMeaningfulMessage,
      );
      if (appendedUserTurn) {
        this.deps.appendConversation(inbound.chatId, {
          role: "assistant",
          content: buildAssistantRecoveryLog(
            error,
            activeAgent.provider,
            this.config.providerCliTimeoutMs,
            progressState.lastMeaningfulMessage,
          ),
          at: nowIso(),
        });
      }
      logAgentFailure(inbound.chatId, activeAgent.provider, error);
      const sent = await safeSendTelegramMessage(
        this.sender,
        inbound.chatId,
        response,
        state,
        replyOptions,
      );
      return {
        ok: false,
        action: "agent_error",
        response,
        sent,
      };
    } finally {
      stopTyping?.();
    }
  }

  private tryHandleManagementCommand(
    inbound: TelegramInbound,
    state: OpenColabState,
  ): ManagementCommandResult | null {
    if (inbound.kind === "callback_query") {
      return this.tryHandleManagementCallback(inbound, state);
    }

    const text = normalizeManagementInput(inbound.commandText);
    if (!text.startsWith("/")) {
      return null;
    }

    const tokens = text.split(/\s+/);
    const scope = normalizeCommandToken(tokens[0]).toLowerCase();

    if (scope === "/projects") {
      return this.renderProjectPicker(state);
    }

    if (scope === "/agents") {
      return this.renderAgentPicker(getActiveProject(state));
    }

    if (scope === "/session_reset") {
      const sessionId = this.deps.resetConversationSession();
      return {
        response: `Session reset. New session: ${sessionId}`,
      };
    }

    return {
      response: SUPPORTED_TELEGRAM_COMMANDS_TEXT,
    };
  }

  private tryHandleManagementCallback(
    inbound: TelegramInbound,
    state: OpenColabState,
  ): ManagementCommandResult {
    const callbackData = String(inbound.callbackData ?? "").trim();
    const [scope, action, value] = callbackData.split(":");

    if (callbackData === "ui:cancel") {
      return {
        response: "Selection cancelled.",
        callbackAnswerText: "Selection cancelled.",
      };
    }

    if (scope === "prj" && action === "use" && value) {
      return this.selectProject(state, value, "Project selected.");
    }

    if (scope === "agt" && action === "use" && value) {
      return this.selectAgent(state, value, "Agent selected.");
    }

    return {
      response: "Unknown Telegram button action.",
      callbackAnswerText: "Unknown action.",
    };
  }

  private selectProject(
    state: OpenColabState,
    projectIdRaw: string,
    callbackAnswerText: string,
  ): ManagementCommandResult {
    const projectId = normalizeEntityId(projectIdRaw);
    const target = state.projects[projectId];
    if (!target) {
      return {
        response: `Unknown project: ${projectId}`,
        callbackAnswerText: "Unknown project.",
      };
    }

    const nextState = ensureProjectAndAgent({
      ...state,
      activeProjectId: projectId,
    });

    const activeAgent =
      target.agents[target.activeAgentId] ??
      Object.values(target.agents)[0];
    if (activeAgent) {
      ensureAgentFiles(this.config.rootDir, activeAgent);
    }

    return {
      nextState,
      response: `Active project: ${projectId}`,
      callbackAnswerText,
    };
  }

  private selectAgent(
    state: OpenColabState,
    agentIdRaw: string,
    callbackAnswerText: string,
  ): ManagementCommandResult {
    const project = getActiveProject(state);
    const agentId = normalizeEntityId(agentIdRaw);
    if (!project.agents[agentId]) {
      return {
        response: `Unknown agent in project '${project.id}': ${agentId}`,
        callbackAnswerText: "Unknown agent.",
      };
    }

    const nextState = ensureProjectAndAgent({
      ...state,
      projects: {
        ...state.projects,
        [project.id]: {
          ...project,
          activeAgentId: agentId,
        },
      },
    });

    ensureAgentFiles(this.config.rootDir, project.agents[agentId]);

    return {
      nextState,
      response: `Active agent: ${agentId} (project ${project.id})`,
      callbackAnswerText,
    };
  }

  private renderProjectPicker(state: OpenColabState): ManagementCommandResult {
    const entries = Object.values(state.projects).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const lines = entries.map((project) => {
      const marker = project.id === state.activeProjectId ? "*" : "-";
      return `${marker} ${project.id} (active agent: ${project.activeAgentId})`;
    });

    return {
      response: [
        `Projects (${entries.length})`,
        `Current: ${state.activeProjectId}`,
        "Tap a project to switch.",
        "",
        ...lines,
      ].join("\n"),
      options: {
        inlineKeyboard: [
          ...chunkInlineButtons(
            entries.map((project) => ({
              text:
                project.id === state.activeProjectId
                  ? `* ${project.id}`
                  : project.id,
              callbackData: `prj:use:${project.id}`,
            })),
          ),
          [{ text: "Cancel", callbackData: "ui:cancel" }],
        ],
      },
    };
  }

  private renderAgentPicker(
    project: OpenColabState["projects"][string],
  ): ManagementCommandResult {
    const entries = Object.values(project.agents).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const lines = entries.map((agent) => {
      const marker = agent.id === project.activeAgentId ? "*" : "-";
      return `${marker} ${agent.id} [${agent.provider.name}:${agent.provider.model}]`;
    });

    return {
      response: [
        `Agents in ${project.id} (${entries.length})`,
        `Current: ${project.activeAgentId}`,
        "Tap an agent to switch.",
        "",
        ...lines,
      ].join("\n"),
      options: {
        inlineKeyboard: [
          ...chunkInlineButtons(
            entries.map((agent) => ({
              text:
                agent.id === project.activeAgentId
                  ? `* ${agent.id}`
                  : agent.id,
              callbackData: `agt:use:${agent.id}`,
            })),
          ),
          [{ text: "Cancel", callbackData: "ui:cancel" }],
        ],
      },
    };
  }

  private startTypingFeedback(
    chatId: string,
    state: OpenColabState,
  ): () => void {
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

  private async sendProgressUpdate(
    event: TaskProgressEvent,
    requestState: RequestProgressState,
    liveStatus: TelegramLiveStatusSession,
  ): Promise<void> {
    const message = normalizeProgressMessage(event.message);
    if (!message) {
      return;
    }

    if (event.kind !== "progress") {
      requestState.lastMeaningfulMessage = message;
    }
    await liveStatus.push({
      ...event,
      message,
    });
  }
}

async function safeSendTelegramMessage(
  sender: TelegramSender,
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  try {
    return await sender(chatId, text, state, options);
  } catch {
    return false;
  }
}

async function safeSendTelegramDraft(
  sender: TelegramDraftSender,
  chatId: string,
  draftId: number,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  try {
    return await sender(chatId, draftId, text, state, options);
  } catch {
    return false;
  }
}

async function safeCreateTelegramStatusMessage(
  creator: TelegramStatusMessageCreator,
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<string | null> {
  try {
    return await creator(chatId, text, state, options);
  } catch {
    return null;
  }
}

async function safeEditTelegramMessage(
  editor: TelegramMessageEditor,
  chatId: string,
  messageId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  try {
    return await editor(chatId, messageId, text, state, options);
  } catch {
    return false;
  }
}

async function safeAnswerTelegramCallback(
  answerer: TelegramCallbackAnswerer,
  callbackQueryId: string,
  text: string | undefined,
  state: OpenColabState,
): Promise<boolean> {
  try {
    return await answerer(callbackQueryId, text, state);
  } catch {
    return false;
  }
}

function buildAgentFailureMessage(
  error: unknown,
  lastProgressMessage?: string | null,
): string {
  const fallback =
    "OpenColab could not complete your request due to a provider/runtime error. Check the gateway logs and retry.";
  const detail =
    error instanceof Error
      ? error.message.trim()
      : String(error ?? "").trim();
  if (!detail) {
    return fallback;
  }
  const lastProgress = normalizeProgressMessage(lastProgressMessage ?? "");
  const withProgress =
    lastProgress && !detail.includes(lastProgress)
      ? `${detail}\nLast progress: ${lastProgress}`
      : detail;
  if (withProgress.length <= MAX_TELEGRAM_ERROR_CHARS) {
    return withProgress;
  }
  return `${withProgress.slice(0, MAX_TELEGRAM_ERROR_CHARS - 3)}...`;
}

function buildAssistantRecoveryLog(
  error: unknown,
  provider: ProviderConfig,
  timeoutMs: number,
  lastProgressMessage?: string | null,
): string {
  const lines: string[] = [];
  const providerLabel = `${provider.name}/${provider.model}`;
  const lastProgress = truncateForRecovery(normalizeProgressMessage(lastProgressMessage ?? ""), 220);

  if (isProviderTimeoutError(error)) {
    lines.push(
      `Previous attempt timed out after ${formatTimeoutForRecovery(timeoutMs)} using ${providerLabel}.`
    );
    if (lastProgress) {
      lines.push(`Last progress: ${lastProgress}`);
    }
    lines.push("Next action: resume from the last completed stage or narrow the task before retrying.");
    return lines.join("\n");
  }

  const detail = truncateForRecovery(
    error instanceof Error ? error.message : String(error ?? ""),
    220
  );
  lines.push(`Previous attempt failed using ${providerLabel}.`);
  if (detail) {
    lines.push(`Failure: ${detail}`);
  }
  if (lastProgress) {
    lines.push(`Last progress: ${lastProgress}`);
  }
  lines.push("Next action: address the runtime issue and retry from the last known stage.");
  return lines.join("\n");
}

function createRequestProgressState(): RequestProgressState {
  return {
    lastMeaningfulMessage: null,
  };
}

function normalizeProgressMessage(value: string): string {
  return String(value ?? "").trim();
}

function isProviderTimeoutError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return /\bcli timed out\b/i.test(detail);
}

function formatTimeoutForRecovery(timeoutMs: number): string {
  if (timeoutMs > 0 && timeoutMs % 60_000 === 0) {
    return `${String(timeoutMs / 60_000)}m`;
  }
  if (timeoutMs > 0 && timeoutMs % 1_000 === 0) {
    return `${String(timeoutMs / 1_000)}s`;
  }
  return `${String(timeoutMs)}ms`;
}

function truncateForRecovery(value: string, limit: number): string {
  const normalized = normalizeProgressMessage(value);
  if (!normalized || normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(limit - 3, 0))}...`;
}

function truncateTelegramCallbackText(value: string): string {
  const normalized = normalizeProgressMessage(value);
  if (!normalized || normalized.length <= MAX_TELEGRAM_CALLBACK_TEXT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TELEGRAM_CALLBACK_TEXT_CHARS - 3)}...`;
}

function resolveProgressSlot(event: TaskProgressEvent): string {
  return (
    normalizeProgressMessage(event.slot ?? "") ||
    normalizeProgressMessage(event.stage ?? "") ||
    event.kind
  );
}

function logAgentFailure(
  chatId: string,
  provider: ProviderConfig,
  error: unknown,
): void {
  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  console.error(
    `[opencolab:telegram:error] chat=${chatId} provider=${provider.name} model=${provider.model} ${detail}`,
  );
}

async function postTelegramJson(
  method: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const token = resolveTelegramBotToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = await response.json().catch(() => null);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractTelegramMessageId(response: Record<string, unknown> | null): string | null {
  const result = asRecord(response?.result);
  if (!result) {
    return null;
  }

  const messageId = result.message_id;
  if (typeof messageId === "number" && Number.isFinite(messageId)) {
    return String(messageId);
  }
  if (typeof messageId === "string" && messageId.trim()) {
    return messageId.trim();
  }
  return null;
}

export async function defaultTelegramSender(
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  const messageId = await defaultTelegramStatusMessageCreator(chatId, text, state, options);
  return Boolean(messageId);
}

export async function defaultTelegramDraftSender(
  chatId: string,
  draftId: number,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  void state;
  const response = await postTelegramJson("sendMessageDraft", {
    chat_id: chatId,
    draft_id: draftId,
    text,
    ...(options?.messageThreadId ? { message_thread_id: Number(options.messageThreadId) } : {}),
  });
  return response !== null;
}

export async function defaultTelegramStatusMessageCreator(
  chatId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<string | null> {
  void state;
  const response = await postTelegramJson("sendMessage", {
    chat_id: chatId,
    text,
    ...(options?.messageThreadId ? { message_thread_id: Number(options.messageThreadId) } : {}),
    ...(options?.inlineKeyboard
      ? {
          reply_markup: {
            inline_keyboard: options.inlineKeyboard.map((row) =>
              row.map((button) => ({
                text: button.text,
                callback_data: button.callbackData,
              })),
            ),
          },
        }
      : {}),
  });
  return extractTelegramMessageId(response);
}

export async function defaultTelegramMessageEditor(
  chatId: string,
  messageId: string,
  text: string,
  state: OpenColabState,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  void state;
  void options;
  const response = await postTelegramJson("editMessageText", {
    chat_id: chatId,
    message_id: Number(messageId),
    text,
  });
  return response !== null;
}

export async function defaultTelegramCallbackAnswerer(
  callbackQueryId: string,
  text: string | undefined,
  state: OpenColabState,
): Promise<boolean> {
  void state;
  const token = resolveTelegramBotToken();
  if (!token) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          ...(text ? { text: truncateTelegramCallbackText(text) } : {}),
        }),
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}

export async function defaultTelegramTypingSender(
  chatId: string,
  state: OpenColabState,
): Promise<boolean> {
  void state;
  return (await postTelegramJson("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  })) !== null;
}

export async function defaultTelegramFileSender(
  chatId: string,
  file: TelegramOutboundFile,
  state: OpenColabState,
): Promise<boolean> {
  void state;
  const token = resolveTelegramBotToken();
  if (!token) {
    return false;
  }

  const method = resolveTelegramFileMethod(file.kind);
  const fileField = resolveTelegramFileField(file.kind);
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const isLocalFile =
    file.file.startsWith("/") && fs.existsSync(file.file);

  try {
    let response: Response;

    if (isLocalFile) {
      const fileBytes = fs.readFileSync(file.file);
      const fileName = path.basename(file.file);
      const blob = new Blob([fileBytes]);
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(fileField, blob, fileName);
      if (file.caption && supportsCaption(file.kind)) {
        form.append("caption", file.caption);
      }
      response = await fetch(url, { method: "POST", body: form });
    } else {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        [fileField]: file.file,
      };
      if (file.caption && supportsCaption(file.kind)) {
        payload.caption = file.caption;
      }
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

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

  const callbackQuery = asRecord(root.callback_query);
  if (callbackQuery) {
    const callbackMessage = asRecord(callbackQuery.message);
    const callbackChat = asRecord(callbackMessage?.chat);
    const callbackData = String(callbackQuery.data ?? "").trim();
    if (
      !callbackMessage ||
      !callbackChat ||
      callbackChat.id === undefined ||
      callbackChat.id === null ||
      !callbackData
    ) {
      return null;
    }

    return {
      kind: "callback_query",
      chatId: String(callbackChat.id),
      chatType: parseChatType(callbackChat),
      sender: parseSender(asRecord(callbackQuery.from)),
      commandText: "",
      text: "",
      files: [],
      messageThreadId: asOptionalString(callbackMessage.message_thread_id),
      callbackQueryId: String(callbackQuery.id ?? "").trim() || undefined,
      callbackData,
      callbackMessageId:
        callbackMessage.message_id === undefined ||
        callbackMessage.message_id === null
          ? undefined
          : String(callbackMessage.message_id),
    };
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
    kind: "message",
    chatId: String(chat.id),
    chatType: parseChatType(chat),
    sender: parseSender(asRecord(message.from)),
    commandText: text,
    text,
    files,
    messageThreadId: asOptionalString(message.message_thread_id),
  };
}

function parseChatType(chat: Record<string, unknown>): TelegramInbound["chatType"] {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function normalizeEntityId(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Identifier is required.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid identifier '${trimmed}'. Use only letters, numbers, underscore, or hyphen.`,
    );
  }

  return trimmed;
}

function normalizeManagementInput(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("/")) {
    return text;
  }

  const tokens = text.split(/\s+/);
  const scope = normalizeCommandToken(tokens[0]).toLowerCase();
  const rest = tokens.slice(1).join(" ").trim();
  return [scope, rest].filter(Boolean).join(" ").trim();
}

function normalizeCommandToken(token: string | undefined): string {
  if (!token) {
    return "";
  }

  return token.split("@")[0] ?? token;
}

function chunkInlineButtons(
  buttons: TelegramInlineButton[],
  size = 2,
): TelegramInlineButton[][] {
  const rows: TelegramInlineButton[][] = [];
  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }
  return rows;
}

function parseInboundFiles(
  message: Record<string, unknown>,
): TelegramFilePayload[] {
  const payloads: TelegramFilePayload[] = [];
  const caption = asStringValue(message.caption);

  const document = asRecord(message.document);
  if (document) {
    const payload = buildFilePayload("document", document, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const audio = asRecord(message.audio);
  if (audio) {
    const payload = buildFilePayload("audio", audio, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const video = asRecord(message.video);
  if (video) {
    const payload = buildFilePayload("video", video, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const voice = asRecord(message.voice);
  if (voice) {
    const payload = buildFilePayload("voice", voice, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const videoNote = asRecord(message.video_note);
  if (videoNote) {
    const payload = buildFilePayload("video_note", videoNote, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const animation = asRecord(message.animation);
  if (animation) {
    const payload = buildFilePayload("animation", animation, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const sticker = asRecord(message.sticker);
  if (sticker) {
    const payload = buildFilePayload("sticker", sticker, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  const photos = Array.isArray(message.photo)
    ? message.photo.map(asRecord).filter(Boolean)
    : [];
  const bestPhoto = photos[photos.length - 1];
  if (bestPhoto) {
    const payload = buildFilePayload("photo", bestPhoto, caption);
    if (payload) {
      payloads.push(payload);
    }
  }

  return payloads;
}

function buildFilePayload(
  kind: TelegramFileKind,
  source: Record<string, unknown>,
  caption?: string | null,
): TelegramFilePayload | null {
  const fileId = asStringValue(source.file_id);
  if (!fileId) {
    return null;
  }

  const payload: TelegramFilePayload = {
    kind,
    fileId,
    ...(caption ? { caption } : {}),
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

function buildInboundText(
  baseText: string,
  files: TelegramFilePayload[],
): string {
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
          (file.telegramFilePath
            ? ` telegram_path=${file.telegramFilePath}`
            : "") +
          (file.localPath
            ? ` local_path=${JSON.stringify(file.localPath)}`
            : "") +
          (file.fileSize !== undefined
            ? ` file_size=${String(file.fileSize)}`
            : ""),
      );
    });
  }

  return lines.join("\n").trim();
}

function parseOutboundAgentResponse(raw: string, localBaseDir: string): {
  text: string;
  files: TelegramOutboundFile[];
} {
  const lines = raw.split(/\r?\n/);
  const remaining: string[] = [];
  const files: TelegramOutboundFile[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const payloadRaw = extractTelegramFilePayload(trimmed);
    if (!payloadRaw) {
      remaining.push(line);
      continue;
    }

    try {
      const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
      const file = normalizeOutboundFile(payload, localBaseDir);
      if (file) {
        files.push(file);
      }
    } catch {
      remaining.push(line);
    }
  }

  return {
    text: remaining.join("\n").trim(),
    files,
  };
}

function normalizeOutboundFile(
  source: Record<string, unknown>,
  localBaseDir: string,
): TelegramOutboundFile | null {
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
    file: resolveOutboundFileReference(file, localBaseDir),
    ...(caption ? { caption } : {}),
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

function buildAssistantLogContent(
  text: string,
  files: TelegramOutboundFile[],
): string {
  if (files.length === 0) {
    return text;
  }

  const lines: string[] = [];
  if (text) {
    lines.push(text);
  }
  files.forEach((file) => {
    lines.push(
      `@telegram-file ${JSON.stringify({ kind: file.kind, file: file.file, ...(file.caption ? { caption: file.caption } : {}) })}`,
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

function resolveOutboundFileReference(value: string, localBaseDir: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return trimmed;
  }

  const candidate = path.resolve(localBaseDir, trimmed);
  return fs.existsSync(candidate) ? candidate : trimmed;
}

function extractTelegramFilePayload(trimmed: string): string | null {
  const normalized = unwrapInlineCode(trimmed);
  if (!normalized.startsWith("@telegram-file")) {
    return null;
  }

  const payloadRaw = normalized.slice("@telegram-file".length).trim();
  return payloadRaw || null;
}

function unwrapInlineCode(value: string): string {
  if (value.startsWith("`") && value.endsWith("`") && value.length >= 2) {
    return value.slice(1, -1).trim();
  }
  return value;
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

async function resolveInboundFiles(
  config: OpenColabConfig,
  projectPath: string,
  files: TelegramFilePayload[],
): Promise<TelegramFilePayload[]> {
  if (files.length === 0) {
    return [];
  }

  const token = resolveTelegramBotToken();
  if (!token) {
    return files;
  }

  const projectDir = path.isAbsolute(projectPath)
    ? projectPath
    : path.join(config.rootDir, projectPath);
  const inboxDir = path.join(
    projectDir,
    "memory",
    "TelegramInbox",
    new Date().toISOString().slice(0, 10),
  );
  ensureDir(inboxDir);

  const resolved: TelegramFilePayload[] = [];
  for (const file of files) {
    resolved.push(await resolveInboundFile(token, inboxDir, file));
  }

  return resolved;
}

async function resolveInboundFile(
  token: string,
  inboxDir: string,
  file: TelegramFilePayload,
): Promise<TelegramFilePayload> {
  let telegramFilePath: string | null = null;

  try {
    telegramFilePath = await fetchTelegramFilePath(token, file.fileId);
    if (!telegramFilePath) {
      return file;
    }

    const localPath = path.join(
      inboxDir,
      buildLocalFileName(file, telegramFilePath),
    );

    if (!fs.existsSync(localPath)) {
      const bytes = await downloadTelegramFile(token, telegramFilePath);
      if (!bytes) {
        return {
          ...file,
          telegramFilePath,
        };
      }

      fs.writeFileSync(localPath, bytes);
    }

    return {
      ...file,
      telegramFilePath,
      localPath,
    };
  } catch {
    return telegramFilePath
      ? {
          ...file,
          telegramFilePath,
        }
      : file;
  }
}

async function fetchTelegramFilePath(
  token: string,
  fileId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    file_id: fileId,
  });
  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${token}/getFile?${params.toString()}`,
    TELEGRAM_FILE_FETCH_TIMEOUT_MS,
  );
  if (!response || !response.ok) {
    return null;
  }

  const body = (await response.json()) as Record<string, unknown>;
  if (body.ok !== true) {
    return null;
  }

  return asStringValue(asRecord(body.result)?.file_path);
}

async function downloadTelegramFile(
  token: string,
  telegramFilePath: string,
): Promise<Buffer | null> {
  const response = await fetchWithTimeout(
    `https://api.telegram.org/file/bot${token}/${telegramFilePath}`,
    TELEGRAM_FILE_FETCH_TIMEOUT_MS,
  );
  if (!response || !response.ok) {
    return null;
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

function buildLocalFileName(
  file: TelegramFilePayload,
  telegramFilePath: string,
): string {
  const extension = resolveLocalFileExtension(file, telegramFilePath);
  const identity = sanitizeFileStem(file.fileUniqueId ?? file.fileId);
  const stem = sanitizeFileStem(
    file.fileName
      ? `${path.basename(file.fileName, path.extname(file.fileName))}__${identity}`
      : `${file.kind}-${identity}`,
  );
  return `${stem}${extension}`;
}

function resolveLocalFileExtension(
  file: TelegramFilePayload,
  telegramFilePath: string,
): string {
  const preferredPath = file.fileName?.trim() || telegramFilePath.trim();
  const extension = path.extname(preferredPath);
  if (extension) {
    return extension.toLowerCase();
  }

  switch (file.kind) {
    case "photo":
      return ".jpg";
    case "audio":
      return ".mp3";
    case "video":
      return ".mp4";
    case "voice":
      return ".ogg";
    case "video_note":
      return ".mp4";
    case "animation":
      return ".gif";
    case "sticker":
      return ".webp";
    case "document":
    default:
      return ".bin";
  }
}

function sanitizeFileStem(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized || "telegram_file";
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
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
