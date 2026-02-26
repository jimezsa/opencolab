import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

test("run lifecycle reaches waiting approval and completion", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-test-"));
  const runtime = createRuntime(tempDir);

  try {
    const { orchestrator } = runtime;
    orchestrator.createProject("paper-proj");

    const started = await orchestrator.startRun({
      projectName: "paper-proj",
      goal: "Summarize sparse autoencoder methods"
    });

    assert.equal(started.status, "waiting_approval");

    const status = orchestrator.getRunStatus(started.runId);
    assert.equal(status.run.status, "waiting_approval");
    assert.equal(status.tasks.length, 3);
    assert.ok(status.approval);
    assert.equal(status.approval?.status, "pending");

    const chats = orchestrator.listChats(started.runId);
    assert.equal(chats.length, 1);

    const meetings = orchestrator.listMeetings(started.runId);
    assert.equal(meetings.length, 3);

    orchestrator.approveRun(started.runId);

    const afterApproval = orchestrator.getRunStatus(started.runId);
    assert.equal(afterApproval.run.status, "completed");
  } finally {
    runtime.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("skill sync loads SKILLS directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-skill-test-"));

  try {
    const skillDir = path.join(tempDir, "SKILLS", "paper-search");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: paper-search\ndescription: Search and summarize papers\n---\n\nUse this skill for paper triage.\n`,
      "utf8"
    );

    const runtime = createRuntime(tempDir);
    try {
      const rows = runtime.orchestrator.syncSkills();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].skillName, "paper-search");
      assert.equal(rows[0].description, "Search and summarize papers");
    } finally {
      runtime.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
