#!/usr/bin/env node
/**
 * Detached background worker for one manual SSH interactive session.
 * It owns the live ssh process, appends transcript output, and consumes queued input.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  buildManualSshLaunchSpec,
  isActiveManualSshSessionState,
  requireManualSshSession
} from "./manual-ssh.js";
import { loadConfig } from "./config.js";
import { readProjectState } from "./project-config.js";
import type { ManualSshProfile, ManualSshSession, ProjectState } from "./types.js";
import { writeManualSshSession } from "./experiments.js";
import { nowIso } from "./utils.js";

const INPUT_POLL_INTERVAL_MS = 150;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = requiredArg(args["root-dir"], "--root-dir");
  const projectId = requiredArg(args["project-id"], "--project-id");
  const sessionId = requiredArg(args["session-id"], "--session-id");
  const config = loadConfig(rootDir);
  const state = readProjectState(config);
  const project = state.projects[projectId];
  if (!project) {
    throw new Error(`Unknown project '${projectId}'.`);
  }

  let session = requireManualSshSession(config.rootDir, project, sessionId);
  const profile = requireProfile(project, session.profileId);
  const launch = buildManualSshLaunchSpec(profile, process.env.OPENCOLAB_SSH_COMMAND?.trim() || "ssh", true);
  const child = spawn(launch.command, [...launch.args, launch.destination], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let inboxOffset = 0;
  let stopping = false;

  const writeTranscript = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    fs.appendFileSync(session.transcriptPath, text, "utf8");
    session = persistSession(config.rootDir, project, {
      ...session,
      state: session.state === "starting" ? "running" : session.state,
      message: session.state === "starting" ? "Manual SSH session is running." : session.message,
      updatedAt: nowIso(),
      lastActivityAt: nowIso(),
      cursor: readTranscriptLength(session.transcriptPath),
      error: null
    });
  };

  const pollInbox = setInterval(() => {
    if (!isActiveManualSshSessionState(session.state)) {
      return;
    }
    if (!fs.existsSync(session.inboxPath)) {
      return;
    }
    const content = fs.readFileSync(session.inboxPath, "utf8");
    const pending = content.slice(inboxOffset);
    if (!pending) {
      return;
    }
    inboxOffset = content.length;
    for (const line of pending.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as { data?: unknown };
        const data = typeof parsed.data === "string" ? parsed.data : "";
        if (data) {
          child.stdin.write(data);
          session = persistSession(config.rootDir, project, {
            ...session,
            updatedAt: nowIso(),
            lastActivityAt: nowIso()
          });
        }
      } catch {
        // Ignore malformed input lines and keep the session alive.
      }
    }
  }, INPUT_POLL_INTERVAL_MS);

  const shutdown = (state: ManualSshSession["state"], message: string, error: string | null): void => {
    stopping = true;
    clearInterval(pollInbox);
    try {
      child.stdin.end();
    } catch {
      // Ignore stdin teardown failures during shutdown.
    }
    session = persistSession(config.rootDir, project, {
      ...session,
      state,
      message,
      updatedAt: nowIso(),
      finishedAt: nowIso(),
      error
    });
  };

  process.on("SIGTERM", () => {
    session = persistSession(config.rootDir, project, {
      ...session,
      state: "stopping",
      message: "Stopping manual SSH session.",
      updatedAt: nowIso()
    });
    try {
      child.kill("SIGTERM");
    } catch {
      shutdown("stopped", "Manual SSH session stopped.", null);
      process.exit(0);
    }
  });

  process.on("SIGINT", () => {
    try {
      child.kill("SIGTERM");
    } catch {
      shutdown("stopped", "Manual SSH session stopped.", null);
      process.exit(0);
    }
  });

  child.stdout.on("data", writeTranscript);
  child.stderr.on("data", writeTranscript);
  child.on("spawn", () => {
    session = persistSession(config.rootDir, project, {
      ...session,
      state: "running",
      message: "Manual SSH session is running.",
      updatedAt: nowIso(),
      startedAt: session.startedAt ?? nowIso(),
      sshPid: child.pid ?? null
    });
  });
  child.on("error", (error) => {
    shutdown("failed", "Manual SSH session failed to start.", error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping || session.state === "stopping") {
      shutdown("stopped", "Manual SSH session stopped.", null);
      process.exit(0);
      return;
    }

    if (code === 0) {
      shutdown("stopped", "Manual SSH session exited cleanly.", null);
      process.exit(0);
      return;
    }

    const error =
      signal ? `SSH session terminated by signal '${signal}'.` : `SSH session exited with code ${String(code)}.`;
    shutdown("failed", "Manual SSH session exited unexpectedly.", error);
    process.exit(1);
  });
}

function parseArgs(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      values[current.slice(2)] = "true";
      continue;
    }
    values[current.slice(2)] = next;
    index += 1;
  }
  return values;
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function requireProfile(project: ProjectState, profileId: string): ManualSshProfile {
  const profile = project.manualSshProfiles[profileId];
  if (!profile) {
    throw new Error(`Unknown manual SSH profile '${profileId}'.`);
  }
  return profile;
}

function persistSession(rootDir: string, project: ProjectState, session: ManualSshSession): ManualSshSession {
  writeManualSshSession(rootDir, project, session);
  return session;
}

function readTranscriptLength(transcriptPath: string): number {
  if (!fs.existsSync(transcriptPath)) {
    return 0;
  }
  return fs.readFileSync(transcriptPath, "utf8").length;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
