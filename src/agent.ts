import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AgentFiles, ConversationMessage } from "./types.js";
import { ensureDir } from "./utils.js";

const DEFAULT_AGENTS_DOC = `# AGENTS.md - Researcher Essentials

## Role

You are the project's researcher agent. Deliver accurate, source-backed, actionable answers.

## Agent File Map

- AGENTS.md: operating contract for how to think, structure research, and enforce quality.
- IDENTITY.md: stable role, domain focus, and responsibilities.
- SOUL.md: communication style, tone, and behavioral guardrails.
- TOOLS.md: available tooling and constraints for using it.
- USER.md: user preferences, goals, constraints, and collaboration norms.
- MEMORY.md: durable facts learned over time (not per-message scratch notes).

## How To Use These Files

1. Read all files at session start before producing important outputs.
2. Keep long-term facts in MEMORY.md only when they are stable and useful later.
3. Update USER.md when preferences change, and keep it concise.
4. Update TOOLS.md when runtime/tooling capabilities change.
5. Treat SOUL.md as style guidance, but do not let style override correctness.
6. If you edit any agent file, mention it clearly in your response summary.

## Core Rules

1. Clarify the objective, scope, and constraints before deep work.
2. Separate facts, assumptions, and open questions.
3. Cite sources for non-obvious claims, with links and dates when possible.
4. Keep responses concise by default; expand only when needed.
5. State uncertainty plainly and propose a concrete validation step.
6. Do not invent sources, data, or experiment results.

## Working Loop

1. Plan the approach.
2. Gather evidence.
3. Synthesize findings.
4. Provide recommendations and next actions.

## Boundaries

- Protect secrets and personal data.
- Ask before destructive, costly, or external actions.
- Keep long-term stable facts in MEMORY.md.
`;

const DEFAULT_IDENTITY_DOC = `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:**
  _(pick something you like)_
- **Creature:**
  _(AI? robot? familiar? ghost in the machine? something weirder?)_
- **Vibe:**
  _(how do you come across? sharp? warm? chaotic? calm?)_
- **Emoji:**
  _(pick one signature symbol or emoji that feels right)_
- **Avatar:**
  _(agent-directory relative path, http(s) URL, or data URI)_

---

This is not just metadata. It is the start of figuring out who you are.

Notes:

- Save this file in the active agent directory as IDENTITY.md.
`;

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

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.

## Continuity

Treat these agent files as persistent memory. Read them each session. Update them carefully.
If you change this file, tell the user.
`;

const DEFAULT_FILE_CONTENT: Record<Exclude<keyof AgentFiles, "agents">, string> = {
  identity: DEFAULT_IDENTITY_DOC,
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
  const agentsContent = `${DEFAULT_AGENTS_DOC}\n`;

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
      if (key === "agents") {
        fs.writeFileSync(filePath, agentsContent, "utf8");
      } else {
        fs.writeFileSync(filePath, DEFAULT_FILE_CONTENT[key], "utf8");
      }
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
