import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { ManualSshService } from "../src/manual-ssh.js";
import { createRuntime } from "../src/runtime.js";

function createFakeSshCommand(tempDir: string): string {
  const scriptPath = path.join(tempDir, "fake-ssh.sh");
  fs.writeFileSync(
    scriptPath,
    [
      "#!/bin/sh",
      "for arg in \"$@\"; do",
      "  if [ \"$arg\" = \"true\" ]; then",
      "    exit 0",
      "  fi",
      "done",
      "printf 'connected\\n'",
      "while IFS= read -r line; do",
      "  if [ \"$line\" = \"exit\" ]; then",
      "    printf 'bye\\n'",
      "    exit 0",
      "  fi",
      "  printf 'echo:%s\\n' \"$line\"",
      "done"
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitFor<T>(fn: () => T, predicate: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = fn();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return fn();
}

test("manual SSH runtime can save profiles, set defaults, and run a live session", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-manual-ssh-"));
  const fakeSshPath = createFakeSshCommand(tempDir);
  const runtime = createRuntime(tempDir, {
    manualSshService: new ManualSshService(loadConfig(tempDir), fakeSshPath)
  });

  try {
    runtime.init();

    runtime.saveManualSshProfile({
      id: "runpod-manual-a100",
      podId: "pod_123",
      host: "203.0.113.10",
      port: 21438,
      user: "root",
      privateKeyPath: "~/.ssh/id_ed25519"
    });
    runtime.setManualSshProfileDefault("runpod-manual-a100");

    const project = runtime.getActiveProject();
    assert.equal(project.manualSshProfiles["runpod-manual-a100"]?.podId, "pod_123");
    assert.equal(
      project.agentRemoteDefaults[runtime.getActiveAgent().id]?.manualSshProfileId,
      "runpod-manual-a100"
    );

    const session = await runtime.startManualSshSession({});
    assert.equal(session.profileId, "runpod-manual-a100");

    const firstRead = await waitFor(
      () => runtime.readManualSshSession(session.sessionId, 0),
      (value) => value.output.includes("connected")
    );
    assert.equal(firstRead.state === "running" || firstRead.state === "starting", true);

    runtime.writeManualSshSession({
      sessionId: session.sessionId,
      input: "nvidia-smi"
    });

    const secondRead = await waitFor(
      () => runtime.readManualSshSession(session.sessionId, firstRead.nextOffset),
      (value) => value.output.includes("echo:nvidia-smi")
    );
    assert.equal(secondRead.output.includes("echo:nvidia-smi"), true);

    const stopped = await runtime.stopManualSshSession(session.sessionId);
    assert.equal(stopped.state === "stopped" || stopped.state === "stopping", true);

    const finalSession = await waitFor(
      () => runtime.listManualSshSessions().find((candidate) => candidate.sessionId === session.sessionId)!,
      (value) => value.state === "stopped"
    );
    assert.equal(finalSession.state, "stopped");
    assert.equal(fs.existsSync(finalSession.transcriptPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
