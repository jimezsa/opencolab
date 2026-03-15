/**
 * Telegram progress-message session utilities.
 * Keeps one status message updated in place while a long-running task executes.
 */
import type { AgentProgressEvent } from "./types.js";

const MAX_PROGRESS_ITEMS = 5;
const MAX_PROGRESS_TEXT_CHARS = 3500;
const MAX_PROGRESS_LINE_CHARS = 160;

type ProgressStatus = "working" | "completed" | "failed";

interface ProgressStep {
  phase: AgentProgressEvent["phase"];
  message: string;
  items: string[];
}

export interface TelegramProgressSessionOptions {
  send: (text: string) => Promise<{ ok: boolean; messageId?: number }>;
  edit: (messageId: number, text: string) => Promise<boolean>;
}

export class TelegramProgressSession {
  private readonly steps: ProgressStep[] = [];
  private messageId: number | null = null;
  private disabled = false;
  private lastRenderedText = "";
  private status: ProgressStatus = "working";

  constructor(private readonly options: TelegramProgressSessionOptions) {}

  hasStarted(): boolean {
    return this.steps.length > 0;
  }

  async apply(event: AgentProgressEvent): Promise<void> {
    if (this.disabled) {
      return;
    }

    const message = event.message.trim();
    if (!message && !event.done && event.phase !== "done") {
      return;
    }

    if (message) {
      const nextItems = normalizeProgressItems(event.items);
      const existing = this.steps.find((step) => step.phase === event.phase);
      if (existing) {
        existing.message = message;
        existing.items = nextItems;
      } else {
        this.steps.push({
          phase: event.phase,
          message,
          items: nextItems,
        });
      }
    }

    if (event.done || event.phase === "done") {
      this.status = "completed";
    }

    await this.sync();
  }

  async complete(): Promise<void> {
    if (this.disabled || this.steps.length === 0) {
      return;
    }

    this.status = "completed";
    await this.sync();
  }

  async fail(): Promise<void> {
    if (this.disabled || this.steps.length === 0) {
      return;
    }

    this.status = "failed";
    await this.sync();
  }

  private async sync(): Promise<void> {
    const text = renderTelegramProgressMessage(this.steps, this.status);
    if (!text || text === this.lastRenderedText) {
      return;
    }

    if (this.messageId === null) {
      let result: { ok: boolean; messageId?: number };
      try {
        result = await this.options.send(text);
      } catch {
        this.disabled = true;
        return;
      }

      if (!result.ok || result.messageId === undefined) {
        this.disabled = true;
        return;
      }

      this.messageId = result.messageId;
      this.lastRenderedText = text;
      return;
    }

    let edited = false;
    try {
      edited = await this.options.edit(this.messageId, text);
    } catch {
      this.disabled = true;
      return;
    }

    if (!edited) {
      this.disabled = true;
      return;
    }

    this.lastRenderedText = text;
  }
}

export function renderTelegramProgressMessage(
  steps: Array<{ message: string; items?: string[] }>,
  status: ProgressStatus = "working",
): string {
  const header =
    status === "completed"
      ? "Completed"
      : status === "failed"
        ? "Failed"
        : "Working on it";

  const lines: string[] = [header];
  if (steps.length > 0) {
    lines.push("");
  }

  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${truncateLine(step.message, MAX_PROGRESS_LINE_CHARS)}`);

    const items = normalizeProgressItems(step.items);
    items.slice(0, MAX_PROGRESS_ITEMS).forEach((item) => {
      lines.push(`   - ${truncateLine(item, MAX_PROGRESS_LINE_CHARS)}`);
    });

    if (items.length > MAX_PROGRESS_ITEMS) {
      lines.push(`   - +${String(items.length - MAX_PROGRESS_ITEMS)} more`);
    }
  });

  const text = lines.join("\n").trim();
  if (text.length <= MAX_PROGRESS_TEXT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_PROGRESS_TEXT_CHARS - 3).trimEnd()}...`;
}

function normalizeProgressItems(items: string[] | undefined): string[] {
  if (!items || items.length === 0) {
    return [];
  }

  return items
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncateLine(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
