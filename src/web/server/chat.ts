/**
 * Studio web chat backend.
 *
 * Owns the per-process turn registry, upload/returned-file registry, server-sent
 * events for live status, and the chat HTTP routes mounted under
 * /api/web/projects/<projectId>/chat. Wraps OpenColabRuntime to share memory,
 * provider execution, and conversation persistence with the Telegram gateway
 * without pretending the browser is a Telegram chat.
 */
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveAgentDirectory } from "../../agent.js";
import {
  buildAgentFailureMessage,
  buildAssistantRecoveryLog,
  isProviderTimeoutError
} from "../../gateway.js";
import type { OpenColabRuntime } from "../../runtime.js";
import type {
  AgentConfig,
  ConversationMessage,
  ProjectState,
  TaskProgressEvent,
  TelegramFilePayload
} from "../../types.js";
import { ensureDir, nowIso } from "../../utils.js";
import { listAgentConversations } from "./conversations.js";
import type {
  WebChatAgentOption,
  WebChatAttachment,
  WebChatAttachmentKind,
  WebChatMessage,
  WebChatNewSessionResponse,
  WebChatProgressEvent,
  WebChatSendRequest,
  WebChatSendResponse,
  WebChatSessionDetail,
  WebChatSessionSummary,
  WebChatTurn,
  WebChatTurnStatus,
  WebChatUploadResponse,
  WebConversationSummary
} from "../shared/types.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 250 * 1024 * 1024;
const PROGRESS_HISTORY_LIMIT = 50;
const SSE_KEEPALIVE_MS = 15_000;

interface FileEntry {
  id: string;
  absolutePath: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: WebChatAttachmentKind;
  source: "upload" | "returned";
  relativeRoot: string;
  projectId: string;
  agentId: string;
}

interface UploadEntry extends FileEntry {
  source: "upload";
  uploadedAt: string;
  originalName: string;
}

interface TurnState {
  turn: WebChatTurn;
  abort: AbortController;
  agentDir: string;
  subscribers: Set<ServerResponse>;
  startedAtMs: number;
}

const FILE_REGISTRY = new Map<string, FileEntry>();
const UPLOAD_REGISTRY = new Map<string, UploadEntry>();
const TURNS = new Map<string, TurnState>();

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendError(response: ServerResponse, status: number, error: string, extra?: Record<string, unknown>): void {
  sendJson(response, status, { error, ...(extra ?? {}) });
}

async function readRequestBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new Error("request_body_too_large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const buffer = await readRequestBody(request, 4 * 1024 * 1024);
  if (buffer.length === 0) {
    return {} as T;
  }
  return JSON.parse(buffer.toString("utf8")) as T;
}

function detectAttachmentKind(name: string, mimeType: string | null | undefined): WebChatAttachmentKind {
  const lowerName = name.toLowerCase();
  const ext = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".") + 1) : "";
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return "image";
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (mime.includes("markdown") || ["md", "markdown"].includes(ext)) return "markdown";
  if (
    mime.startsWith("text/") ||
    ["txt", "csv", "tsv", "json", "yaml", "yml", "log", "py", "ts", "tsx", "js", "jsx", "rs", "go", "java", "c", "h", "cpp", "hpp", "sh", "html", "css"].includes(ext)
  ) {
    return mime.includes("markdown") || ["md", "markdown"].includes(ext) ? "markdown" : "text";
  }
  if (["zip", "tar", "gz", "tgz", "bz2", "7z", "rar"].includes(ext)) return "archive";
  return "other";
}

function detectMimeType(name: string, fallback: string | null | undefined): string {
  if (fallback && fallback !== "application/octet-stream") {
    return fallback;
  }
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "md":
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "txt":
    case "log":
      return "text/plain; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "tsv":
      return "text/tab-separated-values; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "html":
      return "text/html; charset=utf-8";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "zip":
      return "application/zip";
    default:
      return fallback ?? "application/octet-stream";
  }
}

function normalizeSafeFilename(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    return "upload.bin";
  }
  const base = path.basename(trimmed.replace(/\\/g, "/"));
  const noLeading = base.replace(/^\.+/, "");
  const ascii = noLeading
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = ascii || "upload.bin";
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

function todayIso(): string {
  const now = new Date();
  return `${String(now.getUTCFullYear()).padStart(4, "0")}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function fileUrl(projectId: string, fileId: string): string {
  return `/api/web/projects/${encodeURIComponent(projectId)}/chat/files/${encodeURIComponent(fileId)}`;
}

function rawFileUrl(projectId: string, fileId: string): string {
  return `${fileUrl(projectId, fileId)}?disposition=inline`;
}

function projectAgentRoots(runtime: OpenColabRuntime, project: ProjectState, agent: AgentConfig): {
  agentDir: string;
  uploadsDir: string;
} {
  const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
  void project;
  return {
    agentDir,
    uploadsDir: path.join(agentDir, "uploads")
  };
}

function ensureUnderRoot(absolute: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(absolute);
  for (const root of allowedRoots) {
    const rootResolved = path.resolve(root);
    const rel = path.relative(rootResolved, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      try {
        if (fs.existsSync(resolved)) {
          const real = fs.realpathSync(resolved);
          const realRoot = fs.realpathSync(rootResolved);
          const realRel = path.relative(realRoot, real);
          if (realRel === "" || (!realRel.startsWith("..") && !path.isAbsolute(realRel))) {
            return true;
          }
          continue;
        }
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

function registerFile(entry: FileEntry): void {
  FILE_REGISTRY.set(entry.id, entry);
}

function buildAttachmentDto(entry: FileEntry): WebChatAttachment {
  const relative = path.relative(entry.relativeRoot, entry.absolutePath).split(path.sep).join("/");
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    relativePath: relative,
    previewUrl: rawFileUrl(entry.projectId, entry.id),
    rawUrl: fileUrl(entry.projectId, entry.id),
    source: entry.source
  };
}

function buildAgentOption(
  runtime: OpenColabRuntime,
  project: ProjectState,
  agent: AgentConfig
): WebChatAgentOption {
  const agentDir = resolveAgentDirectory(runtime.config.rootDir, agent.path);
  const todoPath = path.join(agentDir, agent.files.todo);
  let todoSummary: string | null = null;
  if (fs.existsSync(todoPath)) {
    const text = fs.readFileSync(todoPath, "utf8");
    const firstBullet = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line));
    if (firstBullet) {
      todoSummary = firstBullet.replace(/^([-*+]|\d+\.)\s+/, "").trim();
    }
  }
  return {
    id: agent.id,
    projectId: project.id,
    active: project.activeAgentId === agent.id,
    busy: isAgentBusy(runtime, project.id, agent.id),
    provider: {
      name: agent.provider.name,
      model: agent.provider.model,
      authMode: agent.provider.authMode,
      reasoningEffort: agent.provider.reasoningEffort ?? null
    },
    todoSummary
  };
}

function isAgentBusy(runtime: OpenColabRuntime, projectId: string, agentId: string): boolean {
  for (const turn of TURNS.values()) {
    if (
      turn.turn.projectId === projectId &&
      turn.turn.agentId === agentId &&
      (turn.turn.status === "queued" || turn.turn.status === "running")
    ) {
      return true;
    }
  }
  return runtime.isAgentBusyOnGateway(projectId, agentId);
}

function findRunningTurn(projectId: string, agentId: string, sessionId: string): WebChatTurn | null {
  for (const turn of TURNS.values()) {
    if (
      turn.turn.projectId === projectId &&
      turn.turn.agentId === agentId &&
      turn.turn.sessionId === sessionId &&
      (turn.turn.status === "queued" || turn.turn.status === "running")
    ) {
      return turn.turn;
    }
  }
  return null;
}

function listChatAgents(runtime: OpenColabRuntime, projectId: string): WebChatAgentOption[] {
  const project = runtime.getState().projects[projectId];
  if (!project) {
    return [];
  }
  return Object.values(project.agents)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((agent) => buildAgentOption(runtime, project, agent));
}

function buildSessionSummary(runtime: OpenColabRuntime, projectId: string, agentId: string, source: WebConversationSummary): WebChatSessionSummary {
  void runtime;
  return {
    sessionId: source.sessionId,
    projectId,
    agentId,
    active: source.active,
    messageCount: source.messageCount,
    lastMessageAt: source.lastMessageAt,
    lastMessagePreview: source.lastMessagePreview
  };
}

function listChatSessions(runtime: OpenColabRuntime, projectId: string, agentId: string): WebChatSessionSummary[] {
  const summaries = listAgentConversations(runtime, projectId, agentId, { limit: 50 });
  return summaries.map((s) => buildSessionSummary(runtime, projectId, agentId, s));
}

function buildSessionDetail(
  runtime: OpenColabRuntime,
  projectId: string,
  agentId: string,
  sessionId: string
): WebChatSessionDetail | null {
  let project: ProjectState;
  let agent: AgentConfig;
  try {
    ({ project, agent } = runtime.resolveProjectAgentPair(projectId, agentId));
  } catch {
    return null;
  }
  const sessions = runtime.webChatListSessionIds(projectId, agentId);
  if (!sessions.includes(sessionId)) {
    return null;
  }
  const activeSessionId = runtime.webChatActiveSessionId(projectId, agentId);
  const rawMessages = runtime.webChatReadSessionMessages(projectId, agentId, sessionId);
  const { agentDir } = projectAgentRoots(runtime, project, agent);
  const messages = rawMessages.map((message, index) =>
    materializeChatMessage(message, projectId, agentId, agentDir, index)
  );
  const runningTurn = findRunningTurn(projectId, agentId, sessionId);
  return {
    projectId,
    agentId,
    sessionId,
    active: activeSessionId === sessionId,
    messages,
    runningTurn
  };
}

function materializeChatMessage(
  message: ConversationMessage,
  projectId: string,
  agentId: string,
  agentDir: string,
  index: number
): WebChatMessage {
  if (message.role === "assistant") {
    const parsed = parseAssistantContent(message.content, agentDir, projectId, agentId);
    return {
      id: `m_${index}_${Buffer.from(message.at ?? "").toString("hex").slice(0, 12)}`,
      role: "assistant",
      content: parsed.text,
      at: message.at,
      attachments: parsed.attachments
    };
  }
  const parsedUser = parseUserContent(message.content);
  return {
    id: `m_${index}_${Buffer.from(message.at ?? "").toString("hex").slice(0, 12)}`,
    role: "user",
    content: parsedUser.text,
    at: message.at,
    attachments: parsedUser.attachments
  };
}

interface ParsedAssistantContent {
  text: string;
  attachments: WebChatAttachment[];
}

function parseAssistantContent(
  raw: string,
  agentDir: string,
  projectId: string,
  agentId: string
): ParsedAssistantContent {
  const lines = raw.split(/\r?\n/);
  const remaining: string[] = [];
  const attachments: WebChatAttachment[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const payload = extractTelegramFilePayload(trimmed);
    if (!payload) {
      remaining.push(line);
      continue;
    }
    let parsed: { file?: unknown } | null = null;
    try {
      parsed = JSON.parse(payload) as { file?: unknown };
    } catch {
      // Drop malformed directives instead of echoing them as plain text.
      continue;
    }
    const reference = typeof parsed?.file === "string" ? parsed.file : null;
    if (!reference) {
      continue;
    }
    const resolved = resolveReturnedFilePath(reference, agentDir);
    if (!resolved) {
      // Path outside the agent directory or missing on disk: drop the directive line.
      continue;
    }
    const entry = registerReturnedFile(resolved, projectId, agentId, agentDir);
    attachments.push(buildAttachmentDto(entry));
  }
  return {
    text: remaining.join("\n").trim(),
    attachments
  };
}

function parseUserContent(raw: string): ParsedAssistantContent {
  // User memory uses a [telegram_files] block produced by the chat backend; surface attachments
  // as URLs only when an UPLOAD_REGISTRY entry can be matched by absolute local path.
  const lines = raw.split(/\r?\n/);
  let inFiles = false;
  const textLines: string[] = [];
  const attachmentLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === "[telegram_files]") {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      attachmentLines.push(line);
    } else {
      textLines.push(line);
    }
  }
  const attachments: WebChatAttachment[] = [];
  for (const line of attachmentLines) {
    const match = /local_path=("([^"]+)"|(\S+))/.exec(line);
    const filePath = match ? match[2] ?? match[3] ?? null : null;
    if (!filePath) {
      continue;
    }
    const resolved = path.resolve(filePath);
    const existing = findUploadByPath(resolved);
    if (existing) {
      attachments.push(buildAttachmentDto(existing));
    }
  }
  return {
    text: textLines.join("\n").trim(),
    attachments
  };
}

function findUploadByPath(absolute: string): UploadEntry | null {
  for (const entry of UPLOAD_REGISTRY.values()) {
    if (entry.absolutePath === absolute) {
      return entry;
    }
  }
  return null;
}

function extractTelegramFilePayload(line: string): string | null {
  const normalized = line.startsWith("`") && line.endsWith("`") ? line.slice(1, -1).trim() : line;
  if (!normalized.startsWith("@telegram-file")) {
    return null;
  }
  const payload = normalized.slice("@telegram-file".length).trim();
  return payload || null;
}

function resolveReturnedFilePath(reference: string, agentDir: string): string | null {
  let candidate = reference.trim();
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("file://")) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      return null;
    }
  }
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(agentDir, candidate);
  if (!fs.existsSync(absolute)) {
    return null;
  }
  if (!ensureUnderRoot(absolute, [agentDir])) {
    return null;
  }
  return absolute;
}

function registerReturnedFile(
  absolutePath: string,
  projectId: string,
  agentId: string,
  agentDir: string
): FileEntry {
  for (const entry of FILE_REGISTRY.values()) {
    if (entry.absolutePath === absolutePath && entry.projectId === projectId && entry.agentId === agentId) {
      return entry;
    }
  }
  const stat = fs.statSync(absolutePath);
  const name = path.basename(absolutePath);
  const mime = detectMimeType(name, null);
  const entry: FileEntry = {
    id: generateId("file"),
    absolutePath,
    name,
    sizeBytes: stat.size,
    mimeType: mime,
    kind: detectAttachmentKind(name, mime),
    source: "returned",
    relativeRoot: agentDir,
    projectId,
    agentId
  };
  registerFile(entry);
  return entry;
}

function buildInboundChatText(text: string, files: TelegramFilePayload[]): string {
  const lines: string[] = [];
  if (text.trim()) {
    lines.push(text.trim());
  }
  if (files.length > 0) {
    lines.push("[telegram_files]");
    files.forEach((file, index) => {
      lines.push(
        `${index + 1}. kind=${file.kind} file_id=${file.fileId}` +
          (file.fileName ? ` file_name=${file.fileName}` : "") +
          (file.mimeType ? ` mime_type=${file.mimeType}` : "") +
          (file.localPath ? ` local_path=${JSON.stringify(file.localPath)}` : "") +
          (file.fileSize !== undefined ? ` file_size=${String(file.fileSize)}` : "")
      );
    });
  }
  return lines.join("\n").trim();
}

interface ParsedSendBody {
  agentId: string;
  sessionId?: string;
  message: string;
  uploadIds: string[];
}

function parseSendBody(body: unknown): ParsedSendBody {
  if (!body || typeof body !== "object") {
    throw new Error("invalid_request_body");
  }
  const record = body as Partial<WebChatSendRequest>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (!agentId) {
    throw new Error("missing_agent_id");
  }
  const sessionId = typeof record.sessionId === "string" && record.sessionId.trim() ? record.sessionId.trim() : undefined;
  const uploadIds = Array.isArray(record.uploadIds)
    ? record.uploadIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (!message.trim() && uploadIds.length === 0) {
    throw new Error("empty_message");
  }
  return { agentId, sessionId, message: message.trim(), uploadIds };
}

function resolveUploadIds(
  uploadIds: string[],
  projectId: string,
  agentId: string
): { files: TelegramFilePayload[]; attachments: WebChatAttachment[] } {
  const files: TelegramFilePayload[] = [];
  const attachments: WebChatAttachment[] = [];
  for (const uploadId of uploadIds) {
    const entry = UPLOAD_REGISTRY.get(uploadId);
    if (!entry || entry.projectId !== projectId || entry.agentId !== agentId) {
      throw new Error(`unknown_upload:${uploadId}`);
    }
    if (!fs.existsSync(entry.absolutePath)) {
      throw new Error(`upload_missing:${uploadId}`);
    }
    attachments.push(buildAttachmentDto(entry));
    files.push({
      kind: "document",
      fileId: entry.id,
      fileName: entry.name,
      mimeType: entry.mimeType,
      fileSize: entry.sizeBytes,
      localPath: entry.absolutePath
    });
  }
  return { files, attachments };
}

function emitTurnUpdate(state: TurnState): void {
  state.turn.updatedAt = nowIso();
  pushSse(state, "progress", state.turn);
}

function emitProgress(state: TurnState, event: TaskProgressEvent): void {
  const normalized = String(event.message ?? "").trim();
  if (!normalized) {
    return;
  }
  const dtoEvent: WebChatProgressEvent = {
    kind: event.kind,
    message: normalized,
    stage: event.stage,
    slot: event.slot,
    current: event.current,
    total: event.total,
    at: nowIso()
  };
  state.turn.progress = [...state.turn.progress, dtoEvent].slice(-PROGRESS_HISTORY_LIMIT);
  state.turn.lastProgress = normalized;
  emitTurnUpdate(state);
}

function pushSse(state: TurnState, event: string, data: unknown): void {
  if (state.subscribers.size === 0) {
    return;
  }
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of state.subscribers) {
    try {
      response.write(payload);
    } catch {
      state.subscribers.delete(response);
    }
  }
}

function closeSse(state: TurnState): void {
  for (const response of state.subscribers) {
    try {
      response.write("event: closed\ndata: {}\n\n");
      response.end();
    } catch {
      // best-effort
    }
  }
  state.subscribers.clear();
}

async function startSendTurn(runtime: OpenColabRuntime, request: IncomingMessage, response: ServerResponse, projectId: string): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_body";
    sendError(response, 400, message);
    return;
  }
  let parsed: ParsedSendBody;
  try {
    parsed = parseSendBody(body);
  } catch (error) {
    sendError(response, 400, error instanceof Error ? error.message : "invalid_body");
    return;
  }

  let project: ProjectState;
  let agent: AgentConfig;
  try {
    ({ project, agent } = runtime.resolveProjectAgentPair(projectId, parsed.agentId));
  } catch {
    sendError(response, 404, "unknown_agent");
    return;
  }

  if (parsed.sessionId) {
    const ok = runtime.webChatActivateSession(projectId, agent.id, parsed.sessionId);
    if (!ok) {
      sendError(response, 404, "unknown_session");
      return;
    }
  }

  if (isAgentBusy(runtime, project.id, agent.id)) {
    const existing = findRunningTurn(project.id, agent.id, runtime.webChatActiveSessionId(project.id, agent.id));
    sendError(response, 409, "agent_busy", { activeTurn: existing });
    return;
  }

  let uploads: { files: TelegramFilePayload[]; attachments: WebChatAttachment[] };
  try {
    uploads = resolveUploadIds(parsed.uploadIds, project.id, agent.id);
  } catch (error) {
    sendError(response, 400, error instanceof Error ? error.message : "invalid_upload");
    return;
  }

  const sessionId = runtime.webChatActiveSessionId(project.id, agent.id);
  const inboundText = buildInboundChatText(parsed.message, uploads.files);
  const userMessageAt = nowIso();
  runtime.webChatAppend(project.id, agent.id, {
    role: "user",
    content: inboundText,
    at: userMessageAt
  });

  const turnId = generateId("turn");
  const startedAtMs = Date.now();
  const startedAt = nowIso();
  const turn: WebChatTurn = {
    turnId,
    projectId: project.id,
    agentId: agent.id,
    sessionId,
    status: "queued",
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    lastProgress: null,
    progress: [],
    returnedFiles: [],
    error: null,
    durationMs: null
  };
  const abort = new AbortController();
  const state: TurnState = {
    turn,
    abort,
    agentDir: resolveAgentDirectory(runtime.config.rootDir, agent.path),
    subscribers: new Set<ServerResponse>(),
    startedAtMs
  };
  TURNS.set(turnId, state);

  sendJson(response, 202, {
    turnId,
    sessionId,
    status: "queued"
  } satisfies WebChatSendResponse);

  void executeTurn(runtime, state, inboundText, uploads.files, agent);
}

async function executeTurn(
  runtime: OpenColabRuntime,
  state: TurnState,
  inboundText: string,
  files: TelegramFilePayload[],
  agent: AgentConfig
): Promise<void> {
  state.turn.status = "running";
  emitTurnUpdate(state);
  let responseText: string | null = null;
  let lastProgressForRecovery: string | null = null;
  try {
    responseText = await runtime.runWebChatTurn(
      {
        projectId: state.turn.projectId,
        agentId: state.turn.agentId,
        text: inboundText,
        files
      },
      {
        signal: state.abort.signal,
        onProgress: (event) => {
          lastProgressForRecovery = event.kind !== "progress" ? event.message : lastProgressForRecovery;
          emitProgress(state, event);
        }
      }
    );
  } catch (error) {
    const stopped = state.abort.signal.aborted;
    if (stopped) {
      state.turn.status = "stopped";
      state.turn.error = null;
      runtime.webChatAppend(state.turn.projectId, state.turn.agentId, {
        role: "assistant",
        content: buildStopRecoveryLog(agent, lastProgressForRecovery),
        at: nowIso()
      });
    } else if (isProviderTimeoutError(error)) {
      state.turn.status = "timed_out";
      state.turn.error = buildAgentFailureMessage(error, lastProgressForRecovery);
      runtime.webChatAppend(state.turn.projectId, state.turn.agentId, {
        role: "assistant",
        content: buildAssistantRecoveryLog(
          error,
          agent.provider,
          runtime.config.providerCliTimeoutMs,
          lastProgressForRecovery
        ),
        at: nowIso()
      });
    } else {
      state.turn.status = "failed";
      state.turn.error = buildAgentFailureMessage(error, lastProgressForRecovery);
      runtime.webChatAppend(state.turn.projectId, state.turn.agentId, {
        role: "assistant",
        content: buildAssistantRecoveryLog(
          error,
          agent.provider,
          runtime.config.providerCliTimeoutMs,
          lastProgressForRecovery
        ),
        at: nowIso()
      });
    }
    state.turn.completedAt = nowIso();
    state.turn.updatedAt = state.turn.completedAt;
    state.turn.durationMs = Date.now() - state.startedAtMs;
    pushSse(state, "error", { error: state.turn.error ?? state.turn.status });
    pushSse(state, "completed", state.turn);
    closeSse(state);
    return;
  }

  const parsed = parseAssistantContent(
    responseText,
    state.agentDir,
    state.turn.projectId,
    state.turn.agentId
  );
  state.turn.returnedFiles = parsed.attachments;
  const assistantLog = buildAssistantLogContent(parsed.text, responseText);
  runtime.webChatAppend(state.turn.projectId, state.turn.agentId, {
    role: "assistant",
    content: assistantLog,
    at: nowIso()
  });

  const messageDto: WebChatMessage = {
    id: generateId("msg"),
    role: "assistant",
    content: parsed.text,
    at: nowIso(),
    attachments: parsed.attachments
  };
  state.turn.status = "completed";
  state.turn.completedAt = nowIso();
  state.turn.updatedAt = state.turn.completedAt;
  state.turn.durationMs = Date.now() - state.startedAtMs;
  pushSse(state, "message", messageDto);
  pushSse(state, "completed", state.turn);
  closeSse(state);
}

function buildAssistantLogContent(strippedText: string, originalResponse: string): string {
  // Preserve the raw @telegram-file directives in memory while keeping the rendered text clean.
  const directiveLines = originalResponse
    .split(/\r?\n/)
    .filter((line) => extractTelegramFilePayload(line.trim()) !== null);
  if (directiveLines.length === 0) {
    return strippedText;
  }
  const lines: string[] = [];
  if (strippedText) {
    lines.push(strippedText);
  }
  for (const directive of directiveLines) {
    lines.push(directive);
  }
  return lines.join("\n").trim();
}

function buildStopRecoveryLog(agent: AgentConfig, lastProgress: string | null): string {
  const lines: string[] = [
    `Previous web-chat turn was stopped by the user using ${agent.provider.name}/${agent.provider.model}.`
  ];
  const summary = lastProgress?.trim();
  if (summary) {
    lines.push(`Last progress: ${summary}`);
  }
  lines.push("Next action: resume from the last completed stage if the user asks to continue.");
  return lines.join("\n");
}

function stopTurn(turnId: string): WebChatTurn | null {
  const state = TURNS.get(turnId);
  if (!state) {
    return null;
  }
  if (state.turn.status === "queued" || state.turn.status === "running") {
    state.abort.abort();
  }
  return state.turn;
}

function gcTurns(): void {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, state] of TURNS.entries()) {
    if (state.subscribers.size > 0) continue;
    if (
      state.turn.completedAt &&
      Date.parse(state.turn.completedAt) < cutoff
    ) {
      TURNS.delete(id);
    }
  }
}

function streamFile(projectId: string, fileId: string, request: IncomingMessage, response: ServerResponse, url: URL): void {
  const entry = FILE_REGISTRY.get(fileId) ?? UPLOAD_REGISTRY.get(fileId);
  if (!entry) {
    sendError(response, 404, "unknown_file");
    return;
  }
  if (entry.projectId !== projectId) {
    sendError(response, 404, "unknown_file");
    return;
  }
  if (!fs.existsSync(entry.absolutePath)) {
    sendError(response, 404, "file_missing");
    return;
  }
  if (!ensureUnderRoot(entry.absolutePath, [entry.relativeRoot])) {
    sendError(response, 403, "forbidden_path");
    return;
  }
  const stat = fs.statSync(entry.absolutePath);
  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const inMatch = request.headers["if-none-match"];
  const ifNoneMatch = Array.isArray(inMatch) ? inMatch[0] : inMatch;
  if (ifNoneMatch && ifNoneMatch === etag) {
    response.writeHead(304, { ETag: etag });
    response.end();
    return;
  }

  const wantsInline = url.searchParams.get("disposition") === "inline" || isInlineSafe(entry.kind);
  const headers: Record<string, string | number> = {
    "Content-Type": entry.mimeType,
    "Cache-Control": "private, max-age=60",
    ETag: etag,
    "Content-Disposition": `${wantsInline ? "inline" : "attachment"}; filename="${encodeURIComponent(entry.name)}"`,
    "Accept-Ranges": "bytes"
  };

  const range = request.headers.range;
  if (range && /^bytes=/.test(range)) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const startVal = match[1] ? parseInt(match[1], 10) : 0;
      const endVal = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (Number.isFinite(startVal) && Number.isFinite(endVal) && startVal <= endVal && endVal < stat.size) {
        headers["Content-Range"] = `bytes ${startVal}-${endVal}/${stat.size}`;
        headers["Content-Length"] = endVal - startVal + 1;
        response.writeHead(206, headers);
        fs.createReadStream(entry.absolutePath, { start: startVal, end: endVal }).pipe(response);
        return;
      }
    }
  }

  headers["Content-Length"] = stat.size;
  response.writeHead(200, headers);
  fs.createReadStream(entry.absolutePath).pipe(response);
}

function isInlineSafe(kind: WebChatAttachmentKind): boolean {
  return kind === "pdf" || kind === "markdown" || kind === "image" || kind === "text";
}

function attachSse(turnId: string, request: IncomingMessage, response: ServerResponse): boolean {
  const state = TURNS.get(turnId);
  if (!state) {
    sendError(response, 404, "unknown_turn");
    return true;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(`event: progress\ndata: ${JSON.stringify(state.turn)}\n\n`);
  state.subscribers.add(response);
  const keepalive = setInterval(() => {
    try {
      response.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, SSE_KEEPALIVE_MS);
  const cleanup = () => {
    clearInterval(keepalive);
    state.subscribers.delete(response);
  };
  request.on("close", cleanup);
  request.on("end", cleanup);
  response.on("close", cleanup);
  if (state.turn.status === "completed" || state.turn.status === "failed" || state.turn.status === "stopped" || state.turn.status === "timed_out") {
    response.write(`event: completed\ndata: ${JSON.stringify(state.turn)}\n\n`);
    cleanup();
    response.end();
  }
  return true;
}

async function handleUpload(runtime: OpenColabRuntime, request: IncomingMessage, response: ServerResponse, projectId: string): Promise<void> {
  const contentType = String(request.headers["content-type"] ?? "");
  const boundaryMatch = /boundary="?([^";]+)"?/.exec(contentType);
  if (!boundaryMatch) {
    sendError(response, 400, "missing_multipart_boundary");
    return;
  }
  let body: Buffer;
  try {
    body = await readRequestBody(request, MAX_UPLOAD_REQUEST_BYTES);
  } catch {
    sendError(response, 413, "request_body_too_large");
    return;
  }
  const parts = parseMultipart(body, boundaryMatch[1]);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];
  for (const part of parts) {
    if (part.filename === undefined) {
      fields.set(part.name, part.data.toString("utf8"));
    } else {
      files.push(part as MultipartFile);
    }
  }
  const agentId = fields.get("agentId");
  if (!agentId) {
    sendError(response, 400, "missing_agent_id");
    return;
  }
  let project: ProjectState;
  let agent: AgentConfig;
  try {
    ({ project, agent } = runtime.resolveProjectAgentPair(projectId, agentId));
  } catch {
    sendError(response, 404, "unknown_agent");
    return;
  }
  if (files.length === 0) {
    sendError(response, 400, "no_files");
    return;
  }
  const { agentDir, uploadsDir } = projectAgentRoots(runtime, project, agent);
  const dateDir = path.join(uploadsDir, todayIso());
  const batchId = generateId("upl");
  const batchDir = path.join(dateDir, batchId);
  ensureDir(batchDir);
  const attachments: WebChatAttachment[] = [];
  const manifestEntries: Array<Record<string, unknown>> = [];
  for (const file of files) {
    if (file.data.length === 0) {
      continue;
    }
    if (file.data.length > MAX_UPLOAD_BYTES) {
      sendError(response, 413, "file_too_large", { name: file.filename });
      return;
    }
    const safeName = normalizeSafeFilename(file.filename);
    const targetPath = path.join(batchDir, safeName);
    if (!ensureUnderRoot(targetPath, [uploadsDir])) {
      sendError(response, 400, "invalid_filename", { name: file.filename });
      return;
    }
    fs.writeFileSync(targetPath, file.data);
    const mime = detectMimeType(safeName, file.contentType ?? null);
    const entry: UploadEntry = {
      id: generateId("upload"),
      absolutePath: targetPath,
      name: safeName,
      sizeBytes: file.data.length,
      mimeType: mime,
      kind: detectAttachmentKind(safeName, mime),
      source: "upload",
      relativeRoot: agentDir,
      projectId: project.id,
      agentId: agent.id,
      uploadedAt: nowIso(),
      originalName: file.filename
    };
    UPLOAD_REGISTRY.set(entry.id, entry);
    FILE_REGISTRY.set(entry.id, entry);
    attachments.push(buildAttachmentDto(entry));
    manifestEntries.push({
      id: entry.id,
      originalName: entry.originalName,
      storedName: entry.name,
      sizeBytes: entry.sizeBytes,
      mimeType: entry.mimeType,
      kind: entry.kind,
      uploadedAt: entry.uploadedAt
    });
  }
  fs.writeFileSync(
    path.join(batchDir, "manifest.json"),
    JSON.stringify({ batchId, agentId: agent.id, projectId: project.id, files: manifestEntries }, null, 2)
  );
  sendJson(response, 201, { uploads: attachments } satisfies WebChatUploadResponse);
}

interface MultipartFile {
  name: string;
  filename: string;
  contentType: string | null;
  data: Buffer;
}

interface MultipartField {
  name: string;
  filename?: string;
  contentType?: string | null;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartField[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartField[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) {
    return parts;
  }
  cursor += delimiter.length;
  while (cursor < body.length) {
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) {
      break;
    }
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) {
      cursor += 2;
    } else if (body[cursor] === 0x0a) {
      cursor += 1;
    }
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) break;
    const headersBlock = body.slice(cursor, headerEnd).toString("utf8");
    cursor = headerEnd + 4;
    const next = body.indexOf(delimiter, cursor);
    if (next < 0) break;
    let dataEnd = next;
    if (body[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (body[dataEnd - 1] === 0x0d) dataEnd -= 1;
    const data = body.slice(cursor, dataEnd);
    const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headersBlock);
    if (dispositionMatch) {
      const nameMatch = /name="([^"]*)"/i.exec(dispositionMatch[1]);
      const filenameMatch = /filename="([^"]*)"/i.exec(dispositionMatch[1]);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headersBlock);
      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: filenameMatch ? filenameMatch[1] : undefined,
          contentType: typeMatch ? typeMatch[1].trim() : null,
          data: Buffer.from(data)
        });
      }
    }
    cursor = next + delimiter.length;
  }
  return parts;
}

export async function handleChatRoute(
  runtime: OpenColabRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  projectId: string,
  rest: string
): Promise<boolean> {
  gcTurns();
  const method = request.method ?? "GET";

  if (method === "GET" && rest === "/agents") {
    sendJson(response, 200, listChatAgents(runtime, projectId));
    return true;
  }

  if (method === "GET" && rest === "/sessions") {
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      sendError(response, 400, "missing_agent_id");
      return true;
    }
    try {
      runtime.resolveProjectAgentPair(projectId, agentId);
    } catch {
      sendError(response, 404, "unknown_agent");
      return true;
    }
    sendJson(response, 200, listChatSessions(runtime, projectId, agentId));
    return true;
  }

  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(rest);
  if (method === "GET" && sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      sendError(response, 400, "missing_agent_id");
      return true;
    }
    const detail = buildSessionDetail(runtime, projectId, agentId, sessionId);
    if (!detail) {
      sendError(response, 404, "unknown_session");
      return true;
    }
    sendJson(response, 200, detail);
    return true;
  }

  if (method === "POST" && rest === "/sessions/new") {
    const body = await readJsonBody<{ agentId?: string }>(request);
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!agentId) {
      sendError(response, 400, "missing_agent_id");
      return true;
    }
    try {
      runtime.resolveProjectAgentPair(projectId, agentId);
    } catch {
      sendError(response, 404, "unknown_agent");
      return true;
    }
    const sessionId = runtime.webChatResetSession(projectId, agentId);
    sendJson(response, 201, { sessionId } satisfies WebChatNewSessionResponse);
    return true;
  }

  const sessionResetMatch = /^\/sessions\/([^/]+)\/reset$/.exec(rest);
  if (method === "POST" && sessionResetMatch) {
    const body = await readJsonBody<{ agentId?: string }>(request);
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!agentId) {
      sendError(response, 400, "missing_agent_id");
      return true;
    }
    void sessionResetMatch;
    try {
      runtime.resolveProjectAgentPair(projectId, agentId);
    } catch {
      sendError(response, 404, "unknown_agent");
      return true;
    }
    const sessionId = runtime.webChatResetSession(projectId, agentId);
    sendJson(response, 201, { sessionId } satisfies WebChatNewSessionResponse);
    return true;
  }

  if (method === "POST" && rest === "/uploads") {
    await handleUpload(runtime, request, response, projectId);
    return true;
  }

  if (method === "POST" && rest === "/send") {
    await startSendTurn(runtime, request, response, projectId);
    return true;
  }

  const turnStopMatch = /^\/turns\/([^/]+)\/stop$/.exec(rest);
  if (method === "POST" && turnStopMatch) {
    const turn = stopTurn(decodeURIComponent(turnStopMatch[1]));
    if (!turn) {
      sendError(response, 404, "unknown_turn");
      return true;
    }
    sendJson(response, 200, turn);
    return true;
  }

  const turnEventsMatch = /^\/turns\/([^/]+)\/events$/.exec(rest);
  if (method === "GET" && turnEventsMatch) {
    return attachSse(decodeURIComponent(turnEventsMatch[1]), request, response);
  }

  const turnDetailMatch = /^\/turns\/([^/]+)$/.exec(rest);
  if (method === "GET" && turnDetailMatch) {
    const state = TURNS.get(decodeURIComponent(turnDetailMatch[1]));
    if (!state) {
      sendError(response, 404, "unknown_turn");
      return true;
    }
    sendJson(response, 200, state.turn);
    return true;
  }

  const fileMatch = /^\/files\/([^/]+)$/.exec(rest);
  if (method === "GET" && fileMatch) {
    streamFile(projectId, decodeURIComponent(fileMatch[1]), request, response, url);
    return true;
  }

  return false;
}

// Exposed for tests.
export const __chatInternals = {
  TURNS,
  FILE_REGISTRY,
  UPLOAD_REGISTRY,
  detectAttachmentKind,
  normalizeSafeFilename,
  parseAssistantContent,
  buildInboundChatText,
  extractTelegramFilePayload,
  parseMultipart,
  ensureUnderRoot
};
