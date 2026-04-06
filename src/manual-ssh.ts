/**
 * Manual SSH profile and interactive session helpers.
 * Supports saved Runpod manual Pod access and line-oriented live SSH sessions.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenColabConfig } from "./config.js";
import {
  buildManualSshSessionInboxPath,
  buildManualSshSessionTranscriptPath,
  buildManualSshSessionsDir,
  ensureManualSshSessionDir,
  readManualSshSession,
  writeManualSshSession
} from "./experiments.js";
import type {
  AgentConfig,
  ManualSshProfile,
  ManualSshProfileTestResult,
  ManualSshSession,
  ManualSshSessionReadResult,
  ManualSshSessionState,
  ProjectState
} from "./types.js";
import { nowIso, randomDigits } from "./utils.js";

const RUNPOD_API_BASE_URL = "https://rest.runpod.io/v1";
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const SESSION_POLL_WAIT_MS = 400;
const SESSION_POLL_INTERVAL_MS = 50;
const MANUAL_SSH_WORKER_SCRIPT_PATH = fileURLToPath(new URL("./manual-ssh-worker.js", import.meta.url));

export interface ParsedManualSshCommand {
  host: string | null;
  port: number | null;
  user: string | null;
  privateKeyPath: string | null;
  sshConfigHost: string | null;
}

export interface ResolvedManualSshProfile {
  profile: ManualSshProfile;
  warnings: string[];
  details: string[];
  refreshedFromRunpod: boolean;
}

interface RunpodManualPodEndpoint {
  publicIp: string | null;
  sshPort: number | null;
}

interface ManualSshSessionInput {
  sessionId: string;
  data: string;
  at: string;
}

export class ManualSshService {
  constructor(
    private readonly config: OpenColabConfig,
    private readonly sshCommand = resolveDefaultSshCommand()
  ) {}

  async resolveProfile(profile: ManualSshProfile): Promise<ResolvedManualSshProfile> {
    const warnings: string[] = [];
    const details: string[] = [];
    let refreshedFromRunpod = false;
    let resolved = profile;

    if (profile.backend === "runpod" && profile.mode === "manual_pod" && profile.podId) {
      try {
        const endpoint = await fetchRunpodManualPodEndpoint(profile.podId);
        const nextHost = endpoint.publicIp ?? profile.host;
        const nextPort = endpoint.sshPort ?? profile.port;
        if (nextHost || nextPort) {
          refreshedFromRunpod = true;
          resolved = {
            ...profile,
            host: nextHost,
            port: nextPort,
            updatedAt: nowIso()
          };
          details.push("Refreshed SSH endpoint from Runpod Pod metadata.");
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }

    validateManualSshProfile(resolved);
    return {
      profile: resolved,
      warnings,
      details,
      refreshedFromRunpod
    };
  }

  async testProfile(profile: ManualSshProfile): Promise<ManualSshProfileTestResult> {
    const resolved = await this.resolveProfile(profile);
    const launch = buildManualSshLaunchSpec(resolved.profile, this.sshCommand, false);
    const result = spawnSync(launch.command, [...launch.args, launch.destination, "true"], {
      encoding: "utf8",
      timeout: DEFAULT_CONNECT_TIMEOUT_SECONDS * 1000
    });
    const details = [...resolved.details];
    const warnings = [...resolved.warnings];
    const ok = result.status === 0;

    if (ok) {
      details.push("SSH connection succeeded.");
    } else {
      warnings.push((result.stderr || result.stdout || "SSH connection failed.").trim());
    }

    return {
      ok,
      profileId: resolved.profile.id,
      backend: resolved.profile.backend,
      warnings,
      details,
      resolvedHost: resolved.profile.host,
      resolvedPort: resolved.profile.port,
      resolvedUser: resolved.profile.user,
      refreshedFromRunpod: resolved.refreshedFromRunpod
    };
  }

  async startSession(
    project: ProjectState,
    agent: AgentConfig,
    profile: ManualSshProfile
  ): Promise<ManualSshSession> {
    if (profile.interactiveAccess !== "opt_in") {
      throw new Error(`Manual SSH profile '${profile.id}' does not allow interactive sessions.`);
    }

    for (const session of this.listSessions(project)) {
      if (!isActiveManualSshSessionState(session.state)) {
        continue;
      }
      if (session.profileId === profile.id) {
        throw new Error(
          `Manual SSH profile '${profile.id}' already has an active session ('${session.sessionId}').`
        );
      }
      if (session.agentId === agent.id) {
        throw new Error(
          `Agent '${agent.id}' already has an active manual SSH session ('${session.sessionId}').`
        );
      }
    }

    const sessionId = createManualSshSessionId();
    const transcriptPath = buildManualSshSessionTranscriptPath(this.config.rootDir, project, sessionId);
    const inboxPath = buildManualSshSessionInboxPath(this.config.rootDir, project, sessionId);
    ensureManualSshSessionDir(this.config.rootDir, project, sessionId);
    fs.writeFileSync(transcriptPath, "", "utf8");
    fs.writeFileSync(inboxPath, "", "utf8");

    const createdAt = nowIso();
    const session: ManualSshSession = {
      sessionId,
      projectId: project.id,
      agentId: agent.id,
      profileId: profile.id,
      backend: profile.backend,
      state: "starting",
      message: "Starting manual SSH session.",
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      finishedAt: null,
      lastActivityAt: null,
      workerPid: null,
      sshPid: null,
      resolvedHost: profile.host,
      resolvedPort: profile.port,
      resolvedUser: profile.user,
      transcriptPath,
      inboxPath,
      cursor: 0,
      error: null
    };
    writeManualSshSession(this.config.rootDir, project, session);

    const child = spawn(
      process.execPath,
      [
        MANUAL_SSH_WORKER_SCRIPT_PATH,
        "--root-dir",
        this.config.rootDir,
        "--project-id",
        project.id,
        "--session-id",
        sessionId
      ],
      {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
          OPENCOLAB_ROOT: this.config.rootDir,
          OPENCOLAB_SSH_COMMAND: this.sshCommand
        }
      }
    );
    child.unref();

    const next = {
      ...session,
      workerPid: child.pid ?? null,
      updatedAt: nowIso()
    };
    writeManualSshSession(this.config.rootDir, project, next);
    return next;
  }

  listSessions(project: ProjectState): ManualSshSession[] {
    const sessionsDir = buildManualSshSessionsDir(this.config.rootDir, project);
    if (!fs.existsSync(sessionsDir)) {
      return [];
    }

    const sessions: ManualSshSession[] = [];
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const session = readManualSshSession(this.config.rootDir, project, entry.name);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  readSession(
    project: ProjectState,
    sessionId: string,
    offset?: number
  ): ManualSshSessionReadResult {
    const session = requireManualSshSession(this.config.rootDir, project, sessionId);
    const transcript = fs.existsSync(session.transcriptPath)
      ? fs.readFileSync(session.transcriptPath, "utf8")
      : "";
    const normalizedOffset = Math.max(0, Math.min(offset ?? session.cursor, transcript.length));
    const output = transcript.slice(normalizedOffset);
    const nextOffset = transcript.length;
    const nextSession = {
      ...session,
      cursor: nextOffset,
      updatedAt: nowIso()
    };
    writeManualSshSession(this.config.rootDir, project, nextSession);

    return {
      sessionId: nextSession.sessionId,
      profileId: nextSession.profileId,
      state: nextSession.state,
      offset: normalizedOffset,
      nextOffset,
      output,
      transcriptPath: nextSession.transcriptPath
    };
  }

  writeSession(
    project: ProjectState,
    sessionId: string,
    input: string,
    appendNewline = true
  ): ManualSshSession {
    const session = requireManualSshSession(this.config.rootDir, project, sessionId);
    if (!isActiveManualSshSessionState(session.state)) {
      throw new Error(`Manual SSH session '${sessionId}' is not writable in state '${session.state}'.`);
    }

    const payload = `${input}${appendNewline && !input.endsWith("\n") ? "\n" : ""}`;
    const item: ManualSshSessionInput = {
      sessionId,
      data: payload,
      at: nowIso()
    };
    fs.appendFileSync(session.inboxPath, `${JSON.stringify(item)}\n`, "utf8");
    const next = {
      ...session,
      updatedAt: nowIso(),
      lastActivityAt: nowIso()
    };
    writeManualSshSession(this.config.rootDir, project, next);
    return next;
  }

  async stopSession(project: ProjectState, sessionId: string): Promise<ManualSshSession> {
    const session = requireManualSshSession(this.config.rootDir, project, sessionId);
    if (!isActiveManualSshSessionState(session.state)) {
      return session;
    }

    const stopping = {
      ...session,
      state: "stopping" as const,
      message: "Stopping manual SSH session.",
      updatedAt: nowIso()
    };
    writeManualSshSession(this.config.rootDir, project, stopping);

    if (stopping.workerPid) {
      try {
        process.kill(stopping.workerPid, "SIGTERM");
      } catch {
        // The worker may already be gone.
      }
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < SESSION_POLL_WAIT_MS) {
      const latest = readManualSshSession(this.config.rootDir, project, sessionId);
      if (latest && !isActiveManualSshSessionState(latest.state)) {
        return latest;
      }
      await sleep(SESSION_POLL_INTERVAL_MS);
    }

    return requireManualSshSession(this.config.rootDir, project, sessionId);
  }
}

export function createManualSshSessionId(): string {
  const stamp = nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `ssh-${stamp}-${randomDigits(4)}`;
}

export function parseManualSshCommand(raw: string): ParsedManualSshCommand {
  const tokens = splitShellWords(raw);
  if (tokens.length === 0 || path.basename(tokens[0]) !== "ssh") {
    throw new Error("Expected an ssh command.");
  }

  let host: string | null = null;
  let port: number | null = null;
  let user: string | null = null;
  let privateKeyPath: string | null = null;
  let sshConfigHost: string | null = null;
  let destination: string | null = null;

  for (let index = 1; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current === "-p" || current === "-i" || current === "-l" || current === "-o") {
      const next = tokens[index + 1];
      if (!next) {
        throw new Error(`SSH command is missing a value after '${current}'.`);
      }
      if (current === "-p") {
        const parsedPort = Number(next);
        if (!Number.isInteger(parsedPort) || parsedPort < 1) {
          throw new Error(`Invalid SSH port '${next}'.`);
        }
        port = parsedPort;
      } else if (current === "-i") {
        privateKeyPath = next;
      } else if (current === "-l") {
        user = next;
      }
      index += 1;
      continue;
    }

    if (current === "-t" || current === "-tt" || current === "-q" || current === "-A" || current === "-a") {
      continue;
    }

    if (current.startsWith("-")) {
      throw new Error(`Unsupported SSH command option '${current}'.`);
    }

    destination = current;
    break;
  }

  if (!destination) {
    throw new Error("SSH command did not include a destination host.");
  }

  if (destination.includes("@")) {
    const [parsedUser, parsedHost] = destination.split("@", 2);
    user = user ?? (parsedUser.trim() || null);
    host = parsedHost.trim() || null;
  } else {
    sshConfigHost = destination.trim() || null;
  }

  return {
    host,
    port,
    user,
    privateKeyPath,
    sshConfigHost
  };
}

export function buildManualSshLaunchSpec(
  profile: ManualSshProfile,
  sshCommand = resolveDefaultSshCommand(),
  interactive = false
): { command: string; args: string[]; destination: string } {
  validateManualSshProfile(profile);
  const args: string[] = [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "LogLevel=ERROR",
    "-o",
    `ConnectTimeout=${String(DEFAULT_CONNECT_TIMEOUT_SECONDS)}`
  ];

  if (interactive) {
    args.push("-tt");
  }
  if (profile.port) {
    args.push("-p", String(profile.port));
  }
  if (profile.privateKeyPath) {
    args.push("-i", profile.privateKeyPath);
  }

  const destination = profile.sshConfigHost
    ? profile.user
      ? `${profile.user}@${profile.sshConfigHost}`
      : profile.sshConfigHost
    : `${profile.user ?? "root"}@${profile.host}`;
  return {
    command: sshCommand,
    args,
    destination
  };
}

export function isActiveManualSshSessionState(state: ManualSshSessionState): boolean {
  return state === "starting" || state === "running" || state === "degraded" || state === "stopping";
}

export function requireManualSshSession(
  rootDir: string,
  project: ProjectState,
  sessionId: string
): ManualSshSession {
  const session = readManualSshSession(rootDir, project, sessionId);
  if (!session) {
    throw new Error(`Unknown manual SSH session: ${sessionId}`);
  }
  return session;
}

export function validateManualSshProfile(profile: ManualSshProfile): void {
  if (!profile.sshConfigHost && !profile.host) {
    throw new Error(
      `Manual SSH profile '${profile.id}' must include either a direct host or an SSH config host alias.`
    );
  }
  if (!profile.sshConfigHost && !profile.port) {
    throw new Error(`Manual SSH profile '${profile.id}' must include an SSH port for direct host access.`);
  }
}

export async function fetchRunpodManualPodEndpoint(podId: string): Promise<RunpodManualPodEndpoint> {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is required to refresh a manual Runpod Pod endpoint.");
  }

  const response = await fetch(`${RUNPOD_API_BASE_URL}/pods/${podId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Runpod API GET /pods/${podId} failed (${response.status}): ${responseText || response.statusText}`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const portMappings = asRecord(payload.portMappings);
  const portCandidate = portMappings?.["22"];
  const sshPort = Number(portCandidate);
  return {
    publicIp: asNullableString(payload.publicIp),
    sshPort: Number.isInteger(sshPort) && sshPort > 0 ? sshPort : null
  };
}

function splitShellWords(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      const next = raw[index + 1];
      if (next) {
        current += next;
        index += 1;
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("SSH command contains an unterminated quote.");
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveDefaultSshCommand(): string {
  return process.env.OPENCOLAB_SSH_COMMAND?.trim() || "ssh";
}
