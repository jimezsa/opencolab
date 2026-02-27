import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

const DEFAULT_FILE_CONTENT: Record<keyof AgentFiles, string> = {
  agents: "# AGENTS\n\nSingle minimalist research agent for Telegram chat.\n",
  identity: "# IDENTITY\n\nYou are OpenColab's research assistant.\n",
  soul: "# SOUL\n\nBe clear, rigorous, and practical.\n",
  tools: "# TOOLS\n\nPrimary runtime: Codex CLI.\n",
  user: "# USER\n\nThe user chats through Telegram.\n"
};

export function resolveAgentDirectory(rootDir: string, agentPath: string): string {
  return path.isAbsolute(agentPath) ? agentPath : path.join(rootDir, agentPath);
}

export function ensureAgentFiles(rootDir: string, agent: AgentConfig): string {
  const agentDir = resolveAgentDirectory(rootDir, agent.path);
  ensureDir(agentDir);

  const files: Array<[keyof AgentFiles, string]> = [
    ["agents", agent.files.agents],
    ["identity", agent.files.identity],
    ["soul", agent.files.soul],
    ["tools", agent.files.tools],
    ["user", agent.files.user]
  ];

  for (const [key, fileName] of files) {
    const filePath = path.join(agentDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, DEFAULT_FILE_CONTENT[key], "utf8");
    }
  }

  return agentDir;
}

export function readAgentDocuments(rootDir: string, agent: AgentConfig): Record<keyof AgentFiles, string> {
  const agentDir = resolveAgentDirectory(rootDir, agent.path);

  const entries: Array<[keyof AgentFiles, string]> = [
    ["agents", agent.files.agents],
    ["identity", agent.files.identity],
    ["soul", agent.files.soul],
    ["tools", agent.files.tools],
    ["user", agent.files.user]
  ];

  const docs = {} as Record<keyof AgentFiles, string>;

  for (const [key, fileName] of entries) {
    const filePath = path.join(agentDir, fileName);
    docs[key] = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  }

  return docs;
}

export function buildAgentPrompt(
  docs: Record<keyof AgentFiles, string>,
  history: ConversationMessage[],
  userMessage: string
): string {
  const systemContext = [
    "[AGENTS]",
    docs.agents,
    "[IDENTITY]",
    docs.identity,
    "[SOUL]",
    docs.soul,
    "[TOOLS]",
    docs.tools,
    "[USER]",
    docs.user
  ].join("\n\n");

  const transcript = history
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  return [
    "You are the single OpenColab research agent.",
    "",
    systemContext,
    "",
    transcript ? "Conversation so far:" : "",
    transcript,
    "",
    `USER: ${userMessage}`,
    "ASSISTANT:"
  ]
    .filter(Boolean)
    .join("\n");
}
