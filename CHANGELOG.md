# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Added an n8n-style flow diagram for Studio Workflows using `@xyflow/react` + `@dagrejs/dagre`. The Definition tab now renders the workflow as a horizontal block diagram with bezier connections, pan/zoom, controls, and a minimap. Layout is fully deterministic — dagre's compound graph layout positions step nodes inside loop containers via `setParent`, and the loop container is drawn as a dashed amber rectangle around its children with the loop id and bounds shown along the top edge. Agent and decision nodes render the existing `AgentAvatar` (decision adds a small `GitFork` overlay), and human gate / merge / terminate / input use lucide-icon tiles. Edges are color-coded and styled by kind: `sequence` (default solid), `choice` (sky blue, labeled with the choice name), `loop` (amber, animated), `gate` (orange dashed). Active and run-status states still ring the node (running/paused/failed/stopped/complete). The old vertical card-stack diagram (`WorkflowGraph`) is kept in the component tree for reuse but no longer the default render.

### Added

- Added the Studio Workflows visual editor (Phase 3). The Definition tab now exposes a structured metadata + inputs editor that lets the user edit the workflow description and version, and add/rename/remove inputs (each with optional description and a required/optional toggle). The editor sends a JSON patch to a new `PATCH /api/web/projects/:projectId/workflows/:workflowId` endpoint that re-emits canonical XML on the server, validates it, and rejects the change when the workflow has an active run.
- Added an editable XML tab with debounced live validation (500 ms via `POST /workflows/validate`), inline issue list (errors + warnings counted separately), `Save XML` (calls `PUT /workflows/:workflowId/xml`), `Reset`, and `Reload from disk` actions. Save is disabled while the draft has errors; conflicts and validation failures are surfaced both inline and via toast.
- Added a canonical workflow XML serializer (`src/workflows/serializer.ts`) that is the inverse of `parseAndValidateWorkflow` and emits XML for every supported step kind (agent, decision with choices and `onInvalid`, human_gate with `allow=`, merge with optional `separator`, terminate with status + optional message), workflow inputs (with `description` and `optional="true"`), and loops (with `maxIterations`/`maxSteps`/`maxRuntimeMinutes` and nested child steps). Whitespace is normalized; ids, attributes, and references are preserved.
- Added `WorkflowService.applyMetadataPatch(workflowId, patch)` that reads the persisted XML, parses it, applies a `{ description?, version?, inputs? }` patch onto the in-memory definition, re-serializes to canonical XML, validates again before writing, and refuses while an active run exists. Surfaced through `OpenColabRuntime.patchWorkflowMetadata` and the new web endpoint.
- Added shared `WebWorkflowMetadataPatchRequest`/`WebWorkflowInputPatch` DTOs and a typed `api.patchWorkflowMetadata(projectId, workflowId, payload)` client helper.
- Added three new tests covering the serializer round-trip across all built-in templates (`blank`, `review-loop`, `judge-and-retry`), an end-to-end `patchWorkflowMetadata` that updates description/version/inputs and verifies the persisted XML + parsed detail, and a negative test rejecting invalid input names (`1bad` fails the `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` rule).

### Added (Phase 1 + Phase 2 + Phase 4)

- Added the OpenColab Studio Workflows page at `/projects/:projectId/workflows`, replacing the placeholder route with a list-first layout. The left pane lists every workflow in the active project (id, version, step count, declared inputs, last update). Selecting a workflow loads its diagram, run history, and source XML; the selection is deep-linkable through `?workflow=<id>&run=<runId>` query parameters.
- Added a generated workflow diagram that consumes a normalized `WebWorkflowGraph` DTO (nodes, edges, loops, validation issues) derived from the same parser/validator the runtime uses. Agent and decision nodes reuse the existing `AgentAvatar` (provider-specific logo); non-agent steps render with lucide icons (`BotIcon`, `GitForkIcon`, `HandIcon`, `MergeIcon`, `StopCircleIcon`, `LogInIcon`). Loops are rendered as dashed containers showing `maxIterations`/`maxSteps`/`maxRuntimeMinutes`; sequence/choice/loop/gate edges are labeled only when meaningful (decision branch names, loop-back arrows, human gates).
- Added a workflow inspector with `Definition`, `Runs`, and `XML` tabs. The Definition tab shows declared inputs and the diagram. The Runs tab lists runs with a status badge and click-to-select, then opens the run inspector below. The XML tab streams the persisted `workflow.xml` plus its path and last-modified time.
- Added a `Start run` dialog (right-side sheet) that collects required inputs declared by the workflow, validates that required fields are non-empty, calls `api.startWorkflow`, and auto-selects the new `runId` in the runs tab.
- Added run controls (Pause, Resume, Stop, Refresh) in the run inspector, enabled per current status (Pause only when running/queued; Resume only when paused without a pending human gate; Stop while not terminal). Each control hits the typed client helper and refreshes durable state after the action.
- Added a human-gate approval form that renders only when a run has a `pendingGate`. It shows the gate prompt and only the actions the gate allows (`approve`/`retry`/`stop`/`edit`/`branch`); `edit` parses `key=value` lines into approval `values`, and `branch` requires a target step id. Submits via `api.approveWorkflowRun`.
- Added SSE-backed live updates in the run inspector. The panel subscribes to `/workflow-runs/:runId/events` and re-renders status badges (phase, step, iteration), step history, and the events list as messages arrive; whenever the streamed status flips to `paused` or a terminal kind, the panel refetches the full run detail so `pendingGate` and `stepHistory` stay accurate without a manual reload.
- Added new web endpoints under `/api/web/projects/:projectId/workflows` and `/api/web/projects/:projectId/workflow-runs`: `GET /workflows/templates` (lists `blank`, `review-loop`, `judge-and-retry`), `POST /workflows` (`{ workflowId, template }` or `{ workflowId, xml }`, validates before writing), `GET /workflows/:workflowId/xml`, `PUT /workflows/:workflowId/xml` (validates the draft, rejects id mismatch between URL and `<workflow id="...">`, blocks while the workflow has an active run), `POST /workflows/:workflowId/duplicate` (`{ workflowId }`), `POST /workflows/validate` (free draft), `POST /workflows/:workflowId/validate` (persisted), `GET /workflows/:workflowId/graph` (normalized `WebWorkflowGraph`), `DELETE /workflows/:workflowId` (default 409 when run history exists; opt-in `cascade=true` with optional workflow-id confirmation removes the workflow and its runs), and `POST /workflow-runs/:runId/pause` (cooperative pause).
- Added a cooperative pause primitive on the workflow runner and registry. `markPauseRequested(runId)` records a request without aborting the active provider call; the runner checks the predicate between steps and transitions the run to `paused` at the next safe boundary (after any active agent step finishes), writing durable state and emitting a new `run_paused` event. Resuming clears the pause flag via `clearPauseRequested(runId)`. New `WorkflowEventKind` values: `pause_requested` and `run_paused`.
- Added `WorkflowService` methods to back the new endpoints: `listTemplates`, `getTemplateXml`, `readXml`, `updateXml` (validation + id-mismatch + 256 KB cap + active-run guard), `validateXml`, `duplicateWorkflow`, `deleteWorkflow` (with `cascade` option and `workflow_has_runs` error code), `getGraph`, and `pauseRun`. Exposed through `OpenColabRuntime` as `listWorkflowTemplates`, `readWorkflowXml`, `updateWorkflowXml`, `validateWorkflowXml`, `duplicateWorkflow`, `deleteWorkflow`, `getWorkflowGraph`, and `pauseWorkflowRun`.
- Added shared DTOs in `src/web/shared/types.ts`: `WebWorkflowGraph`, `WebWorkflowGraphNode`, `WebWorkflowGraphEdge`, `WebWorkflowGraphLoop`, `WebWorkflowGraphAgent`, `WebWorkflowValidationIssue`, `WebWorkflowValidationResponse`, `WebWorkflowTemplate`, `WebWorkflowTemplateId`, `WebWorkflowCreateRequest`/`Response`, `WebWorkflowXmlResponse`, `WebWorkflowUpdateXmlRequest`, `WebWorkflowDuplicateRequest`, `WebWorkflowDeleteRequest`/`Response`, `WebWorkflowValidateRequest`, and `WebWorkflowPauseResponse`.
- Added typed client helpers in `src/web/client/src/lib/api.ts`: `workflows`, `workflow`, `workflowGraph`, `workflowXml`, `workflowTemplates`, `createWorkflow`, `updateWorkflowXml`, `duplicateWorkflow`, `deleteWorkflow`, `validateWorkflowXml`, `workflowRuns`, `workflowRun`, `workflowRunStatus`, `startWorkflow`, `pauseWorkflowRun`, `stopWorkflowRun`, `resumeWorkflowRun`, `approveWorkflowRun`, and `workflowRunEventsUrl`. The client now also generalizes JSON helpers into `postJson`/`putJson`/`deleteJson` over a shared `sendJson` core.
- Added eight new workflow tests under `tests/workflows.test.ts` covering: `readWorkflowXml` round-trip, `updateWorkflowXml` id-mismatch + missing-workflow rejection, `validateWorkflowXml` parser errors and good drafts, `duplicateWorkflow` id rewrite and refusal of existing targets, `deleteWorkflow` run-history guard plus `cascade` removal, `getWorkflowGraph` node/edge/loop/validation shape, `listWorkflowTemplates` descriptors, and `pauseWorkflowRun` cooperative pause-between-steps with resume-completes-second-step.

## [0.2.4] - 2026-05-28

### Added

- Added project-scoped multi-agent workflows as a first-class runtime contract (phases 1-6 of `docs/workflows.md`). Workflow definitions live at `projects/<project_id>/workflows/<workflow_id>/workflow.xml`, runs persist to `projects/<project_id>/workflows/<workflow_id>/runs/<run_id>/` with `RUN.md` (YAML frontmatter for `workflow_id`, `run_id`, `project_id`, `status`, `created`, `updated`, `initiator`, `current_step`, `iteration`), `state.json` (durable execution state), `status.json` (latest durable status snapshot for CLI/web readers), append-only `events.jsonl`, `inputs/initial.md`, and `steps/<step_id>/` directories holding `input.md`, `output.md`, `decision.xml`, and `meta.json` per step iteration.
- Added a safe in-house XML parser (`src/workflows/xml.ts`) that explicitly rejects `<!DOCTYPE>` and `<!ENTITY>` declarations and processing instructions, enforces a 256 KB input cap and 64-level nesting cap, supports `<![CDATA[...]]>` sections plus the standard `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&apos;`/numeric character entities, and reports errors with line numbers via `XmlSyntaxError`.
- Added a normalizing workflow parser/validator (`src/workflows/parser.ts`) that turns workflow XML into a strict in-memory `WorkflowDefinition`, validates workflow/step/loop/input/output ids against `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, rejects duplicate step ids, unknown decision-branch targets, unsupported child elements, and unbounded loops (every `<loop>` must declare at least one of `maxIterations`, `maxSteps`, or `maxRuntimeMinutes`), and emits warning-severity issues for prompt template references to unknown values without aborting validation.
- Added five supported step types: `agent` (one project agent with a generated `<prompt>` and optional `<output name="..." />`), `decision` (one project agent that must end with a strict `<workflow-decision action="continue|stop|branch|needs_human|fail" next="..." reason="..." />` line, with `<choices>` enumerating named `<choice next|terminate|gate>` targets and an `onInvalid="pause|fail"` policy), `human_gate` (pauses the run with a configurable `allow="approve,stop,retry,edit,branch"` set), `merge` (concatenates declared `<input name="..." />` values into a single named `<output>` with a configurable `separator`), and `terminate` (ends the run with `status="success|failed|stopped"` and an optional `<message>`).
- Added template variable expansion in `<prompt>` text: `${input.<name>}` resolves against workflow inputs, `${<output_name>}` resolves against any prior step's named output, and `${<step_id>.output}` resolves against the most recent raw output of a specific step. Unknown variables are left in place and surfaced as validation warnings.
- Added a sequential `WorkflowRunner` (`src/workflows/runner.ts`) that drives one workflow run at a time, increments per-loop iteration counters on each entry to a loop's start step, enforces `maxIterations`/`maxSteps`/`maxRuntimeMinutes` before each step, persists `state.json`/`status.json`/`events.jsonl`/`RUN.md` on every transition, writes per-step `input.md`/`output.md`/`decision.xml`/`meta.json`, calls project agents through the same `ProviderAgent.respondFor` path used by Telegram and Studio chat (with a fresh empty memory context so workflow steps do not pollute the active human chat session), enforces cooperative cancellation through `AbortController` and `state.stopRequested`, parses decision agent output, and routes invalid decision blocks to a pause or fail per the step's `onInvalid` policy.
- Added an in-process active workflow run registry (`src/workflows/registry.ts`) that tracks per-run `AbortController`, latest `WorkflowRunStatus` snapshot, a bounded backlog (200 entries) of recent `WorkflowEvent`s, and three listener sets (status, event, progress) for live SSE/CLI subscribers. The registry is a live coordination layer; durable truth stays in the run folder, especially `state.json`, `status.json`, and `events.jsonl`.
- Added a transport-neutral `WorkflowService` (`src/workflows/service.ts`) that wraps the parser, runner, registry, and storage so CLI, runtime, and web layers share one execution path. It exposes `listWorkflows`, `validateWorkflow`, `getWorkflowDetail`, `createWorkflow`, `startRun`, `stopRun`, `resumeRun`, `approveRun`, `getRunState`, `getRunStatus`, `resolveRun`, `listRunSummaries`, and `listRunEvents`, plus three built-in templates (`blank`, `review-loop`, `judge-and-retry`).
- Added workflow methods on `OpenColabRuntime`: `listWorkflows`, `getWorkflowDetail`, `validateWorkflow`, `createWorkflow`, `startWorkflowRun`, `stopWorkflowRun`, `resumeWorkflowRun`, `approveWorkflowGate`, `getWorkflowRun`, `getWorkflowRunStatus`, `resolveWorkflowRun`, `listWorkflowRuns`, and `listWorkflowRunEvents`. A per-project `WorkflowService` instance is cached on the runtime so the CLI and the Studio web server share the same in-process registry and abort controllers.
- Added the `opencolab workflow` CLI command group with subcommands `list`, `show --workflow-id <id>`, `validate --workflow-id <id>`, `create --workflow-id <id> [--from blank|review-loop|judge-and-retry]`, `run --workflow-id <id> [--input <text>|--input-file <path>|--input-json <json>] [--wait true|false]`, `status --run-id <id>`, `logs --run-id <id> [--follow]`, `stop --run-id <id>`, `resume --run-id <id>`, `approve --run-id <id> --decision continue|stop|retry|branch:<step>|edit [--values-json <json>]`, and `runs [--workflow-id <id>]`. `--input <text>` is shorthand for `{ "task": "<text>" }`, `--wait true` blocks the CLI until the run reaches a terminal or paused state and streams events as they happen, and `--follow` tails `events.jsonl` until completion.
- Added Studio web routes under `/api/web/projects/:projectId/workflows` and `/api/web/projects/:projectId/workflow-runs`: `GET /workflows`, `GET /workflows/:workflowId`, `POST /workflows/:workflowId/runs`, `GET /workflow-runs/:runId`, `GET /workflow-runs/:runId/status`, `GET /workflow-runs/:runId/events` (Server-Sent Events with a `history` replay of `events.jsonl` followed by live `progress` and `status` events, plus periodic keep-alive comments), `POST /workflow-runs/:runId/stop`, `POST /workflow-runs/:runId/resume`, and `POST /workflow-runs/:runId/approve`. The Studio web request handler now allows non-GET methods on the workflow namespaces while the rest of the read-only DTO API continues to reject non-GET methods with `405`.
- Added shared workflow DTOs in `src/web/shared/types.ts` (`WebWorkflowSummary`, `WebWorkflowDetail`, `WebWorkflowStepSummary`, `WebWorkflowLoopSummary`, `WebWorkflowInput`, `WebWorkflowRunSummary`, `WebWorkflowRunDetail`, `WebWorkflowRunStatusDto`, `WebWorkflowPendingGate`, `WebWorkflowRunProgress`, `WebWorkflowEvent`, `WebWorkflowStartRequest`, `WebWorkflowStartResponse`, `WebWorkflowStopResponse`, `WebWorkflowApprovalRequest`, `WebWorkflowStepKind`, `WebWorkflowRunStatus`, `WebWorkflowRunPhase`) so the browser never reads raw `state.json`, `status.json`, or `events.jsonl` directly.
- Added a durable `WorkflowRunStatus` model with `currentStepId`, `currentStepType`, `currentAgentId`, `currentAgentLabel`, `currentPhase` (`validating`, `preparing_input`, `running_agent`, `parsing_decision`, `waiting_for_human`, `writing_outputs`, `choosing_next_step`, `completed`), `iteration`, `maxIterations`, `progress.current`/`progress.total`, `pendingGate`, and `error`, written to `status.json` on every transition so Studio and CLI status readers can answer "which workflow is running, which step is active, which agent is currently working, what phase that agent is in, which loop iteration is active, whether the run is waiting for a human, whether the run can be stopped/resumed/approved" even after the gateway restarts.
- Added the shared `workflow-builder` skill at `projects/SKILLS/workflow-builder/SKILL.md`. The skill teaches agents how to design bounded workflow XML, choose project agents for each role, use the five step types, write strict decision prompts, validate workflows before running them, and operate runs through the `opencolab workflow ...` CLI. It explicitly states that it authors and operates workflows through the CLI and is not the workflow engine.
- Added workflow runtime tests under `tests/workflows.test.ts` covering XML rejection of DOCTYPE declarations, CDATA/entity handling, loop-bounds validation, duplicate step ids and unknown branch targets, acceptance of the `review-loop` template, workflow creation and listing, error surfacing in `validateWorkflow`, end-to-end execution of a single-agent workflow with a mocked agent responder, decision-step parse-error pause + retry via human gate, and stop-mid-flight cancellation that aborts the active agent call and transitions the run to `stopped`.

### Changed

- `README.md` "Project and Agent Commands" now lists `opencolab workflow list|create|run|status` alongside the existing project, agent, and gpu commands, and the "Features first release" / "Next feature direction" sections now mark the workflow runtime as shipped with a pointer to `docs/workflows.md`.
- `AGENTS.md` "Core implementation areas" now documents `src/workflows/` as the workflow parser/validator/runner/registry/service module, and the seeded shared-skill rules now mention `workflow-builder` as the canonical authoring/operating path for project workflows.
- `docs/workflows.md` header now states that phases 1-6 are implemented and points at the matching `src/workflows/`, CLI command group, runtime API, web routes, and `workflow-builder` skill, while phase 7 (parallel branches, subworkflow calls, artifact-aware routing, per-project templates, visual Studio editing) is still listed as future work.

## [0.2.3] - 2026-05-26

### Added

- Added OpenColab Studio chat, a first-class local web chat interface at `/projects/:projectId/chat` for talking to any project agent from the Studio browser. The route is reachable from the project sidebar, project detail, agent detail, and conversation list rows, and supports `?agent=<agentId>`, `?session=<sessionId>`, and `?artifact=<artifactId>` deep links, defaulting to the project's active agent when no `agent` query is present.
- Studio chat ships a three-region desktop layout (left agent/session rail, center transcript + composer, right live-status / returned-files / preview rail), with chat-as-primary-surface mobile fallbacks. The transcript renders user and assistant turns chronologically, attaches upload chips to user turns and returned-file chips to assistant turns, and pins the composer to the bottom.
- The composer supports multi-line text, file attach with chip list and per-chip remove, send, stop, an empty-or-no-agent disabled state, and keyboard behavior (`Enter` to send, `Shift+Enter` for newline, `Escape` to clear the local draft when no upload is pending).
- The agent picker lists every agent in the active project, shows the active provider/model in compact form, surfaces an `active` badge for the project's active agent and a `busy` badge when a Telegram or web turn is already running for that agent, disables sending to a busy agent unless the active turn belongs to the open session, and persists the selected agent in the URL query string.
- Live status follows the Telegram semantics without copying the Telegram API behavior: it consumes normalized `TaskProgressEvent` objects, renders a bounded recent meaningful activity list (up to six lines) with the newest visible line marked `🟢` and older visible lines marked `⚪`, surfaces warnings and `needs_input` events through `aria-live` and styling, lets the user stop a running turn, keeps the last summary visible after completion until the user selects a file or sends another message, and never appends progress events to `memory/Session/` conversation memory.
- Added shared chat/Markdown rendering through `components/markdown/markdown-message.tsx`, which uses `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` so chat messages, returned Markdown files, and previews all render GitHub-flavored Markdown, fenced code blocks with highlighting, tables, inline `$...$` math, and display `$$...$$` math while leaving dollar signs inside fenced code blocks alone.
- Added a generic, reusable `components/pdf/pdf-viewer.tsx` that wraps `react-pdf` + `pdfjs-dist` with page navigation, page count, zoom, an "open raw" affordance, and the 50 MB inline guard; the existing research PDF viewer and the new chat artifact rail both delegate to it instead of duplicating the worker setup.
- Added previews in the chat right rail for returned PDFs (inline via the generic viewer), Markdown (math-capable renderer with directory-aware relative link resolution), plain text (scrollable monospace block), and images (fit-to-pane). Unknown or unsafe types render metadata plus "open raw" and "download" actions instead of executing arbitrary HTML.
- Added new `/api/web/projects/:projectId/chat/*` HTTP routes on the gateway: `GET /agents`, `GET /sessions`, `GET /sessions/:sessionId`, `POST /sessions/new`, `POST /sessions/:sessionId/reset`, `POST /uploads`, `POST /send`, `POST /turns/:turnId/stop`, `GET /turns/:turnId`, `GET /turns/:turnId/events` (Server-Sent Events), and `GET /files/:fileId`. Send returns `{ turnId, sessionId, status }` and 409s with the active turn summary when the agent is busy; the SSE stream emits `progress`, `message`, `completed`, and `error` events with periodic keep-alive comments.
- Added a sibling web turn registry owned by the new `src/web/server/chat.ts` module (instead of pretending the browser is a Telegram chat), which tracks the per-process turn state, abort controllers, SSE subscribers, progress history (bounded to fifty events), and a server-side file registry with opaque randomly-generated upload/returned-file IDs.
- Added `OpenColabRuntime.runWebChatTurn` plus `resolveProjectAgentPair`, `isAgentBusyOnGateway`, `webChatActiveSessionId`, `webChatListSessionIds`, `webChatReadSessionMessages`, `webChatActivateSession`, `webChatResetSession`, and `webChatAppend` so the chat module can share `ProviderAgent`, prompt memory, and `memory/Session/` with the Telegram gateway without coupling to Telegram-specific inbound parsing.
- Added `ConversationStore.getActiveSessionId`, `listSessionIds`, `activateSession`, and `readSessionMessages` so the chat module can target a specific session, switch the active session marker safely, and replay an entire session's transcript instead of just the current-day window.
- Added project-scoped upload storage at `projects/<project_id>/AGENTS/<agent_id>/uploads/<YYYY-MM-DD>/<upload_id>/<safe_filename>`, with ASCII-normalized safe filenames (path-separator and dotfile stripped), preserved original filename plus size, MIME type, and kind in a per-batch `manifest.json`, rejection of path traversal and symlink escapes, a configurable per-file size cap (100 MB) and total-request cap (250 MB), and synthetic `TelegramFilePayload` entries that surface uploaded local paths in the `[telegram_files]` block fed to the provider prompt.
- Added returned-file directive parsing that reuses the existing `@telegram-file <json>` concept but maps each directive into a typed `WebChatAttachment` record, resolves relative references against the agent directory, accepts absolute paths and `file://` URLs only when they resolve inside the active agent directory (with symlink-escape detection through `realpath`), strips the directive lines from rendered assistant prose, and preserves the raw directives in `memory/Session/` so the agent still sees its own previously-returned files on the next turn.
- Added a project-scoped file streaming endpoint with content type, size, `ETag`, `If-None-Match` 304 handling, HTTP `Range` support, conservative inline-vs-attachment `Content-Disposition` (inline only for PDF/Markdown/image/text), and a hard refusal to serve files outside the resolved allowed root.
- Added a minimal in-process multipart parser used by the upload endpoint (no third-party dep) plus an `ApiError` class on the client that carries the response status and body so the chat composer can render a busy-agent message inline when a `409` comes back.
- Added the shared `WebChat*` DTOs in `src/web/shared/types.ts` (`WebChatAgentOption`, `WebChatAttachment`, `WebChatAttachmentKind`, `WebChatMessage`, `WebChatProgressEvent`, `WebChatProgressKind`, `WebChatSessionDetail`, `WebChatSessionSummary`, `WebChatTurn`, `WebChatTurnStatus`, `WebChatSendRequest`, `WebChatSendResponse`, `WebChatUploadResponse`, `WebChatNewSessionResponse`) so the browser never reads raw `opencolab.json`, raw JSONL session files, or provider logs directly.
- Added a new `components/ui/textarea.tsx` (shadcn-style) for the composer, and wired the chat route into the sidebar navigation and top-bar route descriptor.
- Added eight backend tests under `tests/web-chat.test.ts` covering attachment-kind detection, safe-filename normalization, allowed-root containment with symlink escapes, `@telegram-file` directive stripping with unsafe-path drops, the `[telegram_files]` inbound block formatter, the multipart parser, the new conversation-store/runtime session helpers, and the boundary where `runWebChatTurn` appends only the user turn and leaves assistant persistence to the chat module.
- Studio chat now renders image attachments inline inside the chat turn through a shared `AttachmentsRow` helper: image-kind files appear as full-width, lazy-loaded thumbnails (`w-full max-h-[28rem]` with `object-contain` so aspect ratio is preserved) that open in a click-anywhere/Escape-to-close lightbox dialog (React portal, `fixed inset-0 z-50 bg-black/85`, image capped at 92vw/92vh with a top-right close button), while non-image attachments group below the images and keep using the existing chip layout. Works the same for user uploads (inside the orange `you` bubble) and agent-returned files (under the assistant Markdown).
- Studio chat transcript gained a top-center "View full session" pill button (lucide `ArrowUpToLineIcon`, secondary variant, rounded full) that smooth-scrolls back to the start of the session. The composer + inline live-status panel now react to scroll _direction_ — they collapse out of the layout (`hidden`, `aria-hidden`) when the user is scrolling upward through history, freeing that area for the `MessagesList` viewport, and reappear as soon as the user starts scrolling back down or reaches the bottom. Auto-scroll on new messages is gated by a separate near-bottom flag so a streaming reply never yanks the user away from history.
- Studio chat now exposes project research directly from the chat surface through a new shadcn-style `Accordion` (Radix-backed) in the left rail. The rail has two collapsible sections — `Returned files` (chat attachments, open by default, count badge) and `Research` (open by default, project research runs from `/api/web/projects/:id/research`). Each research run is a nested accordion item whose header shows the topic, skill, status, and corpus icons (papers / summaries / diagrams) reused from the existing research card; expanding a run lazy-loads its file tree, filters to previewable kinds (`pdf`, `markdown`, `image-*`, `json`, `text`), and sorts entries by kind priority (`pdf` → `markdown` → `image` → `text` → `archive`/`audio`/`video`/`other`) then by name. Each file row uses a kind-specific lucide icon — `BookOpen` for PDFs, `FileText` for Markdown / text, `Braces` for `.json`, `Image` for diagrams — and the rail's three list bodies (returned files, research run list, per-run file list) are wrapped in bounded `overflow-y-auto` containers so long sections scroll inside the accordion. A `researchFileToAttachment(projectId, runId, file)` helper normalizes `WebResearchFile` entries into `WebChatAttachment` shape so the shared `AttachmentPreview` can preview research outputs unchanged.
- Studio chat now has a dedicated right-side preview panel that is always visible at the same `w-72` width as the left rail (keeping the chat horizontally centered between the two side rails). The panel shows a small `Preview` label and an empty-state hint when nothing is selected, or the selected file's name plus a close button and the shared `AttachmentPreview` (PDF, Markdown, image, text) when a file is picked from either the `Returned files` or the `Research` section of the left rail.

### Changed

- Routed Codex defaults now include `--skip-git-repo-check` so OpenColab-managed Codex runs can start in non-git workspaces.
- Default provider models bumped: Anthropic now defaults to `claude-opus-4-7`, OpenAI now defaults to `gpt-5.5`, and Gemini now defaults to `gemini-3.5-flash`. Existing configured agents keep their saved model.
- The research PDF viewer is now a thin adapter over the generic `components/pdf/pdf-viewer.tsx`, so the chat artifact rail can preview returned PDFs without duplicating the `react-pdf` worker setup.
- The Studio web request handler now allows any HTTP method for the `/api/web/projects/:projectId/chat/*` namespace (previously the whole `/api/web/` surface was GET-only), while the rest of the read-only DTO API continues to reject non-GET methods with `405`.
- The Studio client bundle now imports `katex/dist/katex.min.css` at the app entry so math rendering works in chat messages, returned Markdown previews, and any future Markdown viewer that opts into the shared component.
- Added `katex`, `remark-math`, and `rehype-katex` as Studio client dependencies in `src/web/client/package.json`.
- Studio chat transcript styling now drops the bordered message bubble for assistant turns so the agent's Markdown response spans the full transcript width without any framing. User turns render as a right-aligned, rounded (`rounded-2xl`) light-orange bubble (`bg-orange-100`, dark-mode tinted `bg-orange-500/15`) capped at 85% width with a small grey `you` label on top; assistant turns no longer carry a label. The "thinking…" pending indicator was removed entirely.
- The Studio chat agent picker and session list have moved out of the chat route's left column into a new "Chat" sidebar group. A `ChatSidebarHost` context wraps the AppShell tree so the chat route registers its agents, sessions, selection callbacks, and loading flags through `useRegisterChatSidebar`, and the sidebar reads them via `useChatSidebarValue`. The chat route now renders a 2-column layout (transcript + right rail) wrapped in a `flex justify-center` row with an inner `max-w-6xl w-full` grid, so the conversation stays horizontally centered inside `SidebarInset` regardless of whether the sidebar is expanded or collapsed to icons.
- Studio chat live status has moved out of the right rail and now renders inline above the composer, inside the chat interface itself. `LiveStatus` lost its `h-full` flex sizing for a natural-height layout with a bounded `max-h-36` `aria-live` scroll area, and the SSE completion handler no longer clobbers a terminal status with `null` — so the last summary (with `completed`/`failed`/`stopped`/`timed_out` badge and elapsed time) stays visible until the user sends another message or switches sessions. The right rail now always shows returned files.
- Installed `@tailwindcss/typography` and enabled it via `@plugin "@tailwindcss/typography";` in `src/web/client/src/index.css`, so the `prose prose-sm` classes on chat messages and returned Markdown previews actually produce paragraph, list, table, code block, and blockquote spacing instead of rendering Markdown content as a single compact run of text.
- Studio chat now blends into the page background: the central transcript `<section>` no longer draws a border, the inner `ScrollArea` inside the right-rail file list drops its border, and the composer's inner `Textarea` no longer renders its own border, focus ring, shadow, or input background, so the text field sits flush inside the rounded composer container.
- Studio chat composer was redesigned as a single vertically centered flex row (`items-center`): icon-only Attach button on the left (`size="icon"` ghost button, `aria-label`/`title` preserved), the textarea in the middle (`flex-1 min-h-0 max-h-48 resize-none` with `field-sizing-content` so it starts at one row and grows), and an icon-only Send / Stop button on the right. The labeled `Attach`/`Send`/`Stop` text was dropped; the buttons share a vertical centerline with the textarea so they stay centered as the prompt grows, and the wrapper + textarea both keep symmetric `p-2` / `py-2` vertical padding.
- Studio chat layout was restructured around a three-column flex row inside `SidebarInset`: the `Returned files` rail is docked on the left at `w-72`, the chat `<section>` sits in a `flex-1 justify-center` middle column capped at `max-w-3xl`, and the right preview rail mirrors the left at `w-72`. The whole row keeps the chat horizontally centered both when the sidebar is expanded and when it collapses to icons, and a `lg:` breakpoint hides the side rails on narrow viewports.
- The Studio sidebar now defaults to closed (`defaultOpen={false}` on `SidebarProvider`) and uses `collapsible="offcanvas"` so the closed state slides the rail fully out of view (no icon strip remains). A new `SidebarHoverGuard` mounted inside the `SidebarProvider` watches `mousemove` on non-mobile viewports and opens the sidebar (`setOpen(true)`) when the pointer reaches the very left edge (`clientX <= 12px`) and closes it (`setOpen(false)`) once the pointer moves past the sidebar's open width (`clientX > 320px`), so the sidebar peeks in on hover and disappears as soon as the pointer leaves the left side.
- Studio chat right-side preview panel widened from `w-72` to responsive `w-96 xl:w-md 2xl:w-lg` so research PDFs render at a usable size in the rail. The generic `components/pdf/pdf-viewer.tsx` now sizes each page to its container width via a `ResizeObserver` (zoom multiplies the container width instead of a fixed scale) and exposes a fullscreen toggle (lucide `Maximize2`/`Minimize` icon button) that overlays the viewer with `position: fixed inset-0 z-50` for full-viewport reading; `Escape` exits fullscreen, and the existing "Open" raw-tab link is retained.

### Removed

- Removed the Studio Conversations page (`/projects/:projectId/conversations`), its sidebar entry, the project-detail "Conversations" tab, the matching `GET /api/web/projects/:projectId/conversations` and `GET /api/web/projects/:projectId/conversations/:sessionId` HTTP routes, the `api.conversations` / `api.conversation` client helpers, and the now-dead `getConversationDetail` / `isActiveSession` / `toWebMessage` server helpers. The new chat route supersedes the dedicated conversations browser; the `listProjectConversations` / `listAgentConversations` DTO builders stay because the dashboard, agent detail "recent sessions", and chat session list still consume them.
- Removed the Studio Artifacts page (`/projects/:projectId/artifacts`), its sidebar entry, the project-detail "Artifacts" tab, the matching `GET /api/web/projects/:projectId/artifacts` HTTP route, and the `api.artifacts` / `WebArtifactSummary` client import. The `listProjectArtifacts` server helper and `WebArtifactSummary` DTO stay because the dashboard and project overview still surface `recentArtifacts` and `artifactCount` summaries.
- Removed the Studio Research page (`/projects/:projectId/research`, `/projects/:projectId/research/:runId`, `/projects/:projectId/agents/:agentId/research`), its sidebar entry, the agent-detail "Research" tab and `AgentResearchTab` helper, the `api.agentResearch` client helper, and the entire `components/research/` folder (`file-tree`, `markdown-viewer`, the research PDF adapter, and `research-list`). The chat file rail's `Research` accordion now hosts project research instead, so `api.research`, `api.researchRun`, `researchFileUrl`, and the matching server handlers stay in place.
- Dropped the "Overview" entry (and its unused `Badge` import) from the Active Project sidebar group; the project overview is still reachable by clicking a project card on `/projects`.

### Fixed

- OpenColab Studio research browser PDF viewer no longer fails with an API/Worker version mismatch; `pdfjs-dist` is now pinned to the exact version `react-pdf` bundles so the worker and the API agree.
- Studio chat side rails (`Returned files` + `Research` accordion on the left, file preview on the right) no longer scroll out of view when the user scrolls up through the transcript. `SidebarInset` is now pinned to exactly the viewport height (`h-svh overflow-hidden`), the `AppShell` outlet wrapper carries its own `min-h-0 overflow-auto` so non-chat routes keep their natural page-level scroll, and the chat route's outer flex row now sets `overflow-hidden` so only the `MessagesList` viewport scrolls — the accordion, the preview rail, and the composer stay pinned in place.

## [0.2.2] - 2026-05-16

### Fixed

- Windows background gateway Task Scheduler XML is now written as UTF-16LE with a BOM, fixing `schtasks` startup failures that reported malformed XML or an encoding switch error.

## [0.2.1] - 2026-05-16

### Fixed

- Windows background gateway tasks now run through a hidden supervisor script that restarts the foreground gateway after any exit, with Task Scheduler restart-on-failure kept as an outer safety net.

### Changed

- Seeded role `AGENTS.md` templates are now shorter and defer reusable maintenance, memory, tool, and runtime-surface rules to the shared agent files and injected built-in guidance.
- Shared `ALMA.md` guidance now carries common evidence-discipline rules for separating facts, assumptions, and open questions, citing non-obvious claims, stating uncertainty, and avoiding invented sources, data, results, or tool outputs.
- The bootstrap template no longer suggests example agent names during first-run identity setup.

## [0.2.0] - 2026-05-08

### Added

- Seeded `PROJECT-AND-TEAM.md` now includes front matter for a short project name, short description, and project emoji, and professor guidance now tells the lead agent to fill those fields once project identity is known.

### Changed

- OpenColab Studio now renders the projects list as a card grid with NotebookLM-style cards sourced from each project's `PROJECT-AND-TEAM.md` front matter (`project_name`, `project_description`, `project_emoji`), pastel tint hashed by project id, large emoji, 2-line clamped title, and a footer with relative activity time and agent count.
- OpenColab Studio agent cards now share the project card layout — pastel tint hashed by agent id, larger provider avatar top-left, active badge, 2-line clamped agent id, and a provider/model footer with a heart-icon heartbeat status line that shows the time-until-wake from `HEARTBEAT.md` `after:` or `idle` when none is scheduled — and both grids use the same responsive breakpoints and inset horizontal padding.
- The OpenColab Studio dashboard stat cards (active project, projects, agents, gateway) and the project detail Agents tab now share the same pastel-tinted, ring-less card style and inset horizontal padding as the projects and agents grids; the agent card markup is now a single shared component reused by the agents roster and project detail.
- The web interface spec was updated to require card grids for both projects and agents while keeping tables for artifacts and runs.

## [0.1.11] - 2026-05-04

### Fixed

- Telegram file return directives now upload local `file://` URLs and Windows absolute paths as multipart files while keeping remote URLs as Bot API references.
- Windows background gateway startup no longer opens an extra closeable Command Prompt window; Task Scheduler now launches the gateway through a hidden noninteractive PowerShell wrapper.

## [0.1.10] - 2026-05-04

### Fixed

- Windows `opencolab gateway start` now supports background mode through a per-user Task Scheduler task instead of failing with the macOS/Linux-only service error.
- Manual SSH live session state writes are now atomic, avoiding intermittent `Unknown manual SSH session` reads while the detached worker updates `session.json`.

## [0.1.9] - 2026-05-03

### Added

- Added OpenColab Studio, a local web interface served by the existing gateway that exposes a sidebar-driven dashboard for active project/agent, projects, agents, conversations, artifacts, GPU runs, and gateway/provider health.
- Added a Vite + React + Tailwind v4 + shadcn/ui client under `src/web/client/`, read-only `/api/web/*` DTO handlers under `src/web/server/`, and shared DTOs under `src/web/shared/types.ts`.
- Added `pnpm run web:dev` and `pnpm run web:build` scripts; `pnpm run build` now builds and copies the static client bundle into `dist/web/`, and the published package now ships `dist/web` alongside `dist/src`.
- Added the shared `latex-paper-writer` skill for creating, editing, Git-versioning, compiling, and returning scientific LaTeX papers, reports, and research-derived PDF summaries with venue-aware starter templates, experiment-result table generation, and PDF build validation.
- Added an optional ML/LLM architecture diagram template under the shared `block-diagram` skill for neural-network, transformer, training, and quantization diagrams.
- Added an `autoresearch` progress graph helper that plots the configured key metric over experiment number with green kept experiments, gray discarded experiments, short kept-experiment labels, and a running-best line.

### Changed

- The gateway HTTP server now delegates non-Telegram, non-`/api/state`, non-`/health` routes to the web layer, which serves `/api/web/*` JSON and the built client bundle from `dist/web/` (or `src/web/client/dist` in source mode), with credential values never exposed in health DTOs.
- Seeded agent instructions and built-in prompt guidance now explain how to configure `HEARTBEAT.md` and require explicit user approval before agents modify heartbeat schedules.
- Built-in shared-skill guidance now includes `latex-paper-writer`, and the LaTeX PDF build path prefers `latexmk` while keeping a bounded `pdflatex` fallback and platform-specific install remediation.
- Renamed the shared paper research skills from `fast-search`, `pro-search`, and `deep-search` to `fast-research`, `pro-research`, and `deep-research`, including their shared skill directories, prompt guidance, and LaTeX research-to-PDF integration reference.

## [0.1.8] - 2026-04-26

### Added

- Every agent now seeds an empty `HEARTBEAT.md`, and users can enable a delayed active-agent wake-up by adding a valid `after: <duration>` line such as `after: 30m`.
- Telegram now supports `/stop` for cancelling the active routed task in the same chat or topic, saving a compact recovery summary in session memory so a later turn can resume from the last known stage.

### Changed

- `ignite` onboarding now offers OpenAI `gpt-5.5`, Anthropic `claude-opus-4-7`, and matching OpenRouter model ids in the curated model chooser.
- Supported OpenAI and Anthropic reasoning-effort defaults now use `high`, and Anthropic Claude models now also expose `xhigh`.
- `HEARTBEAT.md` now supports `notify: live` for Telegram live status during heartbeat wake-ups and `message: <plain text>` to replace the default `continue` prompt.
- After an active-agent run completes, is stopped, or times out, OpenColab can now arm one quiet per-project heartbeat wake-up in `opencolab.json`, and the background gateway process will fire one internal `continue` turn when that same agent is still active and idle at the scheduled time.
- `HEARTBEAT.md` can now opt into one compact paired-chat Telegram follow-up with `notify: digest`, so meaningful heartbeat completions, timeouts, failures, and clear blockers no longer have to stay completely silent.
- Routed provider execution now exposes a gateway-owned cancellation path so stopped Telegram runs close live status cleanly, suppress stale late replies, and avoid appending cancelled partial output as a finished assistant answer.
- Telegram long polling now dispatches consumed updates without waiting for the previous routed run to finish, so `/stop` can interrupt an in-flight task instead of being blocked behind it.
- CLI help for `opencolab gpu ssh` and `opencolab gpu ssh session` now includes concrete manual-SSH session examples for `start`, `read`, `write`, and `stop`.
- Routed Codex runs now use `codex -a never exec --json --sandbox danger-full-access`, so clone, push, and other repo writes are not blocked by the default workspace-write sandbox, and OpenAI reasoning-effort injection now preserves the correct `codex exec` argument order.
- Seeded agents now use a stronger completeness-first `ALMA.md` standard that explicitly prefers permanent fixes, searching before building, and testing before shipping when the real solution is within reach.
- The built-in `autoresearch` agent now seeds a dedicated `ALMA.md` and stricter continuity guidance so repo-contract details, repeated user corrections, rejected paths, and lessons from failed runs carry forward across experiment loops.
- Seeded agents now treat `TODO.md` as a lean live working list for current focus, top priorities, and active blockers only, defaulting to at most three open priority items and continuously pruning completed or stale entries instead of accumulating backlog or done-history there.

### Removed

- Legacy Codex default CLI arg migration support for older `["exec", "-"]` configs.

## [0.1.7] - 2026-04-06

### Added

- Anthropic provider setup now supports `oauth` mode through Claude Code login, including runtime preflight and remediation when the stored Claude session is missing or API-key auth is still active.
- Built-in `pi`-backed provider support for `openrouter` and `kimi`, including `opencolab setup model`, `ignite` onboarding, runtime env wiring for `OPENROUTER_API_KEY` and `KIMI_API_KEY`, and the upstream `kimi-coding` provider mapping used by `pi`.
- A shared `autoresearch` skill plus a built-in `autoresearch` specialist template for iterative keep/discard experiment loops over one explicitly configured repo, with explicit repo contract requirements, disposable branch/worktree guidance, and default ownership of sustained experiment-loop work by the `autoresearch` agent.
- Project-scoped `opencolab gpu ssh profile ...` and `opencolab gpu ssh session ...` commands for saving user-managed Runpod Pod SSH details, setting per-agent defaults, and running transcript-backed live manual SSH sessions.

### Changed

- OpenAI defaults and onboarding examples now use `gpt-5.5`, and the OpenRouter OpenAI example now uses `openai/gpt-5.5`.
- `ignite` onboarding and `opencolab setup model` now expose native reasoning-effort selection for supported models, currently including OpenAI `gpt-5.5` (`low`, `medium`, `high`, `xhigh`) and Anthropic Claude on the Claude runtime (`low`, `medium`, `high`, `max`).
- Shared workflow and template docs now mention `autoresearch` alongside the other built-in shared skills, and the README inspiration list now includes `karpathy/autoresearch`.
- Professor-facing built-in staffing guidance now explicitly calls out `opencolab agent create --agent-id autoresearch` when a project needs a dedicated owner for sustained experiment-loop work.
- The shared `runpod-job` guidance now defaults to a user-managed Runpod Pod workflow where the human creates the Pod, provides the `pod_id`, and the agent uses direct SSH, while keeping the OpenColab-managed `gpu server` and `gpu job` lifecycle as an explicit opt-in for `run_id`-tracked work.
- Telegram management from paired chats now centers on `/projects`, `/agents`, and `/session_reset`, with picker-based project and agent selection and session reset remaining available while project and agent creation stay CLI-driven.
- Telegram live status now waits for real runtime progress before creating a status surface, keeps private chats compact, and streams a bounded recent tool-activity list through one editable message in groups.
- Telegram live status now marks the newest visible step with `🟢` and older still-visible steps with `⚪` so the active step is easier to spot while a run is streaming.
- Routed Telegram text replies are now prefixed with the active agent id on the first line so one Telegram chat can distinguish which agent answered without polluting conversation memory.
- Routed Codex runs now normalize nested `item.*` lifecycle events and `turn.completed` into user-facing Telegram live status text instead of leaking raw protocol names such as `item.started`.
- Routed Claude Code runs now use the current `claude -p --verbose --output-format stream-json` contract so Telegram live status continues to work with newer Claude Code releases.
- Existing saved Claude-runtime provider configs on recognized older default arg sets now auto-migrate to the current streaming contract when OpenColab loads state, so upgraded installs recover Telegram live status without requiring manual model reconfiguration.
- Anthropic native reasoning flags are now inserted before the Claude CLI `-- <prompt>` separator so reasoning-effort settings do not break current Claude runtime invocation.
- Telegram final text replies are now split into ordered chunks before hitting the Bot API text limit, preserve active group topic routing, and log Telegram API status and descriptions when delivery fails instead of dropping oversized replies silently.

### Removed

- Telegram support for the older `/project ...`, `/agent ...`, and `/session reset` text command families, along with the older slash-menu aliases such as `/project_create`.
- The shared `fast-search`, `pro-search`, and `deep-search` skill docs no longer call out optional `PAPERCLI_SEMANTIC_API_KEY` and `PAPERCLI_SERPAPI_KEY` prerequisites.

## [0.1.6] - 2026-04-02

### Changed

- New/default Runpod execution targets and the `ignite` curated Runpod preset now default to the `keep_warm` auto-stop policy.
- The shared `runpod-job` workflow guidance now defaults to `NVIDIA A100 80GB PCIe`, uses `keep_warm`, and requires agents to ask whether a warm Pod should keep running after a terminal-backed run completes.
- One-link installer-managed installs now persist managed install metadata so `opencolab upgrade` can upgrade both installer-managed package installs and `--hacky` installer-managed clone installs through the same CLI entrypoint.
- Packaged installs now keep using the platform runtime root when `OPENCOLAB_ROOT` is unset instead of letting stray cwd-local `opencolab.json` or `.env.local` files silently hijack the runtime root.
- The shell and PowerShell one-link installers now warn when another `opencolab` command appears earlier on `PATH` than the installer-managed shim.

## [0.1.5] - 2026-03-31

### Changed

- Routed provider runs that hit `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS` now preserve the inbound user request and append a compact recovery note to the active session memory, so the next turn can resume from the last known stage instead of starting cold.
- The shared `runpod-job` workflow guidance now requires detached-only launches with `--wait false` for every Runpod job, returns the `run_id` promptly for later inspection, refreshes local log snapshots with `opencolab gpu job status` before reporting on a run, and reviews `bootstrap`, `stdout`, `stderr`, and `poller` when summarizing outcomes.
- Telegram now exposes `/projects` and `/agents` picker commands that return inline buttons, and the gateway can process callback-query taps to switch the active project or agent without requiring typed ids.

## [0.1.4] - 2026-03-30

### Added

- `opencolab gpu server availability --server-id <id>` now reports a live Runpod datacenter and GPU capacity snapshot for one configured target before launch.
- `opencolab gpu job exec --run-id <id> --command "<command>"` now runs one bounded remote command over the launched Runpod Pod SSH path and returns `runId`, `targetId`, `exitCode`, `stdout`, and `stderr`.

### Changed

- Bare `opencolab` help now shows the installed CLI version immediately, and `opencolab --version` / `opencolab version` print it directly.
- New/default Runpod execution targets and the `ignite` curated Runpod preset now default to the `pytorch-cu12` bootstrap profile instead of `python-ml`.
- The shared `runpod-job` workflow guidance now prefers detached launch with `--wait false` for longer jobs, returns the `run_id` promptly for later inspection, and requires failed or degraded runs to be surfaced with a clear next action.
- Runpod availability checks now surface the best current datacenter and GPU match, preserve configured fallback order, and warn about Pod-API-incompatible datacenters or known storage-provisioning failures.
- Runpod provisioning now falls back cleanly across preferred datacenters when per-location network-volume creation fails, and normalizes shorthand GPU names to the canonical Runpod GPU ids required by Pod creation.
- The shared `runpod-job` skill now teaches agents to run live availability checks before launch when stock matters, treat availability as a snapshot rather than a reservation, and distinguish launch failures from slower remote bootstrap work after SSH is already available.
- The shared `runpod-job` workflow and built-in agent guidance now teach agents to use `gpu job exec` for bounded direct Pod inspection instead of exposing raw SSH details.

## [0.1.3] - 2026-03-29

### Changed

- Packaged installs now default their runtime root to `~/.opencolab` on macOS/Linux or `%LOCALAPPDATA%\OpenColab\root` on Windows when `OPENCOLAB_ROOT` is unset, instead of falling back to the caller's current working directory.

## [0.1.2] - 2026-03-29

### Added

- npm package metadata now links the published package back to the GitHub repository, issue tracker, and changelog.

### Changed

- Provider CLI execution now defaults to a 30 minute timeout instead of 10 minutes and remains configurable via `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS`.

### Removed

- Legacy support for the `OPENCOLAB_CODEX_TIMEOUT_MS` timeout env var.

## [0.1.1] - 2026-03-27

### Added

- Windows PowerShell one-link installer support via `install.ps1`.
- Optional `--hacky` git-clone fallback mode for the one-link installers when the desired npm package version is unavailable.
- Project-scoped `PROJECT-AND-TEAM.md` shared context seeded for new/default projects and loaded into every agent prompt.
- Professor-led specialist creation guidance, including explicit `opencolab agent create --agent-id <id>` and per-agent `opencolab setup model --agent-id <id> ...` workflow references.

### Changed

- `install.sh` now fails fast on Windows and directs users to the PowerShell installer.
- Seeded agent startup guidance now requires reading `BOOTSTRAP.md` before `ALMA.md` while bootstrap still exists, preventing first-contact identity setup from being skipped.
- Seeded agent instructions now treat `PROJECT-AND-TEAM.md` as the canonical shared project context and require agents to follow its maintenance rules before editing it.
- Prompt construction now loads shared project context after `TODO.md` and before agent-local `MEMORY.md`.
- Seeded professor guidance now treats specialist hiring as a normal lead-agent responsibility with human approval, while specialist and beginner agents route staffing recommendations back through professor by default.
- `PROJECT-AND-TEAM.md` now supports recording agent roster status such as proposed, created, configured, active, paused, or archived when it matters to the project.

## [0.1.0] - 2026-03-26

Initial public npm release of OpenColab.

### Added

- Multi-project, multi-agent local research workspace with CLI-first project and agent management.
- Telegram gateway support with pairing, routing, file handling, and bounded progress updates.
- Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- Shared built-in skills for search, paper summarization, grounded QA, figure extraction, block diagrams, and Runpod job workflows.
- Runpod GPU server and job management for bounded remote experiment execution.
- npm-installable `opencolab` CLI package with packaged runtime templates and shared skills.
