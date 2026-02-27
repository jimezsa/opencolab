import { ensureAgentFiles } from "./agent.js";
import { loadConfig, type OpenColabConfig } from "./config.js";
import { ConversationStore } from "./conversation.js";
import { CodexAgent, type CodexAgentInput } from "./codex-agent.js";
import { readProjectState, writeProjectState } from "./project-config.js";
import { TelegramGateway, type TelegramSender, type TelegramTypingSender } from "./gateway.js";
import type { GatewayResult, OpenColabState, ProviderName } from "./types.js";
import { ensureDir } from "./utils.js";

export interface RuntimeOptions {
  telegramSender?: TelegramSender;
  telegramTypingSender?: TelegramTypingSender;
  agentResponder?: (input: CodexAgentInput) => Promise<string>;
}

export interface ModelSetupInput {
  providerName: ProviderName;
  model: string;
  apiKeyEnvVar: string;
  cliCommand: string;
  cliArgs: string[];
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
    this.state = readProjectState(this.config);
    this.conversations = new ConversationStore(this.config.conversationsDir);
    this.codex = new CodexAgent(this.config, () => this.state);

    this.gateway = new TelegramGateway(this.config, {
      getState: () => this.state,
      saveState: (next) => {
        this.state = next;
        writeProjectState(this.config, this.state);
      },
      readConversation: (chatId, limit) => this.conversations.readRecent(chatId, limit),
      appendConversation: (chatId, message) => this.conversations.append(chatId, message),
      respond: async (input) => {
        if (this.options.agentResponder) {
          return this.options.agentResponder(input);
        }
        return this.codex.respond(input);
      },
      telegramSender: this.options.telegramSender,
      telegramTypingSender: this.options.telegramTypingSender
    });
  }

  init(): OpenColabState {
    ensureDir(this.config.stateDir);
    this.state = readProjectState(this.config);
    writeProjectState(this.config, this.state);
    ensureAgentFiles(this.config.rootDir, this.state.agent);
    return this.state;
  }

  getState(): OpenColabState {
    return this.state;
  }

  setupModel(input: ModelSetupInput): OpenColabState {
    this.state = {
      ...this.state,
      provider: {
        name: input.providerName,
        model: input.model,
        apiKeyEnvVar: input.apiKeyEnvVar,
        cliCommand: input.cliCommand,
        cliArgs: input.cliArgs
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

  configureAgent(agentId: string, agentPath: string): OpenColabState {
    this.state = {
      ...this.state,
      agent: {
        ...this.state.agent,
        id: agentId,
        path: agentPath
      }
    };

    this.persist();
    ensureAgentFiles(this.config.rootDir, this.state.agent);
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

  private persist(): void {
    writeProjectState(this.config, this.state);
    this.state = readProjectState(this.config);
  }
}

export function createRuntime(cwd = process.cwd(), options: RuntimeOptions = {}): OpenColabRuntime {
  return new OpenColabRuntime(cwd, options);
}
