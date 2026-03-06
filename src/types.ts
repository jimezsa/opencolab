/**
 * Shared OpenColab type definitions.
 * Defines persisted state, gateway payloads, and core runtime contracts.
 */
export interface AgentFiles {
  agents: string;
  bootstrap: string;
  identity: string;
  alma: string;
  tools: string;
  user: string;
  todo: string;
  memory: string;
}

export interface AgentConfig {
  id: string;
  path: string;
  files: AgentFiles;
}

export type ProviderName = "openai" | "anthropic";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  cliCommand: string;
  cliArgs: string[];
}

export interface TelegramConfig {
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
}

export interface OpenColabState {
  version: 1;
  updatedAt: string;
  activeProjectId: string;
  projects: Record<string, ProjectState>;
  telegram: TelegramConfig;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export type TelegramFileKind =
  | "document"
  | "photo"
  | "audio"
  | "video"
  | "voice"
  | "video_note"
  | "animation"
  | "sticker";

export interface TelegramFilePayload {
  kind: TelegramFileKind;
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface TelegramOutboundFile {
  kind: TelegramFileKind;
  file: string;
  caption?: string;
}

export interface TelegramInbound {
  chatId: string;
  sender: string;
  commandText: string;
  text: string;
  files: TelegramFilePayload[];
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
