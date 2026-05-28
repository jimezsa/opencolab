import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";
import { parseAndValidateWorkflow } from "../src/workflows/parser.js";
import { serializeWorkflow } from "../src/workflows/serializer.js";
import {
  WORKFLOW_TEMPLATE_BLANK,
  WORKFLOW_TEMPLATE_JUDGE_AND_RETRY,
  WORKFLOW_TEMPLATE_REVIEW_LOOP
} from "../src/workflows/service.js";
import { parseXml, XmlSyntaxError } from "../src/workflows/xml.js";
import type { WorkflowDefinition, WorkflowLoop } from "../src/types.js";

function freshRuntime(label: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `opencolab-workflows-${label}-`));
  const runtime = createRuntime(tempDir);
  runtime.init();
  return { runtime, tempDir };
}

function waitFor<T>(predicate: () => T | null, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor: timeout"));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

test("parseXml rejects DOCTYPE declarations", () => {
  assert.throws(
    () => parseXml("<!DOCTYPE foo><workflow id=\"x\"></workflow>"),
    XmlSyntaxError
  );
});

test("parseXml supports CDATA and entities", () => {
  const root = parseXml("<workflow id=\"x\"><prompt>hello &amp; <![CDATA[<world>]]></prompt></workflow>");
  assert.equal(root.tag, "workflow");
  const prompt = root.children.find(
    (child): child is import("../src/workflows/xml.js").XmlElement =>
      (child as { tag?: string }).tag === "prompt"
  );
  assert.ok(prompt);
  const text = prompt.children
    .map((node) => ("value" in node ? node.value : ""))
    .join("");
  assert.match(text, /hello & <world>/);
});

test("parseAndValidateWorkflow rejects loops without bounds", () => {
  const xml = `
    <workflow id="bad" version="1">
      <input name="task" />
      <loop id="bad_loop">
        <step id="draft" type="agent" agent="professor">
          <prompt>Draft something</prompt>
        </step>
      </loop>
    </workflow>
  `;
  const result = parseAndValidateWorkflow(xml);
  assert.equal(result.ok, false);
  const messages = result.issues.map((i) => i.message).join("\n");
  assert.match(messages, /bad_loop/);
  assert.match(messages, /maxIterations|maxSteps|maxRuntimeMinutes/);
});

test("parseAndValidateWorkflow rejects duplicate step ids and unknown next targets", () => {
  const xml = `
    <workflow id="dups" version="1">
      <input name="task" />
      <step id="draft" type="agent" agent="professor">
        <prompt>Draft</prompt>
      </step>
      <step id="draft" type="agent" agent="professor">
        <prompt>Draft again</prompt>
      </step>
      <step id="judge" type="decision" agent="professor">
        <prompt>Judge</prompt>
        <choices>
          <choice name="continue" next="missing-step" />
          <choice name="stop" terminate="success" />
        </choices>
      </step>
    </workflow>
  `;
  const result = parseAndValidateWorkflow(xml);
  assert.equal(result.ok, false);
  const messages = result.issues.map((i) => i.message).join("\n");
  assert.match(messages, /declared more than once/);
  assert.match(messages, /missing-step/);
});

test("parseAndValidateWorkflow accepts the review-loop template", () => {
  const xml = `
    <workflow id="review-loop" version="1">
      <input name="task" />
      <step id="draft" type="agent" agent="professor">
        <prompt>Draft for \${input.task}</prompt>
        <output name="draft_output" />
      </step>
      <loop id="review_loop" maxIterations="3">
        <step id="review" type="agent" agent="professor">
          <prompt>Review \${draft_output}</prompt>
          <output name="review_output" />
        </step>
        <step id="judge" type="decision" agent="professor">
          <prompt>Decide based on \${draft_output} and \${review_output}</prompt>
          <choices>
            <choice name="continue" next="draft" />
            <choice name="stop" terminate="success" />
          </choices>
        </step>
      </loop>
    </workflow>
  `;
  const result = parseAndValidateWorkflow(xml);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.ok(result.definition);
  assert.equal(result.definition!.entryStepId, "draft");
  assert.equal(result.definition!.loops.review_loop?.maxIterations, 3);
});

test("createWorkflow writes the template file and listWorkflows includes it", () => {
  const { runtime, tempDir } = freshRuntime("create");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "review-loop" });
    const summaries = runtime.listWorkflows();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.id, "demo");
    const xmlPath = path.join(
      tempDir,
      "projects",
      "default",
      "workflows",
      "demo",
      "workflow.xml"
    );
    assert.equal(fs.existsSync(xmlPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("validateWorkflow surfaces errors when the XML has issues", () => {
  const { runtime, tempDir } = freshRuntime("validate");
  try {
    runtime.createWorkflow({ workflowId: "broken", template: "blank" });
    const xmlPath = path.join(
      tempDir,
      "projects",
      "default",
      "workflows",
      "broken",
      "workflow.xml"
    );
    fs.writeFileSync(
      xmlPath,
      `<workflow id="broken" version="1">
        <step id="bad" type="unknown">
          <prompt>oops</prompt>
        </step>
      </workflow>`,
      "utf8"
    );
    const result = runtime.validateWorkflow("broken");
    assert.equal(result.ok, false);
    const errorMessages = result.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message)
      .join("\n");
    assert.match(errorMessages, /unsupported type|unknown type/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startWorkflowRun executes a single-step workflow with mocked agent responses", async () => {
  const { runtime, tempDir } = freshRuntime("run-one");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const xmlPath = path.join(
      tempDir,
      "projects",
      "default",
      "workflows",
      "demo",
      "workflow.xml"
    );
    fs.writeFileSync(
      xmlPath,
      `<workflow id="demo" version="1">
        <input name="task" />
        <step id="draft" type="agent" agent="professor">
          <prompt>Draft for \${input.task}</prompt>
          <output name="draft_output" />
        </step>
      </workflow>`,
      "utf8"
    );

    // Inject an agent responder to avoid spawning real provider CLIs.
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    const mockedRuntime = createRuntime(tempDir, {
      agentResponder: async (input) => {
        return `Mocked response to: ${input.text}`;
      }
    });
    mockedRuntime.init();

    const result = mockedRuntime.startWorkflowRun({
      workflowId: "demo",
      input: { task: "Write a haiku" },
      initiator: "test"
    });
    const state = await waitFor(() => {
      const candidate = mockedRuntime.getWorkflowRun("demo", result.runId);
      if (!candidate) return null;
      if (
        candidate.status === "complete" ||
        candidate.status === "failed" ||
        candidate.status === "stopped"
      ) {
        return candidate;
      }
      return null;
    });

    assert.equal(state.status, "complete");
    assert.equal(state.stepHistory.length, 1);
    assert.equal(state.stepHistory[0]?.stepId, "draft");
    assert.match(state.values["draft_output"] ?? "", /Mocked response/);

    const events = mockedRuntime.listWorkflowRunEvents("demo", result.runId);
    assert.ok(events.some((event) => event.kind === "run_started"));
    assert.ok(events.some((event) => event.kind === "step_completed"));
    assert.ok(events.some((event) => event.kind === "run_completed"));

    const runStatus = mockedRuntime.getWorkflowRunStatus("demo", result.runId);
    assert.ok(runStatus);
    assert.equal(runStatus!.status, "complete");
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("decision step parses workflow-decision tag and pauses when invalid", async () => {
  const { tempDir } = freshRuntime("decision");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    const responseQueue: string[] = [
      "no decision tag here",
      `<workflow-decision action="stop" reason="all done" />`
    ];
    const runtime = createRuntime(tempDir, {
      agentResponder: async () => {
        return responseQueue.shift() ?? "<workflow-decision action=\"stop\" />";
      }
    });
    runtime.init();

    runtime.createWorkflow({ workflowId: "judge", template: "blank" });
    const xmlPath = path.join(
      tempDir,
      "projects",
      "default",
      "workflows",
      "judge",
      "workflow.xml"
    );
    fs.writeFileSync(
      xmlPath,
      `<workflow id="judge" version="1">
        <input name="task" />
        <step id="decide" type="decision" agent="professor">
          <prompt>Decide for \${input.task}</prompt>
          <choices>
            <choice name="stop" terminate="success" />
          </choices>
        </step>
      </workflow>`,
      "utf8"
    );

    const result = runtime.startWorkflowRun({
      workflowId: "judge",
      input: { task: "ship?" }
    });

    const paused = await waitFor(() => {
      const state = runtime.getWorkflowRun("judge", result.runId);
      return state && state.status === "paused" ? state : null;
    });
    assert.equal(paused.pendingGate?.stepId, "decide");

    // Approve a retry; the second response contains a valid decision.
    runtime.approveWorkflowGate(result.runId, { kind: "retry" });
    const completed = await waitFor(() => {
      const state = runtime.getWorkflowRun("judge", result.runId);
      return state && (state.status === "complete" || state.status === "failed")
        ? state
        : null;
    });
    assert.equal(completed.status, "complete");
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow run skips Telegram updates when notifyWorkflowProgress is off", async () => {
  const { tempDir } = freshRuntime("notif-off");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    const createCalls: string[] = [];
    const editCalls: string[] = [];
    const runtime = createRuntime(tempDir, {
      agentResponder: async (input) => `Mocked: ${input.text}`,
      telegramStatusMessageCreator: async (_chatId, text) => {
        createCalls.push(text);
        return "999";
      },
      telegramMessageEditor: async (_chatId, _messageId, text) => {
        editCalls.push(text);
        return true;
      }
    });
    runtime.init();
    runtime.setupTelegram({ chatId: "12345" });
    // Pairing is intentionally NOT completed, so notifier should stay quiet even if the flag were on.

    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const result = runtime.startWorkflowRun({
      workflowId: "demo",
      input: { task: "Anything" }
    });
    await waitFor(() => {
      const candidate = runtime.getWorkflowRun("demo", result.runId);
      if (!candidate) return null;
      return candidate.status === "complete" ? candidate : null;
    });
    assert.equal(createCalls.length, 0, "should not send any Telegram messages when flag is off");
    assert.equal(editCalls.length, 0);
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow run streams step boundaries to Telegram when notifyWorkflowProgress is on and paired", async () => {
  const { tempDir } = freshRuntime("notif-on");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    const createCalls: string[] = [];
    const editCalls: string[] = [];

    // Pre-pair the chat by writing state, then load a fresh runtime.
    const statePath = path.join(tempDir, "opencolab.json");
    const stateOnDisk = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    stateOnDisk.telegram = {
      ...(stateOnDisk.telegram as Record<string, unknown>),
      chatId: "12345",
      paired: true,
      notifyWorkflowProgress: true
    };
    fs.writeFileSync(statePath, JSON.stringify(stateOnDisk, null, 2), "utf8");

    const runtime = createRuntime(tempDir, {
      agentResponder: async (input) => `Mocked: ${input.text}`,
      telegramStatusMessageCreator: async (_chatId, text) => {
        createCalls.push(text);
        return "10";
      },
      telegramMessageEditor: async (_chatId, _messageId, text) => {
        editCalls.push(text);
        return true;
      }
    });
    runtime.init();
    assert.equal(runtime.getState().telegram.paired, true);
    assert.equal(runtime.getState().telegram.notifyWorkflowProgress, true);

    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const result = runtime.startWorkflowRun({
      workflowId: "demo",
      input: { task: "Stream me" }
    });
    await waitFor(() => {
      const candidate = runtime.getWorkflowRun("demo", result.runId);
      if (!candidate) return null;
      return candidate.status === "complete" ? candidate : null;
    });
    // The notifier may need a tick after run_completed to flush; allow one more poll.
    await waitFor(() => (createCalls.length > 0 ? true : null));
    const allMessages = [...createCalls, ...editCalls].join("\n");
    assert.match(allMessages, /draft/, "message should reference the workflow step id");
    assert.match(allMessages, /Workflow demo/, "heading should mention the workflow id");
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setTelegramWorkflowNotifications persists the toggle", () => {
  const { runtime, tempDir } = freshRuntime("notif-toggle");
  try {
    assert.equal(runtime.getState().telegram.notifyWorkflowProgress, false);
    runtime.setTelegramWorkflowNotifications(true);
    assert.equal(runtime.getState().telegram.notifyWorkflowProgress, true);
    const reloaded = createRuntime(tempDir);
    reloaded.init();
    assert.equal(reloaded.getState().telegram.notifyWorkflowProgress, true);
    reloaded.setTelegramWorkflowNotifications(false);
    assert.equal(reloaded.getState().telegram.notifyWorkflowProgress, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("serializeWorkflow round-trips the built-in templates", () => {
  for (const template of [
    WORKFLOW_TEMPLATE_BLANK,
    WORKFLOW_TEMPLATE_REVIEW_LOOP,
    WORKFLOW_TEMPLATE_JUDGE_AND_RETRY
  ]) {
    const first = parseAndValidateWorkflow(template);
    assert.equal(first.ok, true, JSON.stringify(first.issues));
    const firstDef = first.definition as WorkflowDefinition;
    assert.ok(firstDef);
    const xml = serializeWorkflow(firstDef);
    const second = parseAndValidateWorkflow(xml);
    assert.equal(second.ok, true, JSON.stringify(second.issues));
    const secondDef = second.definition as WorkflowDefinition;
    assert.ok(secondDef);
    assert.equal(secondDef.id, firstDef.id);
    assert.equal(secondDef.version, firstDef.version);
    assert.equal(secondDef.stepOrder.length, firstDef.stepOrder.length);
    for (const stepId of firstDef.stepOrder) {
      assert.ok(
        secondDef.steps[stepId],
        `step ${stepId} should round-trip through the serializer`
      );
    }
    for (const loopId of Object.keys(firstDef.loops)) {
      const original: WorkflowLoop | undefined = firstDef.loops[loopId];
      const reparsed: WorkflowLoop | undefined = secondDef.loops[loopId];
      assert.ok(original);
      assert.ok(reparsed, `loop ${loopId} should round-trip`);
      assert.equal(reparsed.maxIterations, original.maxIterations);
      assert.equal(reparsed.maxSteps, original.maxSteps);
      assert.equal(reparsed.maxRuntimeMinutes, original.maxRuntimeMinutes);
      assert.deepEqual(reparsed.childStepIds, original.childStepIds);
    }
  }
});

test("patchWorkflowMetadata updates description, version, and inputs", () => {
  const { runtime, tempDir } = freshRuntime("patch-metadata");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const updated = runtime.patchWorkflowMetadata("demo", {
      description: "A demo workflow.",
      version: "2",
      inputs: [
        { name: "task", description: "Main task", required: true },
        { name: "context", description: "Optional context", required: false }
      ]
    });
    assert.match(updated.xml, /<workflow id="demo" version="2"/);
    assert.match(updated.xml, /<description>A demo workflow\.<\/description>/);
    assert.match(updated.xml, /<input name="task" description="Main task"/);
    assert.match(
      updated.xml,
      /<input name="context" description="Optional context" optional="true"/
    );
    const detail = runtime.getWorkflowDetail("demo");
    assert.ok(detail);
    assert.equal(detail!.version, "2");
    assert.equal(detail!.description, "A demo workflow.");
    assert.equal(detail!.inputs.length, 2);
    assert.equal(detail!.inputs[1]!.required, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("patchWorkflowMetadata rejects invalid input names", () => {
  const { runtime, tempDir } = freshRuntime("patch-invalid");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    assert.throws(
      () =>
        runtime.patchWorkflowMetadata("demo", {
          inputs: [{ name: "1bad", required: true }]
        }),
      /invalid/i
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readWorkflowXml returns the persisted XML and updatedAt", () => {
  const { runtime, tempDir } = freshRuntime("xml-read");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const doc = runtime.readWorkflowXml("demo");
    assert.ok(doc);
    assert.equal(doc!.workflowId, "demo");
    assert.match(doc!.xml, /<workflow id="demo"/);
    assert.equal(typeof doc!.updatedAt, "string");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateWorkflowXml rejects id mismatch and missing workflow", () => {
  const { runtime, tempDir } = freshRuntime("xml-update");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const xml = `<workflow id="other" version="1">
      <input name="task" />
      <step id="draft" type="agent" agent="professor">
        <prompt>Draft for \${input.task}</prompt>
        <output name="draft_output" />
      </step>
    </workflow>`;
    assert.throws(
      () => runtime.updateWorkflowXml("demo", xml),
      /does not match folder id/
    );
    assert.throws(
      () => runtime.updateWorkflowXml("missing", xml),
      /does not exist/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("validateWorkflowXml surfaces parser errors and good drafts", () => {
  const { runtime, tempDir } = freshRuntime("xml-validate");
  try {
    const bad = runtime.validateWorkflowXml(
      `<workflow id="x"><step id="" type="agent"></step></workflow>`
    );
    assert.equal(bad.ok, false);
    const good = runtime.validateWorkflowXml(
      `<workflow id="demo" version="1">
        <input name="task" />
        <step id="draft" type="agent" agent="professor">
          <prompt>Draft for \${input.task}</prompt>
          <output name="draft_output" />
        </step>
      </workflow>`
    );
    assert.equal(good.ok, true);
    assert.ok(good.definition);
    assert.equal(good.definition!.id, "demo");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("duplicateWorkflow rewrites the id and refuses existing targets", () => {
  const { runtime, tempDir } = freshRuntime("duplicate");
  try {
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });
    const result = runtime.duplicateWorkflow("demo", "demo-copy");
    assert.equal(result.workflowId, "demo-copy");
    const xml = runtime.readWorkflowXml("demo-copy");
    assert.match(xml!.xml, /<workflow id="demo-copy"/);
    assert.throws(
      () => runtime.duplicateWorkflow("demo", "demo-copy"),
      /already exists/
    );
    assert.throws(
      () => runtime.duplicateWorkflow("nope", "another"),
      /does not exist/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deleteWorkflow blocks on existing runs and supports cascade", async () => {
  const { tempDir } = freshRuntime("delete");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    const runtime = createRuntime(tempDir, {
      agentResponder: async (input) => `done: ${input.text}`
    });
    runtime.init();
    runtime.createWorkflow({ workflowId: "demo", template: "blank" });

    // No runs yet: safe delete.
    runtime.createWorkflow({ workflowId: "temp", template: "blank" });
    const removed = runtime.deleteWorkflow("temp");
    assert.equal(removed.workflowId, "temp");
    assert.equal(removed.runsRemoved, 0);
    assert.equal(runtime.readWorkflowXml("temp"), null);

    // Drive a run so the workflow has run history.
    const start = runtime.startWorkflowRun({
      workflowId: "demo",
      input: { task: "x" }
    });
    await waitFor(() => {
      const candidate = runtime.getWorkflowRun("demo", start.runId);
      return candidate && candidate.status === "complete" ? candidate : null;
    });

    let error: Error | null = null;
    try {
      runtime.deleteWorkflow("demo");
    } catch (caught) {
      error = caught as Error;
    }
    assert.ok(error);
    assert.match(error!.message, /run\(s\)/);

    const cascade = runtime.deleteWorkflow("demo", { cascade: true });
    assert.equal(cascade.runsRemoved, 1);
    assert.equal(runtime.readWorkflowXml("demo"), null);
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getWorkflowGraph returns nodes, edges, loops, and validation issues", () => {
  const { runtime, tempDir } = freshRuntime("graph");
  try {
    runtime.createWorkflow({
      workflowId: "review-loop",
      template: "review-loop"
    });
    const graph = runtime.getWorkflowGraph("review-loop");
    assert.ok(graph);
    assert.equal(graph!.workflowId, "review-loop");
    assert.equal(graph!.version, "1");

    const ids = graph!.nodes.map((node) => node.id);
    assert.ok(ids.includes("draft"));
    assert.ok(ids.includes("review"));
    assert.ok(ids.includes("judge"));
    assert.ok(ids.includes("__input"));

    const sequence = graph!.edges.filter((edge) => edge.kind === "sequence");
    assert.ok(sequence.length > 0);

    const choices = graph!.edges.filter((edge) => edge.kind === "choice" || edge.kind === "loop");
    assert.ok(choices.length > 0, "should include decision edges");

    assert.equal(graph!.loops.length, 1);
    assert.equal(graph!.loops[0]!.id, "review_loop");
    assert.equal(graph!.loops[0]!.maxIterations, 3);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("listWorkflowTemplates returns the built-in template descriptors", () => {
  const { runtime, tempDir } = freshRuntime("templates");
  try {
    const templates = runtime.listWorkflowTemplates();
    const ids = templates.map((template) => template.id).sort();
    assert.deepEqual(ids, ["blank", "judge-and-retry", "review-loop"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pauseWorkflowRun pauses a running workflow between steps", async () => {
  const { tempDir } = freshRuntime("pause");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    let agentCalls = 0;
    let releaseFirst!: () => void;
    const firstAgentReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = createRuntime(tempDir, {
      agentResponder: async (input) => {
        agentCalls += 1;
        if (agentCalls === 1) {
          await firstAgentReleased;
        }
        return `done: ${input.text}`;
      }
    });
    runtime.init();
    runtime.createWorkflow({ workflowId: "twostep", template: "blank" });
    // Override the workflow XML to have two sequential agent steps.
    const xmlPath = path.join(
      tempDir,
      "projects",
      "default",
      "workflows",
      "twostep",
      "workflow.xml"
    );
    fs.writeFileSync(
      xmlPath,
      `<workflow id="twostep" version="1">
        <input name="task" />
        <step id="first" type="agent" agent="professor">
          <prompt>First step for \${input.task}</prompt>
          <output name="first_output" />
        </step>
        <step id="second" type="agent" agent="professor">
          <prompt>Second step using \${first_output}</prompt>
          <output name="second_output" />
        </step>
      </workflow>`,
      "utf8"
    );
    const start = runtime.startWorkflowRun({
      workflowId: "twostep",
      input: { task: "x" }
    });
    // Wait for the first step to be in flight before requesting pause.
    await waitFor(() => (agentCalls >= 1 ? true : null));
    const pausedStatus = runtime.pauseWorkflowRun(start.runId);
    assert.ok(pausedStatus);
    // Let the first step finish so the loop can observe the pause flag.
    releaseFirst();
    const paused = await waitFor(() => {
      const candidate = runtime.getWorkflowRun("twostep", start.runId);
      return candidate && candidate.status === "paused" ? candidate : null;
    });
    assert.equal(paused.status, "paused");
    assert.equal(agentCalls, 1, "second step must not run after pause");
    runtime.resumeWorkflowRun(start.runId);
    const completed = await waitFor(() => {
      const candidate = runtime.getWorkflowRun("twostep", start.runId);
      return candidate && candidate.status === "complete" ? candidate : null;
    });
    assert.equal(completed.status, "complete");
    assert.equal(agentCalls, 2, "second step must run after resume");
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stopWorkflowRun aborts an active workflow", async () => {
  const { tempDir } = freshRuntime("stop");
  try {
    process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
    let stopRequested = false;
    let agentEntered = false;
    const runtime = createRuntime(tempDir, {
      agentResponder: async (_input, options) => {
        agentEntered = true;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            stopRequested = true;
            reject(new Error("aborted"));
          };
          if (options?.signal?.aborted) {
            onAbort();
            return;
          }
          options?.signal?.addEventListener("abort", onAbort, { once: true });
          setTimeout(() => resolve(), 5000);
        });
        return "should not return";
      }
    });
    runtime.init();
    runtime.createWorkflow({ workflowId: "stoppable", template: "blank" });
    const result = runtime.startWorkflowRun({
      workflowId: "stoppable",
      input: { task: "long" }
    });
    await waitFor(() => (agentEntered ? true : null));
    runtime.stopWorkflowRun(result.runId);
    const stopped = await waitFor(() => {
      const state = runtime.getWorkflowRun("stoppable", result.runId);
      return state && state.status === "stopped" ? state : null;
    });
    assert.equal(stopped.status, "stopped");
    assert.equal(stopRequested, true);
  } finally {
    delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
