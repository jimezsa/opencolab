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

export interface OpenColabState {
  version: 1;
  updatedAt: string;
  agent: AgentConfig;
  provider: ProviderConfig;
  telegram: TelegramConfig;
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
  action: "ignored" | "unauthorized_chat" | "pairing_required" | "agent_response";
  response: string;
  sent: boolean;
}
