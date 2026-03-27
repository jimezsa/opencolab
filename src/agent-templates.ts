import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AGENT_ID } from "./project-config.js";
import type { AgentFiles } from "./types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_TEMPLATES_DIR_CANDIDATES = [
  path.resolve(MODULE_DIR, "agent-templates"),
  path.resolve(MODULE_DIR, "../../src/agent-templates"),
];
const SHARED_AGENT_TEMPLATE_DIR = "shared";
const BUILTIN_AGENT_TEMPLATE_DIRS = {
  beginner: "beginner",
  professor: "professor",
  specialist: "specialist",
} as const;
const BUILTIN_AGENT_TEMPLATE_IDS_BY_AGENT_ID: Record<string, BuiltInAgentTemplateId> = {
  beginner: "beginner",
  [DEFAULT_AGENT_ID]: "professor",
};

const TEMPLATE_FILES: Record<keyof AgentFiles | "builtinTools" | "projectAndTeam", string> = {
  agents: "AGENTS.md",
  bootstrap: "BOOTSTRAP.md",
  identity: "IDENTITY.md",
  alma: "ALMA.md",
  tools: "TOOLS.md",
  user: "USER.md",
  todo: "TODO.md",
  memory: "MEMORY.md",
  builtinTools: "BUILTIN_TOOLS.md",
  projectAndTeam: "PROJECT-AND-TEAM.md",
} as const;

type AgentFileKey = keyof AgentFiles;
type BuiltInAgentTemplateId = keyof typeof BUILTIN_AGENT_TEMPLATE_DIRS;

function resolveAgentTemplatesDirectory(): string {
  for (const candidate of AGENT_TEMPLATES_DIR_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `OpenColab agent templates directory not found. Looked in: ${AGENT_TEMPLATES_DIR_CANDIDATES.join(", ")}`,
  );
}

function resolveSharedTemplatePath(fileName: string): string {
  const sharedTemplatePath = path.join(
    resolveAgentTemplatesDirectory(),
    SHARED_AGENT_TEMPLATE_DIR,
    fileName,
  );
  if (fs.existsSync(sharedTemplatePath)) {
    return sharedTemplatePath;
  }

  throw new Error(
    `OpenColab shared agent template file not found: ${sharedTemplatePath}`,
  );
}

function resolveTemplateFilePath(
  templateId: BuiltInAgentTemplateId,
  fileName: string,
): string {
  const templatesDir = resolveAgentTemplatesDirectory();
  const candidates = [
    path.join(templatesDir, BUILTIN_AGENT_TEMPLATE_DIRS[templateId], fileName),
    path.join(templatesDir, SHARED_AGENT_TEMPLATE_DIR, fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `OpenColab agent template file not found for template "${templateId}" (${fileName}). Looked in: ${candidates.join(", ")}`,
  );
}

function readSharedTemplateFile(fileName: string): string {
  return fs.readFileSync(resolveSharedTemplatePath(fileName), "utf8");
}

function readTemplateFile(
  templateId: BuiltInAgentTemplateId,
  fileName: string,
): string {
  return fs.readFileSync(resolveTemplateFilePath(templateId, fileName), "utf8");
}

function resolveBuiltInAgentTemplateId(agentId: string): BuiltInAgentTemplateId {
  return BUILTIN_AGENT_TEMPLATE_IDS_BY_AGENT_ID[agentId] ?? "specialist";
}

const agentTemplateCache = new Map<
  BuiltInAgentTemplateId,
  Record<AgentFileKey, string>
>();

function loadBuiltInAgentTemplate(
  templateId: BuiltInAgentTemplateId,
): Record<AgentFileKey, string> {
  const cached = agentTemplateCache.get(templateId);
  if (cached) {
    return cached;
  }

  const next: Record<AgentFileKey, string> = {
    agents: readTemplateFile(templateId, TEMPLATE_FILES.agents),
    bootstrap: readTemplateFile(templateId, TEMPLATE_FILES.bootstrap),
    identity: readTemplateFile(templateId, TEMPLATE_FILES.identity),
    alma: readTemplateFile(templateId, TEMPLATE_FILES.alma),
    tools: readTemplateFile(templateId, TEMPLATE_FILES.tools),
    user: readTemplateFile(templateId, TEMPLATE_FILES.user),
    todo: readTemplateFile(templateId, TEMPLATE_FILES.todo),
    memory: readTemplateFile(templateId, TEMPLATE_FILES.memory),
  };
  agentTemplateCache.set(templateId, next);
  return next;
}

export const BUILTIN_TOOLS_CONTEXT = readSharedTemplateFile(
  TEMPLATE_FILES.builtinTools,
);

export const BUILTIN_PROJECT_AND_TEAM_CONTEXT = readSharedTemplateFile(
  TEMPLATE_FILES.projectAndTeam,
);

export function getBuiltInAgentFileContent(
  agentId: string,
  key: AgentFileKey,
): string {
  const templateId = resolveBuiltInAgentTemplateId(agentId);
  return loadBuiltInAgentTemplate(templateId)[key];
}

export function getBuiltInProjectAndTeamContent(): string {
  return BUILTIN_PROJECT_AND_TEAM_CONTEXT;
}
