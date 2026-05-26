# Project Workflows Plan

This document is a design plan for project-scoped multi-agent workflows. It is
not yet an implemented runtime contract.

## Goal

OpenColab should let any agent in a project create, validate, and run reusable
workflows that coordinate multiple project agents.

A workflow should support patterns such as:

- agent A drafts or performs work
- agent B reviews, transforms, or tests agent A's output
- agent C judges the result against the original task and decides whether to
  stop, continue, branch, or ask the human
- bounded loops where agents repeatedly refine or evaluate work
- human gates where a person can approve, stop, edit, or choose a branch

The workflow system should be useful for research, code review, experiment
loops, writing, QA, adjudication, and arbitrary project-specific agent
collaboration.

## Design Principle

A shared skill is useful for helping agents author workflow definitions, but the
skill should not be the workflow engine.

The workflow engine should be a first-class CLI/runtime feature so OpenColab can:

- validate workflow definitions before execution
- persist run state and artifacts
- stop and resume long-running runs
- enforce loop and runtime limits
- route outputs from one agent to another deterministically
- expose progress through CLI, Telegram, and Studio
- avoid corrupting normal human chat memory

The skill should teach agents how to write and use workflow definitions. The CLI
and runtime should execute them.

## Project Layout

Workflow definitions should be project-scoped:

```text
projects/<project_id>/workflows/<workflow_id>/workflow.xml
```

Workflow runs should be stored separately from definitions:

```text
projects/<project_id>/workflows/<workflow_id>/runs/<run_id>/
```

Recommended run folder contents:

```text
RUN.md
events.jsonl
state.json
inputs/
steps/
artifacts/
```

Detailed layout:

```text
projects/<project_id>/workflows/<workflow_id>/runs/<run_id>/
  RUN.md
  events.jsonl
  state.json
  inputs/
    initial.md
  steps/
    <step_id>/
      input.md
      output.md
      decision.xml
      meta.json
  artifacts/
```

`RUN.md` should contain YAML frontmatter with:

- `workflow_id`
- `run_id`
- `project_id`
- `status`: `running`, `paused`, `complete`, `failed`, `stopped`
- `created`
- `updated`
- `initiator`
- `current_step`
- `iteration`

`events.jsonl` should be append-only and include workflow-level events such as
step start, step completion, branch choice, human gate pause, resume, stop, and
failure.

`state.json` should contain the normalized execution state needed to resume a
run.

## Workflow Definition Format

Workflow definitions should use XML as the user-facing authoring format.
OpenColab should parse XML into a normalized internal TypeScript model before
execution.

Example:

```xml
<workflow id="review-loop" version="1">
  <input name="task" />

  <step id="draft" type="agent" agent="agent-a">
    <prompt>Produce an initial answer for ${input.task}</prompt>
    <output name="draft_output" />
  </step>

  <loop id="review_loop" maxIterations="5">
    <step id="review" type="agent" agent="agent-b">
      <prompt>Review ${draft.output} and suggest improvements.</prompt>
      <output name="review_output" />
    </step>

    <step id="judge" type="decision" agent="agent-c">
      <prompt>
        Compare the original task, the draft, and the review. Decide whether
        the workflow should continue, stop, or ask the human.
      </prompt>
      <choices>
        <choice name="continue" next="draft" />
        <choice name="stop" terminate="success" />
        <choice name="human" gate="human" />
      </choices>
    </step>
  </loop>
</workflow>
```

## Step Types

The MVP should support a small set of step types.

### `agent`

Runs a single project agent with a generated workflow prompt.

Required attributes:

- `id`
- `type="agent"`
- `agent`

The runner should resolve `agent` against the active project's agent roster.

### `decision`

Runs a project agent and expects a strict machine-readable decision block.

The decision controls the next workflow action. Free-form prose must not control
the graph.

Recommended decision output:

```xml
<workflow-decision
  action="continue"
  next="review"
  reason="The answer still misses two constraints."
/>
```

Allowed actions:

- `continue`
- `stop`
- `branch`
- `needs_human`
- `fail`

If the decision block is missing or invalid, the runner should either pause for
human review or fail the step, depending on workflow policy.

### `human_gate`

Pauses the workflow until a human chooses what happens next.

Human gate choices should support:

- approve and continue
- stop
- retry a step
- edit input and continue
- choose a branch

### `merge`

Combines prior step outputs into one named context value.

This is useful before handing a bundle of evidence to a reviewer or judge.

### `terminate`

Explicitly ends a workflow run with a terminal status.

## Loop Rules

Loops must be bounded.

Every loop should define at least one of:

- `maxIterations`
- `maxSteps`
- `maxRuntimeMinutes`

The runner should reject unbounded loops during validation.

When a limit is reached, the run should pause or fail with a clear event in
`events.jsonl`.

## CLI Surface

Add a new command group:

```bash
opencolab workflow list
opencolab workflow show --workflow-id <id>
opencolab workflow validate --workflow-id <id>
opencolab workflow create --workflow-id <id> --from blank|review-loop
opencolab workflow run --workflow-id <id> --input "..." --wait false
opencolab workflow run --workflow-id <id> --input-file <path> --wait true
opencolab workflow status --run-id <id>
opencolab workflow logs --run-id <id> --follow
opencolab workflow stop --run-id <id>
opencolab workflow resume --run-id <id>
opencolab workflow approve --run-id <id> --decision continue|stop|branch:<step>
```

For agents, the most important commands are:

```bash
opencolab workflow validate --workflow-id <id>
opencolab workflow run --workflow-id <id> --input-file <path>
opencolab workflow status --run-id <id>
```

## Runtime Engine

Add a `WorkflowRunner` service behind the CLI.

Responsibilities:

- parse XML using a real XML parser
- disable DTDs and external entities
- reject huge definitions and unknown tags
- validate all referenced agents exist in the selected project
- normalize the workflow into an internal graph
- execute one step at a time for the MVP
- call `ProviderAgent.respondFor(project, agent, input, options)`
- persist step inputs, outputs, decisions, artifacts, and state
- emit `TaskProgressEvent` updates
- support `AbortController` cancellation
- support pause/resume for human gates
- enforce loop, step, and runtime limits

The initial implementation should be sequential. Parallel branches can be added
after persistence, cancellation, and decision handling are stable.

## Memory Handling

Workflow runs should not pollute the active human chat session.

Each agent step should use a workflow-specific session identity, such as:

```text
workflow-<workflow_id>-<run_id>-<step_id>
```

The agent should still receive relevant project context, prior workflow outputs,
and its own normal memory. However, workflow step transcripts should be clearly
tagged as workflow execution records.

## Human Control

Humans should be able to stop or pause a workflow at any time.

The CLI should support:

- stop a running workflow
- inspect current step and latest output
- resume after a pause
- approve a human gate
- override a decision

Telegram and Studio can later expose the same controls, but the CLI should be
the first supported control plane.

## Shared Skill

Add a shared skill:

```text
projects/SKILLS/workflow-builder/SKILL.md
```

The skill should teach agents how to:

- design bounded workflow XML
- choose project agents for each role
- use `agent`, `decision`, `human_gate`, `merge`, and `terminate` steps
- write strict decision prompts
- validate workflows before running them
- run workflows through the CLI
- inspect outputs and resume or stop runs

The skill should explicitly say that it authors and operates workflows through
the CLI. It should not pretend to be the workflow engine.

## Studio Integration

The current Studio workflows route is a placeholder. After the CLI/runtime MVP,
Studio can become a read-only workflow inspector.

Initial Studio views:

- workflow list for the selected project
- workflow definition summary
- run history
- run event timeline
- per-step input/output preview
- current paused gate with required human action

Later Studio work can add visual editing.

## Implementation Phases

### Phase 1: Spec and Storage

- Update `docs/spec.md` with workflow requirements.
- Add workflow state and run-folder conventions.
- Add XML schema/validation rules.
- Add workflow fixtures for tests.

### Phase 2: Parser and Validator

- Implement XML parsing and normalization.
- Validate IDs, references, loop bounds, duplicate step IDs, and unsupported
  tags.
- Add `opencolab workflow validate`.

### Phase 3: Sequential Runner

- Implement `agent`, `decision`, `human_gate`, `merge`, and `terminate`.
- Persist `RUN.md`, `events.jsonl`, `state.json`, and step files.
- Add cancellation and bounded runtime checks.
- Add `run`, `status`, `logs`, `stop`, `resume`, and `approve`.

### Phase 4: Agent Skill

- Add `workflow-builder` shared skill.
- Add templates such as `review-loop` and `judge-and-retry`.
- Update shared built-in tool guidance so agents know the workflow CLI exists.

### Phase 5: Gateway and Studio

- Emit workflow progress through existing `TaskProgressEvent` surfaces.
- Add Telegram summaries for workflow starts, pauses, completions, and failures.
- Replace the Studio placeholder with a read-only inspector.

### Phase 6: Advanced Features

- Add parallel branches.
- Add subworkflow calls.
- Add artifact-aware routing.
- Add workflow templates per project.
- Add visual Studio editing.

## MVP Recommendation

Build the first version as sequential, project-scoped, XML-defined, bounded
workflows.

Do not start with parallel execution. Once sequential loops, decisions,
approvals, persistence, and cancellation are reliable, parallel branches become a
straightforward extension.
