/**
 * Telegram-backed workflow notifier.
 * Streams step boundaries and agent milestones into a single editable status
 * message per run, reusing the gateway's TelegramLiveStatusSession so the look
 * matches the live status the user already sees during chat-driven agent turns.
 */
import {
  type TelegramBotContext,
  type TelegramMessageEditor,
  type TelegramStatusMessageCreator,
  TelegramLiveStatusSession
} from "./gateway.js";
import type {
  TaskProgressEvent,
  WorkflowEvent,
  WorkflowRunStatus
} from "./types.js";
import type {
  WorkflowRunNotifier,
  WorkflowRunNotifierContext,
  WorkflowRunNotifierFactory
} from "./workflows/notifier.js";

const FORWARDED_PROGRESS_KINDS = new Set<TaskProgressEvent["kind"]>([
  "milestone",
  "needs_input",
  "warning",
  "completed"
]);

interface NotifierDependencies {
  /**
   * Resolves the bot that owns a project's outbound notifications, or null when no
   * enabled, paired, token-present bot is bound to it. Returning null is deliberate:
   * a project's run updates are never delivered into another project's chat.
   */
  resolveBotContextForProject: (projectId: string) => TelegramBotContext | null;
  statusMessageCreator: TelegramStatusMessageCreator;
  messageEditor: TelegramMessageEditor;
}

export function createTelegramWorkflowNotifierFactory(
  deps: NotifierDependencies
): WorkflowRunNotifierFactory {
  return (context) => {
    const ctx = deps.resolveBotContextForProject(context.projectId);
    if (!ctx) {
      return null;
    }
    if (!ctx.profile.notifyWorkflowProgress) {
      return null;
    }
    const chatId = ctx.profile.chatId;
    if (!chatId || !ctx.profile.paired) {
      return null;
    }
    return new TelegramWorkflowNotifier(context, chatId, ctx, deps);
  };
}

class TelegramWorkflowNotifier implements WorkflowRunNotifier {
  private readonly session: TelegramLiveStatusSession;
  private readonly stepAgents = new Map<string, string | undefined>();
  private headerPushed = false;
  private closed = false;

  constructor(
    private readonly context: WorkflowRunNotifierContext,
    chatId: string,
    ctx: TelegramBotContext,
    deps: NotifierDependencies
  ) {
    this.session = new TelegramLiveStatusSession(
      chatId,
      ctx,
      {
        messageThreadId: ctx.profile.lastMessageThreadId ?? undefined,
        heading: `Workflow ${context.workflowId} · run ${shortRunId(context.runId)}`
      },
      deps.statusMessageCreator,
      deps.messageEditor
    );
  }

  onEvent(event: WorkflowEvent): void {
    if (this.closed) {
      return;
    }
    const translated = this.translateEvent(event);
    if (!translated) {
      return;
    }
    if (!this.headerPushed) {
      this.headerPushed = true;
    }
    void this.session.push(translated);
  }

  onProgress(event: TaskProgressEvent): void {
    if (this.closed) {
      return;
    }
    if (!FORWARDED_PROGRESS_KINDS.has(event.kind)) {
      return;
    }
    void this.session.push(event);
  }

  onStatus(_status: WorkflowRunStatus): void {
    // The event stream is already authoritative; status changes alone don't need extra messages.
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.session.close();
  }

  private translateEvent(event: WorkflowEvent): TaskProgressEvent | null {
    const stepId = event.stepId;
    const agentId = event.agentId;
    if (stepId && agentId) {
      this.stepAgents.set(stepId, agentId);
    }
    switch (event.kind) {
      case "run_started":
        return {
          kind: "started",
          message: `Run ${shortRunId(this.context.runId)} started.`,
          slot: "run"
        };
      case "step_started":
        return {
          kind: "milestone",
          message: stepId
            ? `▶️ Step '${stepId}'${agentId ? ` (agent: ${agentId})` : ""} started.`
            : event.message,
          stage: stepId,
          slot: stepId ? `step:${stepId}` : undefined
        };
      case "agent_completed":
        return {
          kind: "milestone",
          message: stepId
            ? `✅ Step '${stepId}'${agentId ? ` (agent: ${agentId})` : ""} finished.`
            : event.message,
          stage: stepId,
          slot: stepId ? `step:${stepId}` : undefined
        };
      case "step_completed":
        if (!stepId || this.stepAgents.has(stepId)) {
          // Agent steps already surfaced via agent_completed; avoid duplicate.
          return null;
        }
        return {
          kind: "milestone",
          message: `✅ Step '${stepId}' completed.`,
          stage: stepId,
          slot: `step:${stepId}`
        };
      case "decision_chosen":
        return {
          kind: "milestone",
          message: stepId
            ? `🔀 Decision at '${stepId}': ${event.message}`
            : event.message,
          stage: stepId,
          slot: stepId ? `decision:${stepId}` : undefined
        };
      case "human_gate_paused":
        return {
          kind: "needs_input",
          message: stepId
            ? `⏸ Waiting at human gate '${stepId}'.`
            : event.message,
          stage: stepId,
          slot: stepId ? `gate:${stepId}` : undefined
        };
      case "human_gate_resumed":
        return {
          kind: "milestone",
          message: stepId
            ? `▶️ Resumed from gate '${stepId}'.`
            : event.message,
          stage: stepId,
          slot: stepId ? `gate:${stepId}` : undefined
        };
      case "run_completed":
        return {
          kind: "completed",
          message: `🎉 Run ${shortRunId(this.context.runId)} completed.`,
          slot: "run"
        };
      case "run_failed":
        return {
          kind: "warning",
          message: `❌ Run ${shortRunId(this.context.runId)} failed: ${event.message}`,
          slot: "run"
        };
      case "run_stopped":
        return {
          kind: "completed",
          message: `⏹ Run ${shortRunId(this.context.runId)} stopped.`,
          slot: "run"
        };
      default:
        return null;
    }
  }
}

function shortRunId(runId: string): string {
  if (runId.length <= 12) {
    return runId;
  }
  return `${runId.slice(0, 6)}…${runId.slice(-4)}`;
}
