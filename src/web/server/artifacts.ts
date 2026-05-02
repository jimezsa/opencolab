/**
 * Web DTO builders for project artifacts.
 * Walks the project directory (excluding agent state and run scratch space)
 * and classifies discovered files into a small set of artifact kinds.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenColabRuntime } from "../../runtime.js";
import type { ProjectState } from "../../types.js";
import type { WebArtifactKind, WebArtifactSummary } from "../shared/types.js";

interface ListOptions {
  limit?: number;
}

const SKIP_DIR_NAMES = new Set([
  "AGENTS",
  "node_modules",
  ".git",
  ".opencolab",
  ".cache"
]);

const ARTIFACT_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".tex",
  ".bib",
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".jsonl",
  ".log",
  ".html",
  ".ipynb"
]);

const MAX_DEPTH = 5;

export function listProjectArtifacts(
  runtime: OpenColabRuntime,
  projectId: string,
  options: ListOptions = {}
): WebArtifactSummary[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  const projectRoot = resolveProjectRoot(runtime, project);
  if (!fs.existsSync(projectRoot)) {
    return [];
  }
  const collected: WebArtifactSummary[] = [];
  walk(projectRoot, projectRoot, project.id, 0, collected);
  collected.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return options.limit && options.limit > 0 ? collected.slice(0, options.limit) : collected;
}

function resolveProjectRoot(runtime: OpenColabRuntime, project: ProjectState): string {
  return path.isAbsolute(project.path)
    ? project.path
    : path.join(runtime.config.rootDir, project.path);
}

function walk(
  rootDir: string,
  currentDir: string,
  projectId: string,
  depth: number,
  out: WebArtifactSummary[]
): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  const entries = safeReadDir(currentDir);
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      walk(rootDir, fullPath, projectId, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!ARTIFACT_EXTENSIONS.has(ext)) {
      continue;
    }
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }
    const relative = path.relative(rootDir, fullPath);
    out.push({
      id: relative,
      projectId,
      kind: classifyArtifact(relative, entry.name),
      name: entry.name,
      relativePath: relative,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
}

function classifyArtifact(relativePath: string, fileName: string): WebArtifactKind {
  const lower = relativePath.toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  if (lower.includes("findings")) {
    return "findings";
  }
  if (lower.includes("experiments/runs")) {
    if (ext === ".log" || lower.endsWith("status.json") || lower.endsWith("manifest.json")) {
      return "experiment-log";
    }
    if (lower.includes("artifacts")) {
      return ext === ".pdf" ? "compiled-pdf" : "metric";
    }
    return "experiment-log";
  }
  if (lower.includes("/diagrams") || lower.includes("/diagram")) {
    return "diagram";
  }
  if (lower.includes("/figures") || lower.includes("/figure")) {
    return "figure";
  }
  if (lower.includes("/latex") || ext === ".tex" || ext === ".bib") {
    return "latex";
  }
  if (lower.includes("/papers") || (ext === ".pdf" && !lower.includes("compiled"))) {
    return "paper";
  }
  if (lower.includes("/telegram")) {
    return "telegram";
  }
  if (ext === ".pdf") {
    return "compiled-pdf";
  }
  return "other";
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
