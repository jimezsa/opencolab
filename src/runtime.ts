import { ensureAgentFiles } from "./agent.js";
import { loadConfig, type OpenColabConfig } from "./config.js";
import { ConversationStore } from "./conversation.js";
import { CodexAgent, type CodexAgentInput } from "./codex-agent.js";
import {
  buildAgentPath,
  createDefaultAgentConfig,
  createDefaultProjectState,
  DEFAULT_AGENT_ID,
  ensureProjectAndAgent,
  getActiveProject,
  readProjectState,
  writeProjectState
} from "./project-config.js";
import { getProviderSetupDefaults } from "./provider.js";
import {
  TelegramGateway,
  type TelegramFileSender,
  type TelegramSender,
  type TelegramTypingSender
} from "./gateway.js";
import type {
  AgentConfig,
  GatewayResult,
  OpenColabState,
  ProjectState,
  ProviderName
} from "./types.js";
import { ensureDir } from "./utils.js";

export interface RuntimeOptions {
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  telegramFileSender?: TelegramFileSender;
  agentResponder?: (input: CodexAgentInput) => Promise<string>;
}

export interface ModelSetupInput {
  providerName: ProviderName;
  model: string;
  apiKeyEnvVar: string;
  cliCommand?: string;
  cliArgs?: string[];
}

export interface TelegramSetupInput {
  botTokenEnvVar: string;
  chatId: string;
}

export class OpenColabRuntime {
  readonly config: OpenColabConfig;

  private state: OpenColabState;
  private readonly conversations: ConversationStore;
  private readonly codex: CodexAgent;
  private readonly gateway: TelegramGateway;

  constructor(cwd = process.cwd(), private readonly options: RuntimeOptions = {}) {
    this.config = loadConfig(cwd);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.conversations = new ConversationStore(this.config.rootDir);
    this.codex = new CodexAgent(this.config, () => this.state);

    this.gateway = new TelegramGateway(this.config, {
      getState: () => this.state,
      saveState: (next) => {
        this.state = ensureProjectAndAgent(next);
        writeProjectState(this.config, this.state);
        this.ensureActiveAgentFiles();
      },
      readConversation: (chatId, limit) =>
        this.conversations.readRecent(this.resolveActiveAgentPath(), limit),
      appendConversation: (chatId, message) =>
        this.conversations.append(this.resolveActiveAgentPath(), message),
      resetConversationSession: () => this.conversations.resetSession(this.resolveActiveAgentPath()),
      respond: async (input) => {
        if (this.options.agentResponder) {
          return this.options.agentResponder(input);
        }
        return this.codex.respond(input);
      },
      telegramSender: this.options.telegramSender,
      telegramTypingSender: this.options.telegramTypingSender,
      telegramFileSender: this.options.telegramFileSender
    });
  }

  init(): OpenColabState {
    ensureDir(this.config.stateDir);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
    this.persist();
    this.ensureActiveAgentFiles();
    return this.state;
  }

  getState(): OpenColabState {
    return this.state;
  }

  getActiveProject(): ProjectState {
    return getActiveProject(this.state);
  }

  getActiveAgent(): AgentConfig {
    const project = this.getActiveProject();
    const active = project.agents[project.activeAgentId];
    if (active) {
      return active;
    }

    const fallback = Object.values(project.agents)[0];
    if (fallback) {
      return fallback;
    }

    return createDefaultAgentConfig(project.id, DEFAULT_AGENT_ID);
  }

  listProjects(): ProjectState[] {
    return Object.values(this.state.projects).sort((a, b) => a.id.localeCompare(b.id));
  }

  createProject(projectId: string): OpenColabState {
    const id = normalizeEntityId(projectId);
    if (this.state.projects[id]) {
      throw new Error(`Project already exists: ${id}`);
    }

    const project = createDefaultProjectState(id);
    this.state = {
      ...this.state,
      activeProjectId: id,
      projects: {
        ...this.state.projects,
        [id]: project
      }
    };

    this.persist();
    this.ensureActiveAgentFiles();
    return this.state;
  }

  useProject(projectId: string): OpenColabState {
    const id = normalizeEntityId(projectId);
    if (!this.state.projects[id]) {
      throw new Error(`Unknown project: ${id}`);
    }

    this.state = {
      ...this.state,
      activeProjectId: id
    };

    this.persist();
    this.ensureActiveAgentFiles();
    return this.state;
  }

  setupModel(input: ModelSetupInput): OpenColabState {
    const project = this.getActiveProject();
    const providerDefaults = getProviderSetupDefaults(input.providerName);
    const cliCommand = input.cliCommand?.trim() || providerDefaults.cliCommand;
    const cliArgs =
      input.cliArgs && input.cliArgs.length > 0 ? input.cliArgs : providerDefaults.cliArgs;

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          provider: {
            name: input.providerName,
            model: input.model,
            apiKeyEnvVar: input.apiKeyEnvVar,
            cliCommand,
            cliArgs
          }
        }
      }
    };

    this.persist();
    return this.state;
  }

  setupTelegram(input: TelegramSetupInput): OpenColabState {
    const chatChanged = this.state.telegram.chatId !== input.chatId;

    this.state = {
      ...this.state,
      telegram: {
        ...this.state.telegram,
        botTokenEnvVar: input.botTokenEnvVar,
        chatId: input.chatId,
        paired: chatChanged ? false : this.state.telegram.paired,
        pairedAt: chatChanged ? null : this.state.telegram.pairedAt,
        pendingPairingCode: null,
        pendingPairingExpiresAt: null
      }
    };

    this.persist();
    return this.state;
  }

  listAgents(projectId = this.state.activeProjectId): AgentConfig[] {
    const project = this.state.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    return Object.values(project.agents).sort((a, b) => a.id.localeCompare(b.id));
  }

  configureAgent(agentId: string, agentPath?: string): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(agentId);
    const candidatePath = agentPath?.trim();
    const resolvedPath = candidatePath || buildAgentPath(project.id, id);

    const existing = project.agents[id] ?? createDefaultAgentConfig(project.id, id);
    const updatedAgent: AgentConfig = {
      ...existing,
      id,
      path: resolvedPath
    };

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          activeAgentId: id,
          agents: {
            ...project.agents,
            [id]: updatedAgent
          }
        }
      }
    };

    this.persist();
    this.ensureActiveAgentFiles();
    return this.state;
  }

  useAgent(agentId: string): OpenColabState {
    const project = this.getActiveProject();
    const id = normalizeEntityId(agentId);
    if (!project.agents[id]) {
      throw new Error(`Unknown agent in project '${project.id}': ${id}`);
    }

    this.state = {
      ...this.state,
      projects: {
        ...this.state.projects,
        [project.id]: {
          ...project,
          activeAgentId: id
        }
      }
    };

    this.persist();
    this.ensureActiveAgentFiles();
    return this.state;
  }

  async startPairing(): Promise<{ code: string; expiresAt: string; sent: boolean }> {
    return this.gateway.startPairing();
  }

  completePairing(code: string): { pairedAt: string } {
    return this.gateway.completePairing(code);
  }

  async handleTelegramWebhook(body: unknown): Promise<GatewayResult> {
    return this.gateway.handleWebhook(body);
  }

  private ensureActiveAgentFiles(): void {
    const project = getActiveProject(this.state);
    const agent = project.agents[project.activeAgentId] ?? Object.values(project.agents)[0];
    if (!agent) {
      return;
    }

    ensureAgentFiles(this.config.rootDir, agent);
  }

  private resolveActiveAgentPath(): string {
    const project = getActiveProject(this.state);
    const agent = project.agents[project.activeAgentId] ?? Object.values(project.agents)[0];
    return agent?.path ?? project.path;
  }

  private persist(): void {
    this.state = ensureProjectAndAgent(this.state);
    writeProjectState(this.config, this.state);
    this.state = ensureProjectAndAgent(readProjectState(this.config));
  }
}

export function createRuntime(cwd = process.cwd(), options: RuntimeOptions = {}): OpenColabRuntime {
  return new OpenColabRuntime(cwd, options);
}

function normalizeEntityId(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Identifier is required");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid identifier '${trimmed}'. Use only letters, numbers, underscore, or hyphen.`
    );
  }

  return trimmed;
}
