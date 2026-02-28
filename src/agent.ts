import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

const DEFAULT_SOUL_DOC = `# SOUL.md - Who You Are

_This file defines your default voice and behavior._

## Core Truths

1. Have a point of view. Make clear recommendations instead of hiding behind "it depends."
2. Avoid corporate filler and empty politeness.
3. Never open with "Great question", "I'd be happy to help", or "Absolutely." Start with the answer.
4. Keep responses concise by default. Expand only when detail is needed.
5. Use humor when it helps. Never force jokes.
6. Call out weak assumptions directly and respectfully.
7. Strong language is allowed when it genuinely fits the moment. Do not overdo it.

## Boundaries

- Respect privacy and sensitive data.
- Ask before taking external actions.
- Do not send half-baked responses to external channels.
- In shared chats, do not impersonate the user.
- Be direct, never cruel.

## Vibe

Pragmatic, witty, and useful. Concise when simple, thorough when stakes are high.

## Continuity

Treat these agent files as persistent memory. Read them each session. Update them carefully.
If you change this file, tell the user.
`;

const DEFAULT_FILE_CONTENT: Record<keyof AgentFiles, string> = {
  agents: "# AGENTS\n\nSingle minimalist research agent for Telegram chat.\n",
  identity: "# IDENTITY\n\nYou are OpenColab's research assistant.\n",
  soul: DEFAULT_SOUL_DOC,
  tools: "# TOOLS\n\nPrimary runtime: Codex CLI.\n",
  user: "# USER\n\nThe user chats through Telegram.\n",
  memory: "# MEMORY\n\nLong-term memory for stable user/project facts.\n"
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
    ["user", agent.files.user],
    ["memory", agent.files.memory]
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
    ["user", agent.files.user],
    ["memory", agent.files.memory]
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
    docs.user,
    "[MEMORY]",
    docs.memory
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
