---
name: workflow-builder
description: Author, validate, run, and oversee OpenColab project workflows that coordinate multiple agents through bounded loops, decisions, and human gates.
metadata:
  {
    "opencolab":
      {
        "emoji": "🛠️",
        "os": ["linux", "darwin", "win32"],
        "requires": { "bins": ["opencolab"] }
      }
  }
---

# Workflow Builder Skill

Use this skill when the user wants to compose multiple agents into a repeatable
workflow such as draft → review → judge, judge-and-retry, parallel reviews
followed by a merge, or any other bounded coordination of agents.

This skill **authors and operates** workflows through the OpenColab CLI. It is
not the workflow engine itself. The CLI/runtime owns parsing, execution,
persistence, and human gate handling.

## Source of truth

- Workflow definitions live at:
  `projects/<project_id>/workflows/<workflow_id>/workflow.xml`
- Workflow runs live at:
  `projects/<project_id>/workflows/<workflow_id>/runs/<run_id>/`
- Each run folder contains `RUN.md` (with YAML frontmatter), `state.json`,
  `status.json`, `events.jsonl`, `inputs/initial.md`, and `steps/<step_id>/`.

Never edit `state.json`, `status.json`, or `events.jsonl` by hand. They are
written by the runtime.

## Allowed step types

- `agent` — runs one project agent with a generated prompt. Required:
  `id`, `type="agent"`, `agent`, `<prompt>`. Optional: `<output name="..." />`.
- `decision` — runs one project agent and expects a strict
  `<workflow-decision action="..." next="..." reason="..." />` line in the
  response. Required: `id`, `type="decision"`, `agent`, `<prompt>`, `<choices>`.
- `human_gate` — pauses the run for human input. Required: `id`,
  `type="human_gate"`, `<prompt>`. Optional: `allow="approve,stop,retry,edit,branch"`.
- `merge` — concatenates prior outputs into a single named value. Required: `id`,
  `type="merge"`, at least one `<input name="..." />`, `<output name="..." />`.
- `terminate` — explicitly ends the run with a status of `success`, `failed`,
  or `stopped`.

## Loops must be bounded

Every `<loop>` requires at least one of:

- `maxIterations="<n>"`
- `maxSteps="<n>"`
- `maxRuntimeMinutes="<n>"`

Unbounded loops are rejected during validation.

## Prompt references

Inside any `<prompt>` you can use template variables:

- `${input.<name>}` — values supplied when starting the run.
- `${<output_name>}` — named outputs from prior steps (`<output name="..." />`).
- `${<step_id>.output>` — fallback reference for any step's raw output text.

## Author a workflow

1. Decide which project agents will play each role (drafter, reviewer, judge).
2. Pick a template:
   - `blank` for an empty scaffold
   - `review-loop` for draft → review → judge with a bounded loop
   - `judge-and-retry` for draft → judge → retry-or-stop
3. Run:
   ```bash
   opencolab workflow create --workflow-id <id> --from review-loop
   ```
4. Edit the generated `projects/<project_id>/workflows/<id>/workflow.xml` to
   reference real project agents, set the loop bound, and tighten prompts.
5. Validate before running:
   ```bash
   opencolab workflow validate --workflow-id <id>
   ```

## Run a workflow

```bash
opencolab workflow run --workflow-id <id> --input "<task text>"
# or
opencolab workflow run --workflow-id <id> --input-file inputs.json --wait true
```

`--input <text>` is shorthand for `{ "task": "<text>" }`. For richer inputs,
pass `--input-file <path>` or `--input-json '{"foo":"bar"}'`.

`--wait true` blocks the CLI until the run reaches a terminal or paused state
and streams events as they happen.

## Observe a run

- Latest status snapshot:
  ```bash
  opencolab workflow status --run-id <runId>
  ```
- Tail events:
  ```bash
  opencolab workflow logs --run-id <runId> --follow
  ```
- List all runs:
  ```bash
  opencolab workflow runs
  ```

## Stop, resume, approve

- `opencolab workflow stop --run-id <runId>` — cooperative stop.
- `opencolab workflow resume --run-id <runId>` — resume a paused run.
- `opencolab workflow approve --run-id <runId> --decision continue|stop|retry|branch:<step>|edit`
  — record a human gate decision. Use `--values-json '{"task":"..."}'` with
  `--decision edit` to update inputs before continuing.

## Decision contract for `decision` steps

Decision agents must end their response with a single line that looks like:

```xml
<workflow-decision action="continue" next="draft" reason="The answer still misses two constraints." />
```

- `action`: `continue`, `stop`, `branch`, `needs_human`, or `fail`.
- `next`: target step id when `action="continue"` or `action="branch"`.
- `reason`: short justification; surfaced in `events.jsonl` and Studio.

You may use `<choice name="..." />` blocks under `<choices>` to give the agent
a fixed menu. The agent can pick a choice by name via:

```xml
<workflow-decision action="continue" choice="continue" />
```

If the decision block is missing or invalid, the run pauses for human review
by default (or fails if `onInvalid="fail"` was declared on the step).

## Memory isolation

Workflow steps do not pollute normal agent chat memory. The runtime uses a
workflow-scoped session identity for every agent call and surfaces results
through the workflow's run folder, not the agent's `memory/Session/`.

## Things to avoid

- Do not author workflows outside the project workflows directory.
- Do not invent step types beyond the supported list — the validator rejects
  unknown tags and unsupported step `type` attributes.
- Do not skip loop bounds. Bounded loops are mandatory.
- Do not pretend this skill executes workflows. Always shell out to the CLI.
