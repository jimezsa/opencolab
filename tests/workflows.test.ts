import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";
import { parseAndValidateWorkflow } from "../src/workflows/parser.js";
import { parseXml, XmlSyntaxError } from "../src/workflows/xml.js";

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
