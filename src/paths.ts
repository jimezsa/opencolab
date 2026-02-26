import fs from "node:fs";
import path from "node:path";
import type { OpenColabConfig } from "./config.js";

export interface RunPaths {
  base: string;
  prompts: string;
  outputs: string;
  logs: string;
  artifacts: string;
  screenshots: string;
  chats: string;
  meetings: string;
}

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function initWorkspace(config: OpenColabConfig): void {
  ensureDir(config.projectsDir);
  ensureDir(config.skillsDir);
}

export function projectPath(config: OpenColabConfig, projectName: string): string {
  return path.join(config.projectsDir, projectName);
}

export function ensureProjectLayout(config: OpenColabConfig, projectName: string): string {
  const base = ensureDir(projectPath(config, projectName));
  ensureDir(path.join(base, "runs"));
  ensureDir(path.join(base, "repos", "shared"));
  ensureDir(path.join(base, "repos", "agents"));
  ensureDir(path.join(base, "papers"));
  const memoryPath = path.join(base, "memory.md");
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, "# Project Memory\n\n", "utf8");
  }

  return base;
}

export function ensureRunLayout(
  config: OpenColabConfig,
  projectName: string,
  runId: string
): RunPaths {
  const base = ensureDir(path.join(projectPath(config, projectName), "runs", runId));

  return {
    base,
    prompts: ensureDir(path.join(base, "prompts")),
    outputs: ensureDir(path.join(base, "outputs")),
    logs: ensureDir(path.join(base, "logs")),
    artifacts: ensureDir(path.join(base, "artifacts")),
    screenshots: ensureDir(path.join(base, "screenshots")),
    chats: ensureDir(path.join(base, "chats")),
    meetings: ensureDir(path.join(base, "meetings"))
  };
}

export function ensurePaperLayout(
  config: OpenColabConfig,
  projectName: string,
  paperId: string
): { latexDir: string; buildsDir: string } {
  const paperBase = ensureDir(path.join(projectPath(config, projectName), "papers", paperId));
  return {
    latexDir: ensureDir(path.join(paperBase, "latex")),
    buildsDir: ensureDir(path.join(paperBase, "builds"))
  };
}
