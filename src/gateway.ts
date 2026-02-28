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
  TelegramInbound
} from "./types.js";
import { resolveSecretReference } from "./secrets.js";
import { nowIso, randomDigits } from "./utils.js";

export type TelegramSender = (
  chatId: string,
  text: string,
  state: OpenColabState
) => Promise<boolean>;

export type TelegramTypingSender = (chatId: string, state: OpenColabState) => Promise<boolean>;

interface GatewayDependencies {
  getState: () => OpenColabState;
  saveState: (next: OpenColabState) => void;
  readConversation: (chatId: string, limit: number) => ConversationMessage[];
  appendConversation: (chatId: string, message: ConversationMessage) => void;
  respond: (input: CodexAgentInput) => Promise<string>;
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
}

export class TelegramGateway {
  private readonly sender: TelegramSender;
  private readonly typingSender: TelegramTypingSender;

  constructor(
    private readonly config: OpenColabConfig,
    private readonly deps: GatewayDependencies
  ) {
    this.sender = deps.telegramSender ?? defaultTelegramSender;
    this.typingSender = deps.telegramTypingSender ?? defaultTelegramTypingSender;
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
        history
      });
    } finally {
      stopTyping();
    }

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

  private tryHandleManagementCommand(
    inbound: TelegramInbound,
    state: OpenColabState
  ): { nextState?: OpenColabState; response: string } | null {
    const text = inbound.text.trim();
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

    return {
      response:
        "Supported commands: /project list | /project create <project_id> | /project use <project_id> | /agent list | /agent create <agent_id> | /agent use <agent_id>"
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
