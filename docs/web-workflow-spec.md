# Studio Workflow CRUD Spec

## Purpose

OpenColab Studio needs a first-class workflow authoring and operations surface
for the project-scoped XML workflows defined in `docs/workflows.md`.

The Studio workflow page should let a user:

- create, inspect, edit, validate, duplicate, and delete workflow definitions
- see each workflow as a clear block diagram extracted from `workflow.xml`
- edit each workflow part from the diagram without hand-editing XML by default
- open a source XML editor when precise XML control is needed
- start, pause, resume, stop, and approve workflow runs
- watch the active agent, step, phase, and recent work while a workflow runs

The existing sidebar already exposes the active-project `Workflows` button. This
spec replaces the current placeholder route with the workflow CRUD and control
experience. It does not replace the CLI/runtime workflow engine.

## Existing Foundation

The workflow runtime contract lives in `docs/workflows.md`.

Current implemented pieces include:

- project-scoped definitions at
  `projects/<project_id>/workflows/<workflow_id>/workflow.xml`
- run folders at
  `projects/<project_id>/workflows/<workflow_id>/runs/<run_id>/`
- the XML parser, validator, sequential runner, durable status snapshots, and
  live registry under `src/workflows/`
- runtime methods for list/detail/start/status/events/stop/resume/approve
- web DTOs in `src/web/shared/types.ts`
- web API handlers in `src/web/server/workflows.ts`
- a placeholder Studio route at `src/web/client/src/routes/workflows.tsx`
- provider-aware agent avatars through
  `src/web/client/src/components/layout/agent-avatar.tsx`

The web feature should build on this foundation. Web handlers must call
`OpenColabRuntime` or `WorkflowService` methods directly, not shell out to
`opencolab workflow ...`.

## Goals

- Make workflows understandable before they run.
- Make common edits possible through forms and graph interactions.
- Keep `workflow.xml` as the source of truth for definitions.
- Keep runtime state in the existing run folders.
- Reuse existing agent/provider presentation, including the same agent image
  used on agent cards.
- Stream live workflow activity in Studio without polluting normal chat memory.
- Keep all workflow file operations inside the active project's workflow tree.

## Non-Goals

- Replacing XML with a separate JSON workflow format.
- Implementing parallel workflow execution.
- Creating a new workflow runtime for the browser.
- Exposing arbitrary filesystem paths or raw shell commands through the UI.
- Rendering generic marketing-style workflow pages instead of the usable editor.

## Information Architecture

Route:

```text
/projects/:projectId/workflows
```

Recommended layout:

- Left pane: workflow list, search/filter, create button, run status badges.
- Center pane: visual workflow diagram and selected-run overlay.
- Right pane: inspector with `Definition`, `Run`, and `XML` tabs.
- Bottom or collapsible panel: event timeline and per-step output preview.

Default entry behavior:

- Opening `/projects/:projectId/workflows` must show the selected project's
  workflow list first.
- No workflow diagram should be shown until a workflow is selected, unless the
  route includes a selected workflow id in a future deep-link format.
- Clicking a workflow row/card selects that workflow and loads its detail,
  graph DTO, XML, validation state, and recent runs.
- After selection, the page should keep the workflow list visible as the
  navigation surface while the center and right panes switch to the selected
  workflow's diagram, inspector, and run controls.
- The browser state should support deep linking or restoration for the selected
  workflow, for example with a nested route or query string, without making the
  list-first default ambiguous.

The page should work with the existing active-project sidebar entry. If no
project is active, it should show the same project-required empty state pattern
used by other Studio routes.

## Workflow List

The Workflows route is list-first. The list should show all definitions in the
selected project before any workflow is selected:

- workflow id
- description
- version
- number of steps
- required inputs
- latest run status, if any
- last definition update time

List actions:

- create workflow
- duplicate workflow
- validate workflow
- delete workflow
- open latest run
- start new run

Empty state:

- primary action: create from template
- secondary action: paste XML
- short note that workflows are stored under
  `projects/<project_id>/workflows/`

## Diagram Model

The diagram is a generated view of the parsed XML. The client should not infer
workflow behavior by scanning raw XML strings. It should receive a normalized
graph DTO derived from the same parser/validator used by the runtime.

Suggested DTO:

```ts
interface WebWorkflowGraph {
  workflowId: string;
  version: string;
  description: string | null;
  nodes: WebWorkflowGraphNode[];
  edges: WebWorkflowGraphEdge[];
  loops: WebWorkflowGraphLoop[];
  validation: WebWorkflowValidationIssue[];
}

interface WebWorkflowGraphNode {
  id: string;
  kind: "input" | "agent" | "decision" | "human_gate" | "merge" | "terminate";
  label: string;
  subtitle: string | null;
  agent: WebWorkflowGraphAgent | null;
  loopId: string | null;
  status: "idle" | "queued" | "running" | "paused" | "complete" | "failed" | "stopped";
}

interface WebWorkflowGraphAgent {
  id: string;
  provider: WebProviderInfo;
}

interface WebWorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "sequence" | "choice" | "loop" | "gate";
  label: string | null;
}

interface WebWorkflowGraphLoop {
  id: string;
  parentLoopId: string | null;
  childStepIds: string[];
  maxIterations: number | null;
  maxSteps: number | null;
  maxRuntimeMinutes: number | null;
}
```

Graph extraction rules:

- Add one input node group for declared workflow inputs.
- Add one node for each workflow step.
- Use sequence edges for default step order.
- Use choice edges for `decision` choices and human-gate branches.
- Use loop containers for `<loop>` blocks and loop-back edges only when they
  represent actual control flow.
- Label edges only when the label carries meaning, such as a decision choice,
  branch name, or protocol. Do not add generic `input` or `output` labels.
- Show validation errors and warnings on the relevant node, edge, or workflow
  header.

The layout should be deterministic. It may be generated client-side using a
diagram library, but node ids and edge ids must remain stable across reloads.

## Agent Images

Agent and decision nodes must reuse the same visual identity as agent cards:

- render `AgentAvatar` for each node with an assigned agent
- pass `provider.name` from the project's agent roster
- show the model and provider below the agent id in compact text
- show an unresolved-agent warning state if the XML references a missing agent
- for non-agent steps, use lucide icons rather than custom SVG icons

This keeps workflow diagrams visually tied to the existing Agents page. The
node should not embed a separate avatar image URL unless the shared agent avatar
component later changes to require one.

## Definition Editing

Users should be able to edit each workflow part without manually editing XML.
Clicking a diagram node or loop container opens the inspector editor for that
part.

Editable workflow fields:

- workflow id during create only
- version
- description
- inputs: name, description, required/optional

Editable step fields:

- common: id, type, loop membership, prompt
- `agent`: agent id, output name
- `decision`: agent id, choices, default/failure policy, output name
- `human_gate`: prompt, allowed actions, branch choices
- `merge`: source values, output name, merge template
- `terminate`: terminal status and message

Editable loop fields:

- loop id
- `maxIterations`
- `maxSteps`
- `maxRuntimeMinutes`

Editing behavior:

- Maintain an in-memory structured draft and serialize it to canonical XML.
- Validate the draft after every meaningful change, debounced for typing.
- Disable save while the draft has parser errors or unsupported references.
- Highlight validation issues in both the diagram and inspector.
- Keep a source XML tab for users who prefer raw editing.
- After raw XML edits, reparse and rebuild the diagram from the XML.
- Preserve semantic correctness over exact whitespace preservation. Canonical
  XML formatting is acceptable for the first implementation.

## CRUD Semantics

Create:

- create from `blank`, `review-loop`, or `judge-and-retry` templates
- create from pasted XML
- duplicate an existing workflow under a new id
- validate before writing `workflow.xml`

Read:

- list workflow summaries
- load workflow detail, XML, graph, validation issues, and recent run summaries

Update:

- update a workflow definition by replacing `workflow.xml` with validated XML
- write atomically
- reject id mismatches between URL, folder, and `<workflow id="...">`
- prevent saving if the workflow has an active running run unless the update is
  explicitly saved as a duplicate

Delete:

- default delete should fail with `409` when the workflow has run history
- allow deletion of a workflow with no runs after confirmation
- allow destructive workflow-and-runs deletion only behind an explicit
  confirmation payload that includes the workflow id
- never delete paths outside `projects/<project_id>/workflows/<workflow_id>/`

Recommended UI language should make destructive delete distinct from archive or
duplicate actions.

## Run Control

The run controls should sit above the diagram and in the run inspector tab.

Controls:

- Start: collect required inputs and call the runtime start API.
- Pause: request a pause at the next safe boundary.
- Resume: continue a paused run.
- Stop: request cancellation and abort the active controller when possible.
- Approve: satisfy a `human_gate` with continue, stop, retry, edit, or branch.

Pause semantics:

- `pause` is cooperative and should not kill an active provider process.
- If the run is between steps, it should transition to `paused` immediately.
- If an agent step is active, it should set `pause_requested` in durable state
  and pause before choosing the next step.
- `stop` remains the immediate cancellation path.

The UI should communicate these states clearly:

- `Pause requested` while the current agent step is still finishing.
- `Paused` when the run is waiting and can be resumed.
- `Stopping` while cancellation is in progress.

## Live Activity

Users must be able to see what the current agent is doing while a workflow is
running.

Live activity should combine:

- latest `WebWorkflowRunStatusDto`
- Server-Sent Events from the run's `/events` endpoint
- normalized `TaskProgressEvent` messages emitted by provider execution
- durable `events.jsonl` replay for page reloads
- per-step inputs, outputs, decisions, and metadata from the run detail API

The active node in the diagram should show:

- running/paused/error state
- active agent avatar when applicable
- current phase, such as `running_agent`, `parsing_decision`, or
  `waiting_for_human`
- loop iteration count
- most recent progress message

The run inspector should show:

- run id and workflow id
- status, phase, current step, current agent, and iteration
- recent progress lines, newest first
- pending gate controls when paused for a human gate
- step history with duration, decision, output name, and links to output files
- error details when failed

The UI must normalize runtime event names before display. Internal provider or
Codex lifecycle names such as `item.started` and `turn.completed` should not be
shown verbatim.

## API Requirements

Existing read/control endpoints from `docs/workflows.md` should remain:

```http
GET  /api/web/projects/:projectId/workflows
GET  /api/web/projects/:projectId/workflows/:workflowId
POST /api/web/projects/:projectId/workflows/:workflowId/runs
GET  /api/web/projects/:projectId/workflows/runs
GET  /api/web/projects/:projectId/workflow-runs/:runId
GET  /api/web/projects/:projectId/workflow-runs/:runId/status
GET  /api/web/projects/:projectId/workflow-runs/:runId/events
POST /api/web/projects/:projectId/workflow-runs/:runId/stop
POST /api/web/projects/:projectId/workflow-runs/:runId/resume
POST /api/web/projects/:projectId/workflow-runs/:runId/approve
```

Add definition CRUD endpoints:

```http
GET    /api/web/projects/:projectId/workflows/templates
POST   /api/web/projects/:projectId/workflows
GET    /api/web/projects/:projectId/workflows/:workflowId/xml
PUT    /api/web/projects/:projectId/workflows/:workflowId/xml
POST   /api/web/projects/:projectId/workflows/:workflowId/duplicate
DELETE /api/web/projects/:projectId/workflows/:workflowId
POST   /api/web/projects/:projectId/workflows/validate
POST   /api/web/projects/:projectId/workflows/:workflowId/validate
GET    /api/web/projects/:projectId/workflows/:workflowId/graph
POST   /api/web/projects/:projectId/workflow-runs/:runId/pause
```

Endpoint notes:

- `POST /workflows` accepts `{ workflowId, template }` or
  `{ workflowId, xml }`.
- `PUT /workflows/:workflowId/xml` replaces the definition with validated XML.
- `POST /workflows/validate` validates unsaved XML drafts.
- `POST /workflows/:workflowId/validate` validates the persisted definition.
- `GET /graph` returns the normalized diagram DTO and validation issues.
- `POST /pause` implements cooperative pause semantics through the runtime.
- All mutation endpoints should return web-safe DTOs and not raw filesystem
  paths except where an existing DTO already exposes project-local paths.

## Client API Helpers

Add typed helpers in `src/web/client/src/lib/api.ts` for:

- `workflows(projectId)`
- `workflow(projectId, workflowId)`
- `workflowGraph(projectId, workflowId)`
- `workflowXml(projectId, workflowId)`
- `createWorkflow(projectId, payload)`
- `updateWorkflowXml(projectId, workflowId, xml)`
- `deleteWorkflow(projectId, workflowId, payload)`
- `validateWorkflowXml(projectId, xml, workflowId?)`
- `startWorkflow(projectId, workflowId, payload)`
- `pauseWorkflowRun(projectId, runId)`
- `stopWorkflowRun(projectId, runId)`
- `resumeWorkflowRun(projectId, runId)`
- `approveWorkflowRun(projectId, runId, payload)`
- `workflowRunEventsUrl(projectId, runId)`

## XML and Validation Rules

Studio must use the same parser and validation rules as the runtime:

- reject malformed XML
- reject processing instructions, DTDs, external entities, and unknown tags
- reject invalid ids, duplicate step ids, and unknown branch targets
- reject unbounded loops
- reject missing agents
- reject unsafe workflow ids and path traversal attempts
- enforce a reasonable XML size limit before parsing

Validation responses should include enough location data for the UI to mark the
workflow header, node, loop, or source editor line when available.

## Accessibility and Interaction

- All diagram actions must be available from the inspector and toolbar, not only
  drag/drop.
- Nodes should be keyboard focusable.
- Edges and controls should have text labels or tooltips.
- Color must not be the only signal for status or validation.
- Live updates should not steal focus from forms.
- If an active run changes a node state while a user is editing, keep the draft
  intact and show the run state as an overlay.

## Failure States

The UI should handle:

- no workflows
- invalid workflow XML
- workflow references a missing agent
- no provider credentials for the assigned agent
- active run lost because gateway restarted
- SSE disconnected
- run stopped or failed while the editor is open
- save conflict because the file changed on disk

For save conflicts, prefer an explicit conflict response with current XML and
last modified time so the client can let the user compare or reload.

## Implementation Plan

### Phase 1: Read-Only Inspector

- Replace the placeholder route with a list-first workflow page.
- Load and show all project workflows before rendering any selected workflow
  diagram.
- Select a workflow from the list to load its detail view.
- Show diagram generated from persisted XML.
- Render agent nodes with `AgentAvatar`.
- Show run history and latest run status.
- Stream `/events` for a selected run.

### Phase 2: CRUD API

- Add template, create, validate, XML read/update, duplicate, graph, and delete
  endpoints.
- Add tests for path safety, validation failures, duplicate ids, delete guards,
  and id mismatch handling.
- Add typed client API helpers.

### Phase 3: Visual Editor

- Add diagram selection and inspector forms for workflow metadata, inputs,
  steps, loops, and choices.
- Add XML source editor tab.
- Keep diagram, forms, validation, and XML preview synchronized.
- Save through the validated XML update endpoint.

### Phase 4: Run Controls

- Add start input modal.
- Add pause endpoint and cooperative pause support in the runtime.
- Wire pause/resume/stop/approve controls.
- Overlay live status on diagram nodes.
- Show current agent activity and per-step outputs in the run inspector.

### Phase 5: Polish and Hardening

- Add keyboard navigation for graph nodes.
- Add loading, empty, disconnected, and conflict states.
- Add responsive behavior for narrow screens.
- Add focused tests for graph extraction and live status rendering.

## Verification

Before shipping the feature:

- `pnpm run check`
- `pnpm run build`
- `pnpm test`
- create a workflow from template in Studio
- validate and save a visual edit
- start a run from Studio
- pause at the next safe boundary
- resume the run
- stop a running run
- approve a human gate
- reload Studio and confirm durable status and event replay still render
