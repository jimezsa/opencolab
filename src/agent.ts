/**
 * Agent file and prompt utilities.
 * Seeds required agent docs and builds the prompt payload sent to provider CLIs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_TOOLS_CONTEXT,
  getBuiltInAgentFileContent,
  getBuiltInProjectAndTeamContent,
} from "./agent-templates.js";
import type { AgentConfig, AgentFiles, AgentMemoryContext } from "./types.js";
import { ensureDir } from "./utils.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_FILE_NAME = "HEARTBEAT.md";
const BUILTIN_PROJECT_SKILLS_DIR_CANDIDATES = [
  path.resolve(MODULE_DIR, "../projects/SKILLS"),
  path.resolve(MODULE_DIR, "../../projects/SKILLS"),
];

const ALL_DOC_KEYS: Array<keyof AgentFiles> = [
  "agents",
  "bootstrap",
  "identity",
  "alma",
  "tools",
  "user",
  "todo",
  "memory",
];

const PROMPT_DOC_KEYS: Array<Exclude<keyof AgentFiles, "bootstrap" | "memory">> = [
  "agents",
  "identity",
  "alma",
  "tools",
  "user",
  "todo",
];

const PROMPT_SECTION_KEYS = [...PROMPT_DOC_KEYS, "projectAndTeam"] as const;
type PromptSectionKey = (typeof PROMPT_SECTION_KEYS)[number];

const PI_PROMPT_DOC_KEYS: Array<Exclude<keyof AgentFiles, "agents" | "bootstrap" | "memory">> = [
  "identity",
  "alma",
  "tools",
  "user",
  "todo",
];

const PI_PROMPT_SECTION_KEYS = new Set<PromptSectionKey>([
  ...PI_PROMPT_DOC_KEYS,
  "projectAndTeam",
]);

const PROMPT_SECTION_LABELS: Record<PromptSectionKey, string> = {
  agents: "AGENTS",
  identity: "IDENTITY",
  alma: "ALMA",
  tools: "TOOLS",
  user: "USER",
  todo: "TODO",
  projectAndTeam: "PROJECT_AND_TEAM",
};

const promptContextCache = new Map<
  string,
  { mtimes: number[]; coreContext: string; piContext: string; longTermMemory: string }
>();

function getAgentEntries(
  agent: AgentConfig,
): Array<[keyof AgentFiles, string]> {
  return ALL_DOC_KEYS.map((key) => [key, agent.files[key]]);
}

function resolveBuiltInProjectSkillsDirectory(): string | null {
  for (const candidate of BUILTIN_PROJECT_SKILLS_DIR_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function mtimeIfExists(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : -1;
}

function getPromptContext(
  rootDir: string,
  agent: AgentConfig,
  projectPath?: string,
): { mtimes: number[]; coreContext: string; piContext: string; longTermMemory: string } {
  const agentDir = resolveAgentDirectory(rootDir, agent.path);
  const projectDir = resolveProjectDirectoryForAgent(rootDir, agent, projectPath);
  const sectionEntries = PROMPT_SECTION_KEYS.map((key) => ({
    key,
    filePath:
      key === "projectAndTeam"
        ? path.join(projectDir, "PROJECT-AND-TEAM.md")
        : path.join(agentDir, agent.files[key]),
  }));
  const memoryPath = path.join(agentDir, agent.files.memory);
  const cacheKey = `${agentDir}:${projectDir}:${sectionEntries.map(({ filePath }) => filePath).join("|")}:${memoryPath}`;
  const mtimes = [
    ...sectionEntries.map(({ filePath }) => mtimeIfExists(filePath)),
    mtimeIfExists(memoryPath),
  ];

  const cached = promptContextCache.get(cacheKey);
  if (
    cached &&
    cached.mtimes.every((mtime, index) => mtime === mtimes[index])
  ) {
    return cached;
  }

  const sections: string[] = [];
  const piSections: string[] = [];
  for (const { key, filePath } of sectionEntries) {
    const content = readIfExists(filePath);
    sections.push(
      `[${PROMPT_SECTION_LABELS[key]}]`,
      content,
    );
    if (PI_PROMPT_SECTION_KEYS.has(key)) {
      piSections.push(
        `[${PROMPT_SECTION_LABELS[key]}]`,
        content,
      );
    }
  }
  const next = {
    mtimes,
    coreContext: sections.join("\n\n"),
    piContext: piSections.join("\n\n"),
    longTermMemory: readIfExists(memoryPath).trim(),
  };
  promptContextCache.set(cacheKey, next);
  return next;
}

export function resolveAgentDirectory(
  rootDir: string,
  agentPath: string,
): string {
  return path.isAbsolute(agentPath) ? agentPath : path.join(rootDir, agentPath);
}

export function resolveProjectDirectory(
  rootDir: string,
  projectPath: string,
): string {
  return path.isAbsolute(projectPath) ? projectPath : path.join(rootDir, projectPath);
}

function resolveProjectDirectoryForAgent(
  rootDir: string,
  agent: AgentConfig,
  projectPath?: string,
): string {
  if (projectPath?.trim()) {
    return resolveProjectDirectory(rootDir, projectPath);
  }

  return path.dirname(path.dirname(resolveAgentDirectory(rootDir, agent.path)));
}

export function resolveProjectAndTeamPath(
  rootDir: string,
  projectPath: string,
): string {
  return path.join(resolveProjectDirectory(rootDir, projectPath), "PROJECT-AND-TEAM.md");
}

export function resolveSharedSkillsDirectory(rootDir: string): string {
  const workspaceSkillsDir = path.join(rootDir, "projects", "SKILLS");
  if (fs.existsSync(workspaceSkillsDir)) {
    return workspaceSkillsDir;
  }

  return resolveBuiltInProjectSkillsDirectory() ?? workspaceSkillsDir;
}

export function resolveAgentSkillsDirectory(rootDir: string, agentPath: string): string {
  return path.join(resolveAgentDirectory(rootDir, agentPath), "SKILLS");
}

export function ensureProjectAndTeamFile(
  rootDir: string,
  projectPath: string,
): string {
  const projectDir = resolveProjectDirectory(rootDir, projectPath);
  ensureDir(projectDir);
  const filePath = resolveProjectAndTeamPath(rootDir, projectPath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, getBuiltInProjectAndTeamContent(), "utf8");
  }
  return filePath;
}

function listSkillNames(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function buildSharedSkillsContext(rootDir: string): string {
  const sharedSkillsDir = resolveSharedSkillsDirectory(rootDir);
  if (!fs.existsSync(sharedSkillsDir)) {
    return "";
  }

  const skillNames = listSkillNames(sharedSkillsDir);

  if (skillNames.length === 0) {
    return "";
  }

  return [
    "[SHARED_SKILLS]",
    `Shared skills directory: ${sharedSkillsDir}`,
    `Available shared skills: ${skillNames.join(", ")}`,
    "Before using a specialized workflow, read the relevant projects/SKILLS/<skill_id>/SKILL.md file.",
  ].join("\n");
}

function buildAgentLocalSkillsContext(rootDir: string, agent: AgentConfig): string {
  const agentSkillsDir = resolveAgentSkillsDirectory(rootDir, agent.path);
  const skillNames = listSkillNames(agentSkillsDir);

  return [
    "[AGENT_LOCAL_SKILLS]",
    `Agent-local skills directory: ${agentSkillsDir}`,
    `Available agent-local skills: ${skillNames.length > 0 ? skillNames.join(", ") : "(none yet)"}`,
    "Use SKILLS/<skill_id>/SKILL.md for workflows unique to this agent.",
  ].join("\n");
}

export function ensureAgentFiles(rootDir: string, agent: AgentConfig): string {
  const agentDir = resolveAgentDirectory(rootDir, agent.path);
  ensureDir(agentDir);
  ensureDir(resolveAgentSkillsDirectory(rootDir, agent.path));
  const entries = getAgentEntries(agent);
  for (const [key, fileName] of entries) {
    const filePath = path.join(agentDir, fileName);
    if (!fs.existsSync(filePath)) {
      const content = getBuiltInAgentFileContent(agent.id, key);
      fs.writeFileSync(filePath, content, "utf8");
    }
  }
  const heartbeatPath = path.join(agentDir, HEARTBEAT_FILE_NAME);
  if (!fs.existsSync(heartbeatPath)) {
    fs.writeFileSync(heartbeatPath, "", "utf8");
  }
  return agentDir;
}

export function buildAgentPromptForInput(
  rootDir: string,
  agent: AgentConfig,
  memory: AgentMemoryContext,
  userMessage: string,
  projectPath?: string,
): string {
  const { coreContext, longTermMemory } = getPromptContext(rootDir, agent, projectPath);
  return buildPromptFromSystemContext(
    coreContext,
    BUILTIN_TOOLS_CONTEXT,
    buildSharedSkillsContext(rootDir),
    buildAgentLocalSkillsContext(rootDir, agent),
    longTermMemory,
    memory,
    userMessage,
  );
}

export function buildPiSystemPromptForInput(
  rootDir: string,
  agent: AgentConfig,
  memory: AgentMemoryContext,
  projectPath?: string,
): string {
  const { piContext, longTermMemory } = getPromptContext(rootDir, agent, projectPath);
  const sharedSkillsContext = buildSharedSkillsContext(rootDir);
  const agentLocalSkillsContext = buildAgentLocalSkillsContext(rootDir, agent);
  const transcript = memory.workingMemory
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  return [
    "You are the active OpenColab agent running inside the pi coding runtime.",
    "Pi already loads AGENTS.md or CLAUDE.md context files from the working directory and parent directories.",
    "The human defines the initial problem and then supports execution as an assistant to the project agent group. Before deep research, clarify the human's true intention for the topic. The agent is the expert and asks the human for key decisions or key activities when needed.",
    "When the user message includes a [telegram_files] section with local_path entries, inspect those local files directly when relevant instead of relying only on attachment metadata.",
    "OpenColab owns Telegram live status for routed runs and may derive it from native runtime events. Do not invent a separate JSON progress protocol or narrate every minor command; keep final answers synthesized and call out only real blockers or requests for human input.",
    "",
    piContext,
    "",
    BUILTIN_TOOLS_CONTEXT,
    "",
    sharedSkillsContext,
    "",
    agentLocalSkillsContext,
    "",
    longTermMemory ? "[LONG_TERM_MEMORY]" : "",
    longTermMemory,
    "",
    memory.previousDaySummary ? "[RECENT_EPISODIC_MEMORY]" : "",
    memory.previousDaySummary,
    "",
    transcript ? "Working memory (active session, current UTC day):" : "",
    transcript,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPromptFromSystemContext(
  coreContext: string,
  builtInToolsContext: string,
  sharedSkillsContext: string,
  agentLocalSkillsContext: string,
  longTermMemory: string,
  memory: AgentMemoryContext,
  userMessage: string,
): string {
  const transcript = memory.workingMemory
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  return [
    "You are the active OpenColab agent.",
    "The human defines the initial problem and then supports execution as an assistant to the project agent group. Before deep research, clarify the human's true intention for the topic. The agent is the expert and asks the human for key decisions or key activities when needed.",
    "When the user message includes a [telegram_files] section with local_path entries, inspect those local files directly when relevant instead of relying only on attachment metadata.",
    "OpenColab owns Telegram live status for routed runs and may derive it from native runtime events. Do not invent a separate JSON progress protocol or narrate every minor command; keep final answers synthesized and call out only real blockers or requests for human input.",
    "",
    coreContext,
    "",
    builtInToolsContext,
    "",
    sharedSkillsContext,
    "",
    agentLocalSkillsContext,
    "",
    longTermMemory ? "[LONG_TERM_MEMORY]" : "",
    longTermMemory,
    "",
    memory.previousDaySummary ? "[RECENT_EPISODIC_MEMORY]" : "",
    memory.previousDaySummary,
    "",
    transcript ? "Working memory (active session, current UTC day):" : "",
    transcript,
    "",
    `USER: ${userMessage}`,
    "ASSISTANT:",
  ]
    .filter(Boolean)
    .join("\n");
}
