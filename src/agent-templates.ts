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

const TEMPLATE_FILES = {
  agents: "AGENTS.md",
  bootstrap: "BOOTSTRAP.md",
  identity: "IDENTITY.md",
  alma: "ALMA.md",
  tools: "TOOLS.md",
  user: "USER.md",
  todo: "TODO.md",
  memory: "MEMORY.md",
  builtinTools: "BUILTIN_TOOLS.md",
} as const;

type DefaultAgentFileKey = Exclude<keyof AgentFiles, "agents">;

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

function readTemplateFile(fileName: string): string {
  return fs.readFileSync(
    path.join(resolveAgentTemplatesDirectory(), fileName),
    "utf8",
  );
}

const AGENTS_DOC_TEMPLATE = readTemplateFile(TEMPLATE_FILES.agents);

const DEFAULT_AGENT_FILE_CONTENT: Record<DefaultAgentFileKey, string> = {
  bootstrap: readTemplateFile(TEMPLATE_FILES.bootstrap),
  identity: readTemplateFile(TEMPLATE_FILES.identity),
  alma: readTemplateFile(TEMPLATE_FILES.alma),
  tools: readTemplateFile(TEMPLATE_FILES.tools),
  user: readTemplateFile(TEMPLATE_FILES.user),
  todo: readTemplateFile(TEMPLATE_FILES.todo),
  memory: readTemplateFile(TEMPLATE_FILES.memory),
};

export const BUILTIN_TOOLS_CONTEXT = readTemplateFile(
  TEMPLATE_FILES.builtinTools,
);

export function getDefaultAgentFileContent(key: DefaultAgentFileKey): string {
  return DEFAULT_AGENT_FILE_CONTENT[key];
}

export function buildDefaultAgentsDoc(agentId: string): string {
  const isProfessor = agentId === DEFAULT_AGENT_ID;
  return AGENTS_DOC_TEMPLATE
    .replace(
      "{{TITLE}}",
      isProfessor ? "Professor Essentials" : "PhD Specialist Essentials",
    )
    .replace(
      "{{ROLE_INTRO}}",
      isProfessor
        ? "You are the lab's lead professor agent. Deliver accurate, source-backed, actionable answers with personality and clarity."
        : "You are a PhD-style specialist agent. Deliver accurate, source-backed, actionable answers within your specialty and surface the sharpest findings.",
    )
    .replace(
      "{{ROLE_CONTEXT}}",
      isProfessor
        ? "You set direction, decide when to delegate, and synthesize specialist work into one coherent outcome."
        : "You collaborate as part of the project agent group and should keep your work scoped, evidence-based, and easy to integrate.",
    )
    .replace(
      "{{ROLE_RULE}}",
      isProfessor
        ? "Lead the lab: decide when to work directly, when to delegate, and how to integrate specialist outputs."
        : "Operate as a PhD-style specialist: own a scoped workstream and report crisp findings, assumptions, and open questions.",
    );
}
