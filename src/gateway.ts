/**
 * Telegram gateway and routing logic.
 * Resolves the inbound bot to its bound project/agent, enforces per-bot pairing and
 * authorization, handles management commands, and forwards user input to that agent.
 *
 * Every Telegram API call carries an explicit TelegramBotContext. Nothing in this module
 * resolves a bot token from ambient process state, so one bot can never borrow another's
 * token or deliver into another bot's chat.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  getTelegramBot,
} from "./project-config.js";
import type {
  AgentConfig,
  AgentMemoryContext,
  ConversationMessage,
  GatewayResult,
  OpenColabState,
  ProjectState,
  ProviderConfig,
  TaskProgressEvent,
  TelegramBotProfile,
  TelegramChatType,
  TelegramFileKind,
  TelegramFilePayload,
  TelegramInbound,
  TelegramInlineButton,
  TelegramMessageOptions,
  TelegramOutboundFile,
} from "./types.js";
import { ensureDir, nowIso, randomDigits } from "./utils.js";

/**
 * One resolved Telegram bot identity plus its secret, passed to every outbound call.
 * `token` is always the token stored under `profile.tokenEnvVar`.
 */
export interface TelegramBotContext {
  botId: string;
  token: string;
  profile: TelegramBotProfile;
}

/** Where an inbound update came from. The botId comes from the transport, never the payload. */
export interface TelegramUpdateSource {
  botId: string;
}

/** The project/agent pair an inbound message routes to. */
export interface TelegramRoutingTarget {
  project: ProjectState;
  agent: AgentConfig;
}

export type TelegramSender = (
  chatId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramDraftSender = (
  chatId: string,
  draftId: number,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramStatusMessageCreator = (
  chatId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
) => Promise<string | null>;

export type TelegramMessageEditor = (
  chatId: string,
  messageId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
) => Promise<boolean>;

export type TelegramTypingSender = (
  chatId: string,
  ctx: TelegramBotContext,
) => Promise<boolean>;
export type TelegramFileSender = (
  chatId: string,
  file: TelegramOutboundFile,
  ctx: TelegramBotContext,
) => Promise<boolean>;

export type TelegramCallbackAnswerer = (
  callbackQueryId: string,
  text: string | undefined,
  ctx: TelegramBotContext,
) => Promise<boolean>;

interface GatewayDependencies {
  getState: () => OpenColabState;
  saveState: (next: OpenColabState) => void;
  /** Reads the token stored under the profile's env var. Never falls back to another bot. */
  resolveBotToken: (profile: TelegramBotProfile) => string | null;
  readConversationMemory: (
    target: TelegramRoutingTarget,
    limit: number,
  ) => AgentMemoryContext;
  appendConversation: (
    target: TelegramRoutingTarget,
    message: ConversationMessage,
  ) => void;
  resetConversationSession: (target: TelegramRoutingTarget) => string;
  onAgentTurnStarted?: (projectId: string, agentId: string) => void | Promise<void>;
  onAgentTurnFinished?: (
    projectId: string,
    agentId: string,
    outcome: "completed" | "stopped" | "timed_out" | "failed"
  ) => void | Promise<void>;
  respond: (
    target: TelegramRoutingTarget,
    input: ProviderAgentInput,
    options?: ProviderRespondOptions,
  ) => Promise<string>;
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
  telegramCallbackAnswerer?: TelegramCallbackAnswerer;
  /** @deprecated live status now uses persistent editable messages in all chat types. */
  telegramDraftSender?: TelegramDraftSender;
  telegramStatusMessageCreator?: TelegramStatusMessageCreator;
  telegramMessageEditor?: TelegramMessageEditor;
}
const TELEGRAM_FILE_FETCH_TIMEOUT_MS = 10_000;
const MAX_TELEGRAM_ERROR_CHARS = 1_500;
const MAX_TELEGRAM_CALLBACK_TEXT_CHARS = 180;
const MAX_TELEGRAM_TEXT_CHARS = 4_000;
const EDITABLE_STATUS_THROTTLE_MS = 3_000;
const MAX_LIVE_STATUS_LINES = 5;
const STOPPED_TASK_CONFIRMATION_TEXT = [
  "Stopped the current task.",
  "Saved the latest progress so you can ask me to continue later.",
].join("\n");

interface ManagementCommandResult {
  nextState?: OpenColabState;
  response: string;
  options?: TelegramMessageOptions;
  callbackAnswerText?: string;
}

interface RequestProgressState {
  lastMeaningfulMessage: string | null;
}

interface ActiveRequest {
  projectId: string;
  agentId: string;
  provider: ProviderConfig;
  progressState: RequestProgressState;
  liveStatus: TelegramLiveStatusSession;
  abortController: AbortController;
  stopRequested: boolean;
  recoveryLogged: boolean;
  turnFinished: boolean;
}

export interface HeartbeatLiveStatusSession {
  readonly signal: AbortSignal;
  readonly stopRequested: boolean;
  readonly lastMeaningfulMessage: string | null;
  onProgress(event: TaskProgressEvent): Promise<void>;
  close(): Promise<void>;
}

interface LiveStatusLine {
  slot: string;
  message: string;
  kind: TaskProgressEvent["kind"];
  updatedAt: number;
}

// Live status uses durable Telegram messages for every chat type so the history remains after completion.
type LiveStatusTransport = "editable" | "disabled";

export interface TelegramLiveStatusContext {
  messageThreadId?: string;
  /** Optional override for the heading; defaults to the activity-kind based heading. */
  heading?: string;
}

export class TelegramLiveStatusSession {
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
    private readonly ctx: TelegramBotContext,
    private readonly inbound: TelegramLiveStatusContext,
    private readonly statusMessageCreator: TelegramStatusMessageCreator,
    private readonly messageEditor: TelegramMessageEditor,
  ) {}

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
    if (!force && rendered === this.lastRenderedText) {
      return;
    }
    if (!force && this.activated && now - this.lastSentAt < EDITABLE_STATUS_THROTTLE_MS) {
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
    const latestIndex = visibleLines.length - 1;
    const latestKind = visibleLines[visibleLines.length - 1]?.kind ?? "started";
    const heading =
      this.inbound.heading ??
      (latestKind === "warning"
        ? "Attention needed"
        : latestKind === "needs_input"
          ? "Need input"
          : latestKind === "completed"
            ? "Finalizing"
            : "Agent activity");

    return [
      heading,
      "",
      ...visibleLines.map((line, index) => `${index === latestIndex ? "🟢" : "⚪"} ${line.message}`),
    ].join("\n");
  }

  private async send(text: string): Promise<boolean> {
    const options = this.inbound.messageThreadId
      ? { messageThreadId: this.inbound.messageThreadId }
      : undefined;

    if (this.transport === "editable") {
      if (!this.editableMessageId) {
        return false;
      }
      return safeEditTelegramMessage(
        this.messageEditor,
        this.chatId,
        this.editableMessageId,
        text,
        this.ctx,
        options,
      );
    }

    const messageId = await safeCreateTelegramStatusMessage(
      this.statusMessageCreator,
      this.chatId,
      text,
      this.ctx,
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

  private maxLineCount(): number {
    return MAX_LIVE_STATUS_LINES;
  }

  private resolveSlot(event: TaskProgressEvent): string {
    return resolveProgressSlot(event);
  }
}

export class TelegramGateway {
  private readonly sender: TelegramSender;
  private readonly statusMessageCreator: TelegramStatusMessageCreator;
  private readonly messageEditor: TelegramMessageEditor;
  private readonly typingSender: TelegramTypingSender;
  private readonly fileSender: TelegramFileSender;
  private readonly callbackAnswerer: TelegramCallbackAnswerer;
  private readonly activeRequests = new Map<string, ActiveRequest>();
  private readonly laneQueues = new Map<string, Promise<void>>();
  // One agent never runs two provider turns at once: Telegram, web chat, and heartbeat all
  // write the same memory/Session files, and multi-bot traffic makes the overlap likely.
  private readonly agentQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly config: OpenColabConfig,
    private readonly deps: GatewayDependencies,
  ) {
    this.sender = deps.telegramSender ?? defaultTelegramSender;
    this.statusMessageCreator =
      deps.telegramStatusMessageCreator ?? defaultTelegramStatusMessageCreator;
    this.messageEditor = deps.telegramMessageEditor ?? defaultTelegramMessageEditor;
    this.typingSender =
      deps.telegramTypingSender ?? defaultTelegramTypingSender;
    this.fileSender = deps.telegramFileSender ?? defaultTelegramFileSender;
    this.callbackAnswerer =
      deps.telegramCallbackAnswerer ?? defaultTelegramCallbackAnswerer;
  }

  /**
   * Resolves one enabled bot plus its token. Never falls back to another bot: a
   * misconfiguration must stay visible instead of delivering into the wrong chat.
   */
  resolveBotContext(
    state: OpenColabState,
    botId: string,
  ): BotContextResolution {
    const profile = getTelegramBot(state, botId);
    if (!profile) {
      return {
        ok: false,
        result: {
          ok: false,
          action: "unknown_bot",
          response: `Unknown Telegram bot: ${botId}`,
          sent: false,
        },
      };
    }

    if (!profile.enabled) {
      return {
        ok: false,
        result: {
          ok: false,
          action: "unknown_bot",
          response: `Telegram bot '${botId}' is disabled.`,
          sent: false,
        },
      };
    }

    const token = this.deps.resolveBotToken(profile);
    if (!token) {
      logTokenMissing(profile);
      return {
        ok: false,
        result: {
          ok: false,
          action: "token_missing",
          response: `Telegram bot '${botId}' has no token in ${profile.tokenEnvVar}.`,
          sent: false,
        },
      };
    }

    return { ok: true, ctx: { botId: profile.id, token, profile } };
  }

  /**
   * Resolves which project/agent answers for a bot.
   * Pinned bots use their binding; floating bots keep the legacy behavior of following
   * the globally active project.
   */
  resolveRoutingTarget(
    state: OpenColabState,
    profile: TelegramBotProfile,
  ): RoutingResolution {
    if (profile.scope === "floating") {
      const project = getActiveProject(state);
      if (Object.keys(project.agents).length === 0) {
        return {
          ok: false,
          message: `Project '${project.id}' has no agents yet. Create one with 'opencolab agent create'.`,
        };
      }
      return { ok: true, target: { project, agent: getProjectActiveAgent(project) } };
    }

    if (!profile.projectId) {
      return {
        ok: false,
        message: [
          "This bot is not bound to a project yet.",
          `Bind it with: opencolab telegram bot bind --id ${profile.id} --project <project_id>`,
        ].join("\n"),
      };
    }

    const project = state.projects[profile.projectId];
    if (!project) {
      return {
        ok: false,
        message: [
          `This bot is bound to project '${profile.projectId}', which no longer exists.`,
          `Rebind it with: opencolab telegram bot bind --id ${profile.id} --project <project_id>`,
        ].join("\n"),
      };
    }

    if (Object.keys(project.agents).length === 0) {
      return {
        ok: false,
        message: `Project '${project.id}' has no agents yet. Create one with 'opencolab agent create'.`,
      };
    }

    if (profile.agentId) {
      const pinned = project.agents[profile.agentId];
      if (pinned) {
        return { ok: true, target: { project, agent: pinned } };
      }
      // One-turn fallback. The profile is left alone so the operator sees what broke.
      const fallback = getProjectActiveAgent(project);
      return {
        ok: true,
        target: { project, agent: fallback },
        note: `Agent '${profile.agentId}' is no longer in project '${project.id}'. Using '${fallback.id}' for this message.`,
      };
    }

    return { ok: true, target: { project, agent: getProjectActiveAgent(project) } };
  }

  async startPairing(botId: string): Promise<{
    botId: string;
    code: string;
    expiresAt: string;
    sent: boolean;
  }> {
    const state = ensureProjectAndAgent(this.deps.getState());
    const profile = getTelegramBot(state, botId);
    if (!profile) {
      throw new Error(`Unknown Telegram bot: ${botId}`);
    }

    const token = this.deps.resolveBotToken(profile);
    if (!token) {
      throw new Error(
        `Telegram bot '${botId}' has no token in ${profile.tokenEnvVar}. Re-add it with 'opencolab telegram bot add'.`,
      );
    }

    if (!profile.chatId) {
      throw new Error(
        `Telegram bot '${botId}' has no chat id yet. Message the bot once so it can be detected, or set one with 'opencolab setup telegram --chat-id <id>'.`,
      );
    }

    const code = randomDigits(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const next = withBotProfile(state, botId, {
      paired: false,
      pairedAt: null,
      pendingPairingCode: code,
      pendingPairingExpiresAt: expiresAt,
    });

    this.deps.saveState(next);

    const ctx: TelegramBotContext = {
      botId,
      token,
      profile: next.telegramBots[botId] ?? profile,
    };
    const sent = await this.sender(
      profile.chatId,
      [
        "Welcome to OpenColab Pairing! ✨",
        "You've unlocked the first step of your research adventure! 🌊🐙",
        `🔑 Code: ${code}`,
        ` or run: opencolab telegram bot pair --id ${botId} complete --code ${code}`,
        "⏰ Code valid for 10 minutes. Let’s dive in!",
      ].join("\n"),
      ctx,
    );

    if (!sent) {
      throw new Error(
        `Could not send the pairing code through bot '${botId}'. Check that ${profile.tokenEnvVar} holds a valid token.`,
      );
    }

    return { botId, code, expiresAt, sent };
  }

  completePairing(botId: string, code: string): { botId: string; pairedAt: string } {
    const state = ensureProjectAndAgent(this.deps.getState());
    const profile = getTelegramBot(state, botId);
    if (!profile) {
      throw new Error(`Unknown Telegram bot: ${botId}`);
    }

    const pendingCode = profile.pendingPairingCode;
    const pendingExpiresAt = profile.pendingPairingExpiresAt;

    if (!pendingCode || !pendingExpiresAt) {
      throw new Error(
        `No active pairing code for bot '${botId}'. Run 'opencolab telegram bot pair --id ${botId} start' first.`,
      );
    }

    if (Date.parse(pendingExpiresAt) < Date.now()) {
      throw new Error("Pairing code expired. Start a new pairing request.");
    }

    if (String(code).trim() !== String(pendingCode).trim()) {
      throw new Error("Invalid pairing code.");
    }

    const pairedAt = nowIso();
    this.deps.saveState(
      withBotProfile(state, botId, {
        paired: true,
        pairedAt,
        pendingPairingCode: null,
        pendingPairingExpiresAt: null,
      }),
    );

    return { botId, pairedAt };
  }

  async handleWebhook(
    body: unknown,
    source: TelegramUpdateSource,
  ): Promise<GatewayResult> {
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
    const resolved = this.resolveBotContext(state, source.botId);
    if (!resolved.ok) {
      return resolved.result;
    }
    const ctx = resolved.ctx;

    if (!ctx.profile.chatId || inbound.chatId !== ctx.profile.chatId) {
      return {
        ok: false,
        action: "unauthorized_chat",
        response: "Unauthorized chat id",
        sent: false,
      };
    }

    if (!ctx.profile.paired) {
      const response = `Pairing required. Run 'opencolab telegram bot pair --id ${ctx.botId} start' in your terminal.`;
      const sent = await this.sender(inbound.chatId, response, ctx);
      return {
        ok: false,
        action: "pairing_required",
        response,
        sent,
      };
    }

    const laneKey = buildTelegramConversationLaneKey(
      ctx.botId,
      inbound.chatId,
      inbound.messageThreadId,
    );
    if (isStopCommand(inbound)) {
      return this.handleStopCommand(ctx, inbound, laneKey);
    }

    if (!isTelegramCommandLike(inbound)) {
      this.rememberTelegramTarget(ctx, inbound, state);
    }

    return this.runQueuedLane(laneKey, async () =>
      this.handleQueuedWebhook(ctx, inbound, laneKey),
    );
  }

  async sendHeartbeatDigest(
    ctx: TelegramBotContext,
    text: string,
  ): Promise<boolean> {
    const message = normalizeProgressMessage(text);
    if (!message) {
      return false;
    }

    if (!ctx.profile.chatId || !ctx.profile.paired) {
      return false;
    }

    const options = ctx.profile.lastMessageThreadId
      ? { messageThreadId: ctx.profile.lastMessageThreadId }
      : undefined;

    return safeSendTelegramMessage(
      this.sender,
      ctx.profile.chatId,
      message,
      ctx,
      options,
    );
  }

  openHeartbeatLiveStatus(
    ctx: TelegramBotContext,
    projectId: string,
    agentId: string,
    provider: ProviderConfig,
  ): HeartbeatLiveStatusSession | null {
    if (!ctx.profile.chatId || !ctx.profile.paired) {
      return null;
    }

    const messageThreadId = ctx.profile.lastMessageThreadId ?? undefined;
    const liveStatus = new TelegramLiveStatusSession(
      ctx.profile.chatId,
      ctx,
      { messageThreadId },
      this.statusMessageCreator,
      this.messageEditor,
    );
    const progressState = createRequestProgressState();
    const activeRequest = createActiveRequest(
      projectId,
      agentId,
      provider,
      progressState,
      liveStatus,
    );
    const laneKey = buildTelegramConversationLaneKey(
      ctx.botId,
      ctx.profile.chatId,
      messageThreadId,
    );
    this.activeRequests.set(laneKey, activeRequest);
    let progressQueue = Promise.resolve();

    return {
      get signal() {
        return activeRequest.abortController.signal;
      },
      get stopRequested() {
        return activeRequest.stopRequested;
      },
      get lastMeaningfulMessage() {
        return progressState.lastMeaningfulMessage;
      },
      onProgress: (event) => {
        if (activeRequest.stopRequested) {
          return progressQueue;
        }
        progressQueue = progressQueue
          .then(async () => this.sendProgressUpdate(event, progressState, liveStatus))
          .catch(() => undefined);
        return progressQueue;
      },
      close: async () => {
        await progressQueue.catch(() => undefined);
        await liveStatus.close();
        if (this.activeRequests.get(laneKey) === activeRequest) {
          this.activeRequests.delete(laneKey);
        }
      },
    };
  }

  private async handleQueuedWebhook(
    ctx: TelegramBotContext,
    inbound: TelegramInbound,
    laneKey: string,
  ): Promise<GatewayResult> {
    const state = ensureProjectAndAgent(this.deps.getState());
    // Re-read the profile: a CLI process may have rebound this bot while the lane queued.
    const profile = getTelegramBot(state, ctx.botId) ?? ctx.profile;
    const liveCtx: TelegramBotContext = { ...ctx, profile };
    const replyOptions = inbound.messageThreadId
      ? { messageThreadId: inbound.messageThreadId }
      : undefined;

    let commandResult: ManagementCommandResult | null = null;
    try {
      commandResult = this.tryHandleManagementCommand(liveCtx, inbound, state);
    } catch (error) {
      commandResult = {
        response: error instanceof Error ? error.message : String(error),
        callbackAnswerText: "Command failed.",
      };
    }
    if (commandResult) {
      return this.sendManagementCommandResult(liveCtx, inbound, commandResult);
    }

    const routing = this.resolveRoutingTarget(state, profile);
    if (!routing.ok) {
      const sent = await safeSendTelegramMessage(
        this.sender,
        inbound.chatId,
        routing.message,
        liveCtx,
        replyOptions,
      );
      return {
        ok: false,
        action: "routing_error",
        response: routing.message,
        sent,
      };
    }

    const target = routing.target;
    const { project, agent } = target;
    if (routing.note) {
      await safeSendTelegramMessage(
        this.sender,
        inbound.chatId,
        routing.note,
        liveCtx,
        replyOptions,
      );
    }

    const progressState = createRequestProgressState();
    const liveStatus = new TelegramLiveStatusSession(
      inbound.chatId,
      liveCtx,
      inbound,
      this.statusMessageCreator,
      this.messageEditor,
    );
    const activeRequest = createActiveRequest(
      project.id,
      agent.id,
      agent.provider,
      progressState,
      liveStatus,
    );
    // Registered before the agent queue is acquired so /stop can cancel a queued turn.
    this.activeRequests.set(laneKey, activeRequest);

    return this.runQueuedAgent(
      buildAgentLaneKey(project.id, agent.id),
      async () => {
        if (activeRequest.stopRequested) {
          if (this.activeRequests.get(laneKey) === activeRequest) {
            this.activeRequests.delete(laneKey);
          }
          return buildStoppedGatewayResult();
        }

        let stopTyping: (() => void) | null = null;
        let progressQueue = Promise.resolve();
        let appendedUserTurn = false;

        try {
          ensureAgentFiles(this.config.rootDir, agent);
          const memory = this.deps.readConversationMemory(target, 8);
          await this.deps.onAgentTurnStarted?.(project.id, agent.id);
          stopTyping = this.startTypingFeedback(inbound.chatId, liveCtx);
          const resolvedFiles = await resolveInboundFiles(
            this.config,
            project.path,
            inbound.files,
            liveCtx,
          );
          if (activeRequest.stopRequested) {
            return buildStoppedGatewayResult();
          }

          const inboundText = buildInboundText(inbound.text, resolvedFiles);
          this.deps.appendConversation(target, {
            role: "user",
            content: inboundText,
            at: nowIso(),
          });
          appendedUserTurn = true;
          const response = await this.deps.respond(
            target,
            {
              chatId: inbound.chatId,
              sender: inbound.sender,
              text: inboundText,
              files: resolvedFiles,
              memory,
            },
            {
              signal: activeRequest.abortController.signal,
              onProgress: (event) => {
                if (activeRequest.stopRequested) {
                  return progressQueue;
                }
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

          if (activeRequest.stopRequested) {
            return buildStoppedGatewayResult();
          }

          const outbound = parseOutboundAgentResponse(
            response,
            path.resolve(this.config.rootDir, agent.path),
          );
          if (activeRequest.stopRequested) {
            return buildStoppedGatewayResult();
          }
          const outboundTextForTelegram = profile.showAgentPrefix
            ? formatTelegramAgentReply(agent.id, outbound.text)
            : outbound.text;
          const assistantLog = buildAssistantLogContent(
            outbound.text,
            outbound.files,
          );

          if (activeRequest.stopRequested) {
            return buildStoppedGatewayResult();
          }
          this.deps.appendConversation(target, {
            role: "assistant",
            content: assistantLog,
            at: nowIso(),
          });

          let sent = true;
          let sentAny = false;

          if (!activeRequest.stopRequested && outbound.text) {
            const textSent = await safeSendTelegramMessage(
              this.sender,
              inbound.chatId,
              outboundTextForTelegram,
              liveCtx,
              replyOptions,
            );
            sent = sent && textSent;
            sentAny = sentAny || textSent;
          }

          for (const file of outbound.files) {
            if (activeRequest.stopRequested) {
              return buildStoppedGatewayResult();
            }
            const fileSent = await this.fileSender(inbound.chatId, file, liveCtx);
            sent = sent && fileSent;
            sentAny = sentAny || fileSent;
          }

          if (!outbound.text && outbound.files.length === 0) {
            sent = false;
          } else if (sentAny && !sent) {
            sent = false;
          }

          const responseText =
            outboundTextForTelegram || summarizeOutboundFiles(outbound.files);

          await this.notifyAgentTurnFinished(activeRequest, "completed");

          return {
            ok: true,
            action: "agent_response",
            response: responseText,
            sent,
          };
        } catch (error) {
          await progressQueue.catch(() => undefined);
          await liveStatus.close();
          if (activeRequest.stopRequested) {
            return buildStoppedGatewayResult();
          }

          const response = buildAgentFailureMessage(
            error,
            progressState.lastMeaningfulMessage,
          );
          await this.notifyAgentTurnFinished(
            activeRequest,
            isProviderTimeoutError(error) ? "timed_out" : "failed"
          );
          if (appendedUserTurn) {
            this.deps.appendConversation(target, {
              role: "assistant",
              content: buildAssistantRecoveryLog(
                error,
                agent.provider,
                this.config.providerCliTimeoutMs,
                progressState.lastMeaningfulMessage,
              ),
              at: nowIso(),
            });
          }
          logAgentFailure(liveCtx.botId, inbound.chatId, agent.provider, error);
          const sent = await safeSendTelegramMessage(
            this.sender,
            inbound.chatId,
            response,
            liveCtx,
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
          if (this.activeRequests.get(laneKey) === activeRequest) {
            this.activeRequests.delete(laneKey);
          }
        }
      },
    );
  }

  private async sendManagementCommandResult(
    ctx: TelegramBotContext,
    inbound: TelegramInbound,
    commandResult: ManagementCommandResult,
  ): Promise<GatewayResult> {
    let responseCtx = ctx;
    if (commandResult.nextState) {
      this.deps.saveState(commandResult.nextState);
      const refreshed = getTelegramBot(commandResult.nextState, ctx.botId);
      if (refreshed) {
        responseCtx = { ...ctx, profile: refreshed };
      }
    }

    if (inbound.callbackQueryId) {
      await safeAnswerTelegramCallback(
        this.callbackAnswerer,
        inbound.callbackQueryId,
        truncateTelegramCallbackText(commandResult.callbackAnswerText ?? commandResult.response),
        responseCtx,
      );
    }

    const sent = await this.sender(
      inbound.chatId,
      commandResult.response,
      responseCtx,
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

  private rememberTelegramTarget(
    ctx: TelegramBotContext,
    inbound: TelegramInbound,
    state: OpenColabState,
  ): void {
    this.deps.saveState(
      withBotProfile(state, ctx.botId, {
        lastChatType: normalizeRememberedChatType(inbound.chatType),
        lastMessageThreadId: inbound.messageThreadId ?? null,
        lastInteractionAt: nowIso(),
      }),
    );
  }

  private async handleStopCommand(
    ctx: TelegramBotContext,
    inbound: TelegramInbound,
    laneKey: string,
  ): Promise<GatewayResult> {
    const activeRequest = this.activeRequests.get(laneKey);
    if (!activeRequest) {
      return this.sendManagementCommandResult(ctx, inbound, {
        response: "No active task to stop.",
      });
    }

    if (!activeRequest.stopRequested) {
      activeRequest.stopRequested = true;
      activeRequest.abortController.abort();
      await activeRequest.liveStatus.close();

      if (!activeRequest.recoveryLogged) {
        const state = ensureProjectAndAgent(this.deps.getState());
        const project = state.projects[activeRequest.projectId];
        const agent = project?.agents[activeRequest.agentId];
        if (project && agent) {
          this.deps.appendConversation(
            { project, agent },
            {
              role: "assistant",
              content: buildAssistantStopRecoveryLog(
                activeRequest.provider,
                activeRequest.progressState.lastMeaningfulMessage,
              ),
              at: nowIso(),
            },
          );
        }
        activeRequest.recoveryLogged = true;
      }
      await this.notifyAgentTurnFinished(activeRequest, "stopped");
    }

    return this.sendManagementCommandResult(ctx, inbound, {
      response: STOPPED_TASK_CONFIRMATION_TEXT,
    });
  }

  private async runQueuedLane<T>(
    laneKey: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return runQueued(this.laneQueues, laneKey, task);
  }

  private async runQueuedAgent<T>(
    agentLaneKey: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return runQueued(this.agentQueues, agentLaneKey, task);
  }

  isAgentBusy(projectId: string, agentId: string): boolean {
    for (const request of this.activeRequests.values()) {
      if (request.projectId === projectId && request.agentId === agentId) {
        return true;
      }
    }
    return false;
  }

  private async notifyAgentTurnFinished(
    activeRequest: ActiveRequest,
    outcome: "completed" | "stopped" | "timed_out" | "failed"
  ): Promise<void> {
    if (activeRequest.turnFinished) {
      return;
    }
    activeRequest.turnFinished = true;
    await this.deps.onAgentTurnFinished?.(activeRequest.projectId, activeRequest.agentId, outcome);
  }

  private tryHandleManagementCommand(
    ctx: TelegramBotContext,
    inbound: TelegramInbound,
    state: OpenColabState,
  ): ManagementCommandResult | null {
    if (inbound.kind === "callback_query") {
      return this.tryHandleManagementCallback(ctx, inbound, state);
    }

    const text = normalizeManagementInput(inbound.commandText);
    if (!text.startsWith("/")) {
      return null;
    }

    const tokens = text.split(/\s+/);
    const scope = normalizeCommandToken(tokens[0]).toLowerCase();

    if (scope === "/projects") {
      return this.renderProjectPicker(ctx, state);
    }

    if (scope === "/agents") {
      return this.renderAgentPicker(ctx, state);
    }

    if (scope === "/whoami") {
      return this.renderWhoAmI(ctx, state);
    }

    if (scope === "/session_reset") {
      const routing = this.resolveRoutingTarget(state, ctx.profile);
      if (!routing.ok) {
        return { response: routing.message };
      }
      const sessionId = this.deps.resetConversationSession(routing.target);
      return {
        response: [
          `Session reset for ${routing.target.agent.id} (project ${routing.target.project.id}).`,
          `New session: ${sessionId}`,
        ].join("\n"),
      };
    }

    if (scope === "/workflow_notifications" || scope === "/workflow_notify") {
      return this.handleWorkflowNotificationsCommand(ctx, state, tokens.slice(1));
    }

    return {
      response: buildSupportedCommandsText(ctx.profile),
    };
  }

  private handleWorkflowNotificationsCommand(
    ctx: TelegramBotContext,
    state: OpenColabState,
    args: string[],
  ): ManagementCommandResult {
    const mode = (args[0] ?? "status").trim().toLowerCase();
    if (mode === "status" || mode === "") {
      return {
        response: ctx.profile.notifyWorkflowProgress
          ? "Workflow live updates: ON. You'll get step boundaries + agent milestones for every run."
          : "Workflow live updates: OFF. Send /workflow_notifications on to enable.",
      };
    }
    if (mode === "on" || mode === "enable" || mode === "true") {
      if (ctx.profile.notifyWorkflowProgress) {
        return { response: "Workflow live updates are already ON." };
      }
      return {
        nextState: withBotProfile(state, ctx.botId, { notifyWorkflowProgress: true }),
        response: "Workflow live updates: ON. You'll see step boundaries + agent milestones here.",
      };
    }
    if (mode === "off" || mode === "disable" || mode === "false") {
      if (!ctx.profile.notifyWorkflowProgress) {
        return { response: "Workflow live updates are already OFF." };
      }
      return {
        nextState: withBotProfile(state, ctx.botId, { notifyWorkflowProgress: false }),
        response: "Workflow live updates: OFF.",
      };
    }
    return {
      response: "Usage: /workflow_notifications on|off|status",
    };
  }

  private tryHandleManagementCallback(
    ctx: TelegramBotContext,
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
      return this.selectProject(ctx, state, value, "Project selected.");
    }

    if (scope === "agt" && action === "use" && value) {
      return this.selectAgent(ctx, state, value, "Agent selected.");
    }

    return {
      response: "Unknown Telegram button action.",
      callbackAnswerText: "Unknown action.",
    };
  }

  /** Only reachable from a floating bot's picker; a pinned chat never switches projects. */
  private selectProject(
    ctx: TelegramBotContext,
    state: OpenColabState,
    projectIdRaw: string,
    callbackAnswerText: string,
  ): ManagementCommandResult {
    if (ctx.profile.scope === "pinned") {
      return {
        response: describeBotBinding(ctx.profile, state),
        callbackAnswerText: "This chat has a fixed project.",
      };
    }

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

  /**
   * Switches who answers in this chat. For a pinned bot that is the bot's own target
   * agent, so the global active agent and every other chat stay untouched.
   */
  private selectAgent(
    ctx: TelegramBotContext,
    state: OpenColabState,
    agentIdRaw: string,
    callbackAnswerText: string,
  ): ManagementCommandResult {
    const agentId = normalizeEntityId(agentIdRaw);

    if (ctx.profile.scope === "pinned") {
      const projectId = ctx.profile.projectId;
      const project = projectId ? state.projects[projectId] : null;
      if (!project) {
        return {
          response: describeBotBinding(ctx.profile, state),
          callbackAnswerText: "No bound project.",
        };
      }
      const agent = project.agents[agentId];
      if (!agent) {
        return {
          response: `Unknown agent in project '${project.id}': ${agentId}`,
          callbackAnswerText: "Unknown agent.",
        };
      }

      ensureAgentFiles(this.config.rootDir, agent);
      return {
        nextState: withBotProfile(state, ctx.botId, { agentId }),
        response: [
          `Now talking to: ${agentId}`,
          `Project: ${project.id}`,
          `Provider: ${agent.provider.name}:${agent.provider.model}`,
        ].join("\n"),
        callbackAnswerText,
      };
    }

    const project = getActiveProject(state);
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

  private renderProjectPicker(
    ctx: TelegramBotContext,
    state: OpenColabState,
  ): ManagementCommandResult {
    if (ctx.profile.scope === "pinned") {
      return { response: describeBotBinding(ctx.profile, state) };
    }

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
    ctx: TelegramBotContext,
    state: OpenColabState,
  ): ManagementCommandResult {
    const routing = this.resolveRoutingTarget(state, ctx.profile);
    if (!routing.ok) {
      return { response: routing.message };
    }

    const project = routing.target.project;
    const currentAgentId = routing.target.agent.id;
    const following =
      ctx.profile.scope === "pinned" && !ctx.profile.agentId
        ? `Following the project default (${project.activeAgentId}).`
        : null;

    const entries = Object.values(project.agents).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const lines = entries.map((agent) => {
      const marker = agent.id === currentAgentId ? "*" : "-";
      return `${marker} ${agent.id} [${agent.provider.name}:${agent.provider.model}]`;
    });

    return {
      response: [
        `Agents in ${project.id} (${entries.length})`,
        `Current: ${currentAgentId}`,
        ...(following ? [following] : []),
        "Tap an agent to switch this chat.",
        "",
        ...lines,
      ].join("\n"),
      options: {
        inlineKeyboard: [
          ...chunkInlineButtons(
            entries.map((agent) => ({
              text:
                agent.id === currentAgentId
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

  private renderWhoAmI(
    ctx: TelegramBotContext,
    state: OpenColabState,
  ): ManagementCommandResult {
    const routing = this.resolveRoutingTarget(state, ctx.profile);
    const lines = [
      `Bot: ${ctx.profile.telegramUsername ? `@${ctx.profile.telegramUsername}` : ctx.botId} (${ctx.botId})`,
      `Mode: ${ctx.profile.scope}`,
    ];

    if (routing.ok) {
      const { project, agent } = routing.target;
      lines.push(`Project: ${project.id}`);
      lines.push(`Agent: ${agent.id} [${agent.provider.name}:${agent.provider.model}]`);
      if (ctx.profile.scope === "pinned" && !ctx.profile.agentId) {
        lines.push("Agent source: project default (use /agents to pin one here)");
      }
    } else {
      lines.push(routing.message);
    }

    lines.push(
      `Workflow updates: ${ctx.profile.notifyWorkflowProgress ? "on" : "off"}`,
    );
    if (ctx.profile.pairedAt) {
      lines.push(`Paired: ${ctx.profile.pairedAt}`);
    }

    return { response: lines.join("\n") };
  }

  private startTypingFeedback(
    chatId: string,
    ctx: TelegramBotContext,
  ): () => void {
    let running = true;

    const tick = async (): Promise<void> => {
      if (!running) {
        return;
      }

      try {
        await this.typingSender(chatId, ctx);
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

type BotContextResolution =
  | { ok: true; ctx: TelegramBotContext }
  | { ok: false; result: GatewayResult };

type RoutingResolution =
  | { ok: true; target: TelegramRoutingTarget; note?: string }
  | { ok: false; message: string };

/** Immutably patches one bot profile inside a state snapshot. */
export function withBotProfile(
  state: OpenColabState,
  botId: string,
  patch: Partial<TelegramBotProfile>,
): OpenColabState {
  const existing = state.telegramBots[botId];
  if (!existing) {
    return state;
  }

  return {
    ...state,
    telegramBots: {
      ...state.telegramBots,
      [botId]: { ...existing, ...patch, id: existing.id },
    },
  };
}

function describeBotBinding(
  profile: TelegramBotProfile,
  state: OpenColabState,
): string {
  const project = profile.projectId ? state.projects[profile.projectId] : null;
  const agentId = profile.agentId ?? project?.activeAgentId ?? "unknown";

  if (!project) {
    return [
      profile.projectId
        ? `This chat is bound to project '${profile.projectId}', which no longer exists.`
        : "This chat is not bound to a project yet.",
      `Bind it with: opencolab telegram bot bind --id ${profile.id} --project <project_id>`,
    ].join("\n");
  }

  return [
    `This chat is bound to project '${project.id}'.`,
    `Target agent: ${agentId}`,
    "Use /agents to change who answers here.",
    `To move this bot to another project, run: opencolab telegram bot bind --id ${profile.id} --project <project_id>`,
  ].join("\n");
}

function buildSupportedCommandsText(profile: TelegramBotProfile): string {
  const commands = [
    ...(profile.scope === "floating" ? ["/projects"] : ["/projects (info)"]),
    "/agents",
    "/whoami",
    "/session_reset",
    "/stop",
    "/workflow_notifications on|off|status",
  ];
  return `Supported commands: ${commands.join(" | ")}`;
}

const tokenMissingLoggedAt = new Map<string, number>();
const TOKEN_MISSING_LOG_INTERVAL_MS = 60_000;

function logTokenMissing(profile: TelegramBotProfile): void {
  const now = Date.now();
  const last = tokenMissingLoggedAt.get(profile.id) ?? 0;
  if (now - last < TOKEN_MISSING_LOG_INTERVAL_MS) {
    return;
  }
  tokenMissingLoggedAt.set(profile.id, now);
  console.error(
    `[opencolab:telegram] bot=${profile.id} token missing (${profile.tokenEnvVar}); updates are ignored.`,
  );
}

async function runQueued<T>(
  queues: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  queues.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  }
}
async function safeSendTelegramMessage(
  sender: TelegramSender,
  chatId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  try {
    return await sendTelegramTextChunks(sender, chatId, text, ctx, options);
  } catch {
    return false;
  }
}

async function sendTelegramTextChunks(
  sender: TelegramSender,
  chatId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  const chunks = splitTelegramText(text);
  if (chunks.length === 0) {
    return false;
  }

  for (const chunk of chunks) {
    const sent = await sender(chatId, chunk, ctx, options);
    if (!sent) {
      return false;
    }
  }

  return true;
}

async function safeCreateTelegramStatusMessage(
  creator: TelegramStatusMessageCreator,
  chatId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<string | null> {
  try {
    return await creator(chatId, text, ctx, options);
  } catch {
    return null;
  }
}

async function safeEditTelegramMessage(
  editor: TelegramMessageEditor,
  chatId: string,
  messageId: string,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  try {
    return await editor(chatId, messageId, text, ctx, options);
  } catch {
    return false;
  }
}

async function safeAnswerTelegramCallback(
  answerer: TelegramCallbackAnswerer,
  callbackQueryId: string,
  text: string | undefined,
  ctx: TelegramBotContext,
): Promise<boolean> {
  try {
    return await answerer(callbackQueryId, text, ctx);
  } catch {
    return false;
  }
}

export function buildAgentFailureMessage(
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

export function buildAssistantRecoveryLog(
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

function buildAssistantStopRecoveryLog(
  provider: ProviderConfig,
  lastProgressMessage?: string | null,
): string {
  const lines = [
    `Previous attempt was stopped by the user with /stop using ${provider.name}/${provider.model}.`,
  ];
  const lastProgress = truncateForRecovery(normalizeProgressMessage(lastProgressMessage ?? ""), 220);
  if (lastProgress) {
    lines.push(`Last progress: ${lastProgress}`);
  }
  lines.push("Next action: continue from the last completed stage if the user asks to resume.");
  return lines.join("\n");
}

function createRequestProgressState(): RequestProgressState {
  return {
    lastMeaningfulMessage: null,
  };
}

function createActiveRequest(
  projectId: string,
  agentId: string,
  provider: ProviderConfig,
  progressState: RequestProgressState,
  liveStatus: TelegramLiveStatusSession,
): ActiveRequest {
  return {
    projectId,
    agentId,
    provider,
    progressState,
    liveStatus,
    abortController: new AbortController(),
    stopRequested: false,
    recoveryLogged: false,
    turnFinished: false,
  };
}

function buildStoppedGatewayResult(): GatewayResult {
  return {
    ok: true,
    action: "agent_stopped",
    response: STOPPED_TASK_CONFIRMATION_TEXT,
    sent: false,
  };
}

function normalizeProgressMessage(value: string): string {
  return String(value ?? "").trim();
}

export function isProviderTimeoutError(error: unknown): boolean {
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

function splitTelegramText(value: string): string[] {
  const text = String(value ?? "");
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= MAX_TELEGRAM_TEXT_CHARS) {
      chunks.push(text.slice(start));
      break;
    }

    const splitAt = findTelegramSplitIndex(text, start, MAX_TELEGRAM_TEXT_CHARS);
    chunks.push(text.slice(start, splitAt));
    start = splitAt;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function findTelegramSplitIndex(text: string, start: number, limit: number): number {
  const end = Math.min(start + limit, text.length);
  const min = Math.max(start + Math.floor(limit * 0.6), start + 1);

  for (const separator of ["\n\n", "\n", " "]) {
    const index = text.lastIndexOf(separator, end);
    if (index >= min) {
      return index + separator.length;
    }
  }

  return end;
}

function resolveProgressSlot(event: TaskProgressEvent): string {
  return (
    normalizeProgressMessage(event.slot ?? "") ||
    normalizeProgressMessage(event.stage ?? "") ||
    event.kind
  );
}

function logAgentFailure(
  botId: string,
  chatId: string,
  provider: ProviderConfig,
  error: unknown,
): void {
  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  console.error(
    `[opencolab:telegram:error] bot=${botId} chat=${chatId} provider=${provider.name} model=${provider.model} ${detail}`,
  );
}

async function postTelegramJson(
  ctx: TelegramBotContext,
  method: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${ctx.token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const parsed = await response.json().catch(() => null);
    const body = asRecord(parsed);
    if (!response.ok || body?.ok !== true) {
      const detail =
        asStringValue(body?.description) ??
        (response.ok ? "telegram returned ok=false" : `telegram api status ${String(response.status)}`);
      console.error(
        `[opencolab:telegram:api] bot=${ctx.botId} method=${method} status=${String(response.status)} ${detail}`,
      );
      return null;
    }
    return body;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    console.error(
      `[opencolab:telegram:api] bot=${ctx.botId} method=${method} transport_error ${detail}`,
    );
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
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  const messageId = await defaultTelegramStatusMessageCreator(chatId, text, ctx, options);
  return Boolean(messageId);
}

export async function defaultTelegramDraftSender(
  chatId: string,
  draftId: number,
  text: string,
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  const response = await postTelegramJson(ctx, "sendMessageDraft", {
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
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<string | null> {
  const response = await postTelegramJson(ctx, "sendMessage", {
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
  ctx: TelegramBotContext,
  options?: TelegramMessageOptions,
): Promise<boolean> {
  void options;
  const response = await postTelegramJson(ctx, "editMessageText", {
    chat_id: chatId,
    message_id: Number(messageId),
    text,
  });
  return response !== null;
}

export async function defaultTelegramCallbackAnswerer(
  callbackQueryId: string,
  text: string | undefined,
  ctx: TelegramBotContext,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${ctx.token}/answerCallbackQuery`,
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
  ctx: TelegramBotContext,
): Promise<boolean> {
  return (await postTelegramJson(ctx, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
  })) !== null;
}

export async function defaultTelegramFileSender(
  chatId: string,
  file: TelegramOutboundFile,
  ctx: TelegramBotContext,
): Promise<boolean> {
  const token = ctx.token;
  const method = resolveTelegramFileMethod(file.kind);
  const fileField = resolveTelegramFileField(file.kind);
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const localUpload = resolveLocalTelegramUpload(file.file);

  try {
    let response: Response;

    if (localUpload) {
      const fileBytes = fs.readFileSync(localUpload.filePath);
      const blob = new Blob([fileBytes]);
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append(fileField, blob, localUpload.fileName);
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

interface LocalTelegramUpload {
  filePath: string;
  fileName: string;
}

function resolveLocalTelegramUpload(reference: string): LocalTelegramUpload | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }

  const filePath = resolveLocalTelegramUploadPath(trimmed);
  if (!filePath) {
    return null;
  }

  try {
    if (!fs.statSync(filePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    filePath,
    fileName: resolveLocalTelegramUploadName(filePath, trimmed),
  };
}

function resolveLocalTelegramUploadPath(reference: string): string | null {
  if (reference.toLowerCase().startsWith("file:")) {
    try {
      return fileURLToPath(reference);
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(reference) || path.win32.isAbsolute(reference)) {
    return reference;
  }

  return null;
}

function resolveLocalTelegramUploadName(filePath: string, originalReference: string): string {
  if (!path.isAbsolute(originalReference) && path.win32.isAbsolute(originalReference)) {
    return path.win32.basename(originalReference);
  }

  return path.basename(filePath);
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

function normalizeRememberedChatType(chatType: TelegramChatType): TelegramChatType | null {
  return chatType === "unknown" ? null : chatType;
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

function buildTelegramConversationLaneKey(
  botId: string,
  chatId: string,
  messageThreadId?: string,
): string {
  return `${botId}::${chatId}::${messageThreadId ?? ""}`;
}

/** Serializes provider turns for one agent across every bot, chat, and thread. */
function buildAgentLaneKey(projectId: string, agentId: string): string {
  return `${projectId}::${agentId}`;
}

function isStopCommand(inbound: TelegramInbound): boolean {
  if (inbound.kind !== "message") {
    return false;
  }

  const text = normalizeManagementInput(inbound.commandText);
  if (!text.startsWith("/")) {
    return false;
  }

  const tokens = text.split(/\s+/);
  return normalizeCommandToken(tokens[0]).toLowerCase() === "/stop";
}

function isTelegramCommandLike(inbound: TelegramInbound): boolean {
  if (inbound.kind === "callback_query") {
    return true;
  }
  return normalizeManagementInput(inbound.commandText).startsWith("/");
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

// Cap how many lines a single directive may span so a stray "@telegram-file {"
// followed by ordinary prose can never swallow the whole message.
const MAX_DIRECTIVE_JSON_LINES = 40;

function parseOutboundAgentResponse(raw: string, localBaseDir: string): {
  text: string;
  files: TelegramOutboundFile[];
} {
  const lines = raw.split(/\r?\n/);
  const remaining: string[] = [];
  const files: TelegramOutboundFile[] = [];

  let index = 0;
  while (index < lines.length) {
    const directive = parseDirectiveAt(lines, index, localBaseDir);
    if (!directive) {
      remaining.push(lines[index]);
      index += 1;
      continue;
    }
    if (directive.file) {
      files.push(directive.file);
    }
    index += directive.consumed;
  }

  return {
    text: remaining.join("\n").trim(),
    files,
  };
}

interface ParsedDirective {
  file: TelegramOutboundFile | null;
  consumed: number;
}

// Parse one @telegram-file directive starting at `start`. The JSON payload may
// sit on the directive line, span several lines (pretty-printed), or begin on
// the line after a bare "@telegram-file". Returns null when the line does not
// begin a usable directive, so the caller keeps it as ordinary prose.
function parseDirectiveAt(
  lines: string[],
  start: number,
  localBaseDir: string,
): ParsedDirective | null {
  const firstPayload = directivePayload(lines[start].trim());
  if (firstPayload === null) {
    return null;
  }

  // Fast path: the JSON is complete on the directive's own line.
  const single = parseOutboundPayload(firstPayload, localBaseDir);
  if (single.ok) {
    return { file: single.file, consumed: 1 };
  }

  // Only accumulate following lines when the payload opens an object literal
  // (or is empty, meaning the JSON begins on the next line). This prevents a
  // stray directive from consuming unrelated prose beneath it.
  if (firstPayload !== "" && !firstPayload.startsWith("{")) {
    return null;
  }

  let accumulated = firstPayload;
  const maxEnd = Math.min(start + MAX_DIRECTIVE_JSON_LINES, lines.length - 1);
  for (let cursor = start + 1; cursor <= maxEnd; cursor += 1) {
    accumulated =
      accumulated === "" ? lines[cursor] : `${accumulated}\n${lines[cursor]}`;
    const attempt = parseOutboundPayload(accumulated, localBaseDir);
    if (attempt.ok) {
      return { file: attempt.file, consumed: cursor - start + 1 };
    }
  }

  return null;
}

function parseOutboundPayload(
  payloadText: string,
  localBaseDir: string,
):
  | { ok: true; file: TelegramOutboundFile | null }
  | { ok: false } {
  const trimmed = payloadText.trim();
  if (!trimmed.startsWith("{")) {
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false };
  }

  return {
    ok: true,
    file: normalizeOutboundFile(parsed as Record<string, unknown>, localBaseDir),
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

// Common ways agents mislabel a file kind. Telegram silently drops an
// unrecognized kind, so we map the frequent mistakes onto the real method
// instead of losing the file. Keys are compared lowercase.
const TELEGRAM_KIND_ALIASES: Record<string, TelegramFileKind> = {
  image: "photo",
  images: "photo",
  picture: "photo",
  pic: "photo",
  photos: "photo",
  png: "photo",
  jpg: "photo",
  jpeg: "photo",
  webp: "photo",
  gif: "animation",
  animated: "animation",
  doc: "document",
  docs: "document",
  documents: "document",
  file: "document",
  pdf: "document",
  audios: "audio",
  mp3: "audio",
  sound: "audio",
  videos: "video",
  mp4: "video",
  movie: "video",
  voicenote: "voice",
  voice_note: "voice",
  videonote: "video_note",
  stickers: "sticker",
};

function asOutboundKind(value: unknown): TelegramFileKind | null {
  const parsed = asStringValue(value);
  if (!parsed) {
    return null;
  }

  const normalized = parsed.trim().toLowerCase();
  if (isTelegramFileKind(normalized)) {
    return normalized;
  }

  return TELEGRAM_KIND_ALIASES[normalized] ?? null;
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

function formatTelegramAgentReply(agentId: string, text: string): string {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return "";
  }

  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return normalizedText;
  }

  return `${normalizedAgentId}\n\n${normalizedText}`;
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

// Returns the payload text after "@telegram-file" (possibly ""), or null when
// the line is not a directive at all. An empty string signals that the JSON
// begins on a following line, which parseDirectiveAt handles.
function directivePayload(trimmed: string): string | null {
  const normalized = unwrapInlineCode(trimmed);
  if (!normalized.startsWith("@telegram-file")) {
    return null;
  }

  return normalized.slice("@telegram-file".length).trim();
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
  ctx: TelegramBotContext,
): Promise<TelegramFilePayload[]> {
  if (files.length === 0) {
    return [];
  }

  const token = ctx.token;
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
