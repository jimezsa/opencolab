/**
 * Web DTO builders for research runs.
 *
 * Research runs live on disk under `<project>/research/` and
 * `<project>/AGENTS/<agent>/research/`, one folder per run:
 *   <YYYY-MM-DD>-<topic-slug>/
 *     RUN.md         (frontmatter is source of truth)
 *     findings.md
 *     pdf/ meta/ search/ diagrams/ pageindex/
 *
 * This module discovers those runs, parses their RUN.md frontmatter,
 * exposes a flat tree of file metadata, and streams individual files
 * with a strict path-traversal guard. See docs/research_browser_spec.md.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { OpenColabRuntime } from "../../runtime.js";
import { resolveAgentDirectory } from "../../agent.js";
import type { ProjectState } from "../../types.js";
import type {
  WebResearchCorpus,
  WebResearchFile,
  WebResearchFileKind,
  WebResearchRun,
  WebResearchRunDetail,
  WebResearchStatus
} from "../shared/types.js";

const RUN_FOLDER_RE = /^\d{4}-\d{2}-\d{2}-.+$/u;

const VIEWABLE_EXTENSIONS = new Set([
  ".pdf",
  ".md",
  ".markdown",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".json",
  ".txt",
  ".csv",
  ".tsv",
  ".d2",
  ".log"
]);

const FILE_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".d2": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8"
};

const MAX_TREE_DEPTH = 4;

interface ScopeRoot {
  scope: "project" | "agent";
  projectId: string;
  agentId: string | null;
  researchDir: string;
}

interface RunLocation extends ScopeRoot {
  folder: string;
  absDir: string;
}

export function listProjectResearch(
  runtime: OpenColabRuntime,
  projectId: string
): WebResearchRun[] {
  const roots = resolveScopeRoots(runtime, projectId);
  const runs: WebResearchRun[] = [];
  for (const root of roots) {
    for (const folder of discoverRunFolders(root.researchDir)) {
      runs.push(buildRunSummary({ ...root, folder, absDir: path.join(root.researchDir, folder) }));
    }
  }
  runs.sort((a, b) => {
    const left = a.updated ?? a.created ?? "";
    const right = b.updated ?? b.created ?? "";
    return right.localeCompare(left);
  });
  return runs;
}

export function listAgentResearch(
  runtime: OpenColabRuntime,
  projectId: string,
  agentId: string
): WebResearchRun[] {
  return listProjectResearch(runtime, projectId).filter(
    (run) => run.scope === "agent" && run.agentId === agentId
  );
}

export function getResearchRunDetail(
  runtime: OpenColabRuntime,
  projectId: string,
  runId: string
): WebResearchRunDetail | null {
  const location = locateRun(runtime, projectId, runId);
  if (!location) {
    return null;
  }
  const summary = buildRunSummary(location);
  const tree = buildTree(location.absDir);
  const runMdRaw = safeReadFile(path.join(location.absDir, "RUN.md"));
  const { frontmatter, body } = parseFrontmatter(runMdRaw);
  return {
    ...summary,
    tree,
    runMd: { frontmatter, body }
  };
}

export function streamResearchFile(
  runtime: OpenColabRuntime,
  response: ServerResponse,
  projectId: string,
  runId: string,
  relativePath: string,
  ifNoneMatch: string | null
): boolean {
  const location = locateRun(runtime, projectId, runId);
  if (!location) {
    sendJson(response, 404, { error: "unknown_run" });
    return true;
  }
  const safe = resolveSafeFile(location.absDir, relativePath);
  if (!safe) {
    sendJson(response, 400, { error: "invalid_path" });
    return true;
  }
  const stat = safeStat(safe);
  if (!stat || !stat.isFile()) {
    sendJson(response, 404, { error: "file_not_found" });
    return true;
  }
  const ext = path.extname(safe).toLowerCase();
  if (!VIEWABLE_EXTENSIONS.has(ext)) {
    sendJson(response, 415, { error: "unsupported_extension" });
    return true;
  }
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (ifNoneMatch && ifNoneMatch === etag) {
    response.writeHead(304, {
      ETag: etag,
      "Cache-Control": "no-cache"
    });
    response.end();
    return true;
  }
  const mime = FILE_MIME[ext] ?? "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stat.size,
    "Cache-Control": "no-cache",
    ETag: etag
  });
  fs.createReadStream(safe).pipe(response);
  return true;
}

function resolveScopeRoots(
  runtime: OpenColabRuntime,
  projectId: string
): ScopeRoot[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  const projectRoot = resolveProjectRoot(runtime, project);
  const roots: ScopeRoot[] = [];
  const projectResearch = path.join(projectRoot, "research");
  if (fs.existsSync(projectResearch)) {
    roots.push({
      scope: "project",
      projectId: project.id,
      agentId: null,
      researchDir: projectResearch
    });
  }
  for (const agent of Object.values(project.agents)) {
    const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
    const agentResearch = path.join(agentDir, "research");
    if (fs.existsSync(agentResearch)) {
      roots.push({
        scope: "agent",
        projectId: project.id,
        agentId: agent.id,
        researchDir: agentResearch
      });
    }
  }
  return roots;
}

function resolveProjectRoot(
  runtime: OpenColabRuntime,
  project: ProjectState
): string {
  return path.isAbsolute(project.path)
    ? project.path
    : path.join(runtime.config.rootDir, project.path);
}

function discoverRunFolders(researchDir: string): string[] {
  const entries = safeReadDir(researchDir);
  const folders: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!RUN_FOLDER_RE.test(entry.name)) continue;
    folders.push(entry.name);
  }
  return folders;
}

function locateRun(
  runtime: OpenColabRuntime,
  projectId: string,
  runId: string
): RunLocation | null {
  const decoded = decodeRunId(runId);
  if (!decoded) return null;
  const roots = resolveScopeRoots(runtime, projectId);
  for (const root of roots) {
    if (root.scope !== decoded.scope) continue;
    if (root.agentId !== decoded.agentId) continue;
    if (root.projectId !== decoded.projectId) continue;
    if (!RUN_FOLDER_RE.test(decoded.folder)) return null;
    const absDir = path.join(root.researchDir, decoded.folder);
    if (!fs.existsSync(absDir)) return null;
    return { ...root, folder: decoded.folder, absDir };
  }
  return null;
}

function encodeRunId(location: {
  scope: "project" | "agent";
  projectId: string;
  agentId: string | null;
  folder: string;
}): string {
  const parts = [
    location.scope,
    location.projectId,
    location.agentId ?? "",
    location.folder
  ];
  return parts.map(encodeURIComponent).join(":");
}

function decodeRunId(
  runId: string
): { scope: "project" | "agent"; projectId: string; agentId: string | null; folder: string } | null {
  const parts = runId.split(":");
  if (parts.length !== 4) return null;
  const scope = decodeURIComponent(parts[0]);
  if (scope !== "project" && scope !== "agent") return null;
  const projectId = decodeURIComponent(parts[1]);
  const agentRaw = decodeURIComponent(parts[2]);
  const folder = decodeURIComponent(parts[3]);
  return {
    scope,
    projectId,
    agentId: agentRaw === "" ? null : agentRaw,
    folder
  };
}

function buildRunSummary(location: RunLocation): WebResearchRun {
  const warnings: string[] = [];
  const runMdPath = path.join(location.absDir, "RUN.md");
  const hasRunMd = fs.existsSync(runMdPath);
  const runMdRaw = hasRunMd ? safeReadFile(runMdPath) : "";
  const { frontmatter, parseError } = parseFrontmatter(runMdRaw);
  if (parseError) warnings.push(parseError);

  const findingsRel = "findings.md";
  const findingsExists = fs.existsSync(path.join(location.absDir, findingsRel));

  const corpus = readCorpus(location.absDir, frontmatter);
  const created = isoString(frontmatter["created"]) ?? folderDate(location.folder);
  const updated = isoString(frontmatter["updated"]) ?? statMtimeIso(location.absDir);
  const status = normalizeStatus(frontmatter["status"]);
  const topic = stringField(frontmatter["topic"]) ?? location.folder;
  const skill = stringField(frontmatter["skill"]) ?? "unknown";
  const question = stringField(frontmatter["question"]);
  const deliverables = readDeliverables(frontmatter["deliverables"]);

  return {
    id: encodeRunId(location),
    scope: location.scope,
    projectId: location.projectId,
    agentId: location.agentId,
    folder: location.folder,
    skill,
    topic,
    question,
    status,
    created,
    updated,
    corpus,
    deliverables,
    findingsPath: findingsExists ? findingsRel : null,
    hasRunMd,
    warnings
  };
}

function readCorpus(
  absDir: string,
  frontmatter: Record<string, unknown>
): WebResearchCorpus {
  const fromMeta = frontmatter["corpus"];
  if (fromMeta && typeof fromMeta === "object" && !Array.isArray(fromMeta)) {
    const obj = fromMeta as Record<string, unknown>;
    return {
      papers: intField(obj["papers"]) ?? countFilesByExt(path.join(absDir, "pdf"), [".pdf"]),
      summaries: intField(obj["summaries"]) ?? countFilesByExt(path.join(absDir, "pdf"), [".md"]),
      diagrams: intField(obj["diagrams"]) ?? countFilesByExt(path.join(absDir, "diagrams"), [".png", ".svg", ".d2"])
    };
  }
  return {
    papers: countFilesByExt(path.join(absDir, "pdf"), [".pdf"]),
    summaries: countFilesByExt(path.join(absDir, "pdf"), [".md"]),
    diagrams: countFilesByExt(path.join(absDir, "diagrams"), [".png", ".svg", ".d2"])
  };
}

function countFilesByExt(directory: string, exts: string[]): number {
  const entries = safeReadDir(directory);
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (exts.includes(path.extname(entry.name).toLowerCase())) {
      count += 1;
    }
  }
  return count;
}

function buildTree(absDir: string): WebResearchFile[] {
  const out: WebResearchFile[] = [];
  walkTree(absDir, absDir, 0, out);
  const pairings = new Map<string, string>();
  for (const file of out) {
    if (file.kind === "pdf") {
      const summaryRel = file.path.replace(/\.pdf$/iu, ".md");
      if (out.some((other) => other.path === summaryRel)) {
        pairings.set(file.path, summaryRel);
      }
    }
  }
  for (const file of out) {
    if (file.kind === "pdf") {
      file.pairedSummary = pairings.get(file.path) ?? null;
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function walkTree(
  rootDir: string,
  currentDir: string,
  depth: number,
  out: WebResearchFile[]
): void {
  if (depth > MAX_TREE_DEPTH) return;
  const entries = safeReadDir(currentDir);
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      walkTree(rootDir, full, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = safeStat(full);
    if (!stat) continue;
    const rel = path.relative(rootDir, full).split(path.sep).join("/");
    out.push({
      path: rel,
      name: entry.name,
      kind: classifyFile(entry.name),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      pairedSummary: null
    });
  }
}

function classifyFile(fileName: string): WebResearchFileKind {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".png") return "image-png";
  if (ext === ".svg") return "image-svg";
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return "image-other";
  if (ext === ".json") return "json";
  if (ext === ".txt" || ext === ".csv" || ext === ".tsv" || ext === ".log" || ext === ".d2") {
    return "text";
  }
  return "other";
}

function resolveSafeFile(runDir: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const absolute = path.resolve(runDir, normalized);
  const runDirResolved = path.resolve(runDir);
  if (absolute !== runDirResolved && !absolute.startsWith(`${runDirResolved}${path.sep}`)) {
    return null;
  }
  try {
    const real = fs.realpathSync(absolute);
    if (real !== runDirResolved && !real.startsWith(`${runDirResolved}${path.sep}`)) {
      return null;
    }
    return real;
  } catch {
    return null;
  }
}

/**
 * Tiny YAML frontmatter parser tailored to the research RUN.md shape:
 *   - delimited by `---` lines at the very start of the file
 *   - flat `key: value` pairs (strings, numbers, ISO dates)
 *   - one level of nested object via indentation (e.g. `corpus:` + `  papers: 12`)
 *   - one level of flat list via `key:` + `  - item` lines (e.g. `deliverables:`)
 * Returns `parseError` when frontmatter is present but malformed.
 */
export function parseFrontmatter(
  raw: string
): { frontmatter: Record<string, unknown>; body: string; parseError?: string } {
  if (!raw) return { frontmatter: {}, body: "" };
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: raw };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      frontmatter: {},
      body: raw,
      parseError: "RUN.md frontmatter is missing closing `---`"
    };
  }
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/u, "");
  try {
    const fm = parseYamlBlock(fmLines);
    return { frontmatter: fm, body };
  } catch (error) {
    return {
      frontmatter: {},
      body,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseYamlBlock(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    if (/^\s/u.test(line)) {
      throw new Error("unexpected indentation at top level");
    }
    const match = /^([A-Za-z_][\w.-]*):\s*(.*)$/u.exec(line);
    if (!match) {
      throw new Error(`malformed line: ${line}`);
    }
    const key = match[1];
    const inline = match[2];
    if (inline.length > 0) {
      out[key] = coerceScalar(inline);
      i += 1;
      continue;
    }
    const childLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && (/^\s/u.test(lines[j]) || lines[j].trim() === "")) {
      childLines.push(lines[j]);
      j += 1;
    }
    if (childLines.length === 0) {
      out[key] = null;
      i = j;
      continue;
    }
    const trimmedSamples = childLines.filter((l) => l.trim() !== "");
    if (trimmedSamples.length > 0 && trimmedSamples[0].trim().startsWith("- ")) {
      out[key] = childLines
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => coerceScalar(l.trim().slice(2)));
    } else {
      const dedented = stripIndent(childLines).filter((l) => l.trim() !== "");
      out[key] = parseYamlBlock(dedented);
    }
    i = j;
  }
  return out;
}

function stripIndent(lines: string[]): string[] {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const lead = line.match(/^\s*/u);
    if (lead) indent = Math.min(indent, lead[0].length);
  }
  if (!Number.isFinite(indent)) return lines;
  return lines.map((line) => line.slice(indent));
}

function coerceScalar(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+$/u.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/u.test(trimmed)) return Number.parseFloat(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  return trimmed;
}

function stringField(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

function intField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
  return null;
}

function isoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    const date = new Date(trimmed);
    if (Number.isFinite(date.getTime())) return date.toISOString();
    return trimmed;
  }
  return null;
}

function normalizeStatus(value: unknown): WebResearchStatus {
  if (typeof value !== "string") return "unknown";
  const lower = value.trim().toLowerCase();
  if (lower === "running" || lower === "complete" || lower === "failed" || lower === "abandoned") {
    return lower;
  }
  return "unknown";
}

function readDeliverables(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return [];
}

function folderDate(folder: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})-/u.exec(folder);
  return match ? `${match[1]}T00:00:00.000Z` : null;
}

function statMtimeIso(target: string): string | null {
  const stat = safeStat(target);
  return stat ? stat.mtime.toISOString() : null;
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function safeReadFile(target: string): string {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return "";
  }
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}
