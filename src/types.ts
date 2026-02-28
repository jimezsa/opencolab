export interface AgentFiles {
  agents: string;
  identity: string;
  soul: string;
  tools: string;
  user: string;
  memory: string;
}

export interface AgentConfig {
  id: string;
  path: string;
  files: AgentFiles;
}

export type ProviderName = "codex" | "claude_code";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  apiKeyEnvVar: string;
  cliCommand: string;
  cliArgs: string[];
}

export interface TelegramConfig {
  botTokenEnvVar: string;
  chatId: string | null;
  paired: boolean;
  pairedAt: string | null;
  pendingPairingCode: string | null;
  pendingPairingExpiresAt: string | null;
}

export interface ProjectState {
  id: string;
  path: string;
  activeAgentId: string;
  agents: Record<string, AgentConfig>;
  provider: ProviderConfig;
  telegram: TelegramConfig;
}

export interface OpenColabState {
  version: 1;
  updatedAt: string;
  activeProjectId: string;
  projects: Record<string, ProjectState>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface TelegramInbound {
  chatId: string;
  sender: string;
  text: string;
}

export interface GatewayResult {
  ok: boolean;
  action:
    | "ignored"
    | "unauthorized_chat"
    | "pairing_required"
    | "agent_response"
    | "management_command";
  response: string;
  sent: boolean;
}
