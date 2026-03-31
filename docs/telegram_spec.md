# Telegram Progress Streaming Plan

## Goal

Implement Telegram progress streaming for long-running agent work.

The desired Telegram UX is:

1. User sends a request.
2. OpenColab sends one short progress message quickly.
3. OpenColab edits that same progress message as the run advances through meaningful work stages.
4. OpenColab sends a second message with the full final answer when the run completes.

This is not token-by-token final-answer streaming.
For research workflows, progress updates are more useful than a half-written answer.

## Desired User Experience

The progress message should feel like following a live plan, not watching raw model text.

Example progression:

```text
Working on it

1. Planning approach
2. Searching papers
3. Downloading 5 papers
   - Paper 1
   - Paper 2
   - Paper 3
   - Paper 4
   - Paper 5
4. Summarizing papers
5. Drafting final answer
```

Then, in a second Telegram message:

```text
Here is the full answer...
```

Key UX rules:

- Keep one progress message per run.
- Edit it in place instead of sending many small updates.
- Keep progress text short, concrete, and task-shaped.
- Always send the full final answer as a separate second message.
- Do not mix partial progress lines into the final answer text.

## Non-Goals For V1

- No token-by-token preview of the final prose answer.
- No Markdown/HTML-heavy formatting in progress updates.
- No attempt to mirror every internal tool event.
- No change to Telegram polling ownership; the poller stays inbound-only.

## Current State In This Repository

### `src/telegram-poller.ts`

Current role:

- clears webhook
- reads updates with `getUpdates`
- forwards each update to `runtime.handleTelegramWebhook(update)`
- advances offset even when one update fails

This file should remain focused on ingest.
It is not the right place to own streaming UI state.

### `src/gateway.ts`

Current reply flow:

1. parse inbound Telegram message
2. check auth and pairing
3. start typing feedback
4. call `deps.respond(...)`
5. wait for one final string
6. send final text and files
7. stop typing

Current limitation:

- the gateway only knows about one final string
- there is no Telegram `editMessageText` path
- there is no progress-message lifecycle

### `src/provider-agent.ts`

Current provider flow:

- build prompt
- spawn provider CLI
- buffer stdout
- return only after process exit

This is the main blocker.
Telegram progress needs incremental provider output or another live event channel.

## Product Decision

Telegram should stream structured progress, not partial final answer text.

That means the implementation needs two separate outbound channels during a run:

- a progress channel: one Telegram message edited in place
- a final answer channel: one normal Telegram message sent after completion

This matches the kind of work OpenColab does better than raw text preview.
Users care more about seeing "Searching papers", "Downloading 5 papers", and "Summarizing papers" than seeing half a paragraph appear and change.

## Proposed Architecture

### 1. Add a progress event contract

Introduce a structured progress event type that can move from provider execution to Telegram delivery.

Suggested shape:

```ts
export interface AgentProgressEvent {
  phase:
    | "planning"
    | "searching"
    | "downloading"
    | "reading"
    | "summarizing"
    | "drafting"
    | "done"
    | "info";
  message: string;
  items?: string[];
  done?: boolean;
}
```

Provider execution should be able to emit:

- progress events
- final answer text
- optional outbound files

### 2. Add a stream-capable provider interface

The gateway should no longer depend only on `Promise<string>`.

Add a streaming provider contract alongside the current compatibility path.

Suggested direction:

```ts
export interface ProviderAgentStreamCallbacks {
  onProgress?: (event: AgentProgressEvent) => void | Promise<void>;
  onFinalTextChunk?: (chunk: string) => void | Promise<void>;
}

respondStreaming(input, callbacks): Promise<string>
```

Important note:

- the final answer still needs to be accumulated and returned as one final string
- progress updates and final answer text are different concerns
- callers that do not care about streaming should still be able to call `respond(...)`

### 3. Define a provider-to-gateway progress protocol

OpenColab needs a machine-readable way to detect progress updates inside streamed provider output.

The cleanest V1 option is reserved control lines written to stdout:

```text
@telegram-progress {"phase":"planning","message":"Planning approach"}
@telegram-progress {"phase":"searching","message":"Searching papers"}
@telegram-progress {"phase":"downloading","message":"Downloading 5 papers","items":["Paper A","Paper B","Paper C","Paper D","Paper E"]}
@telegram-progress {"phase":"summarizing","message":"Summarizing papers"}
@telegram-progress {"phase":"drafting","message":"Drafting final answer"}
```

Rules:

- each control line must be on its own line
- control lines are stripped from the final assistant answer
- non-control text remains part of the final answer buffer
- malformed control lines are ignored, not fatal

This requires prompt-level guidance so agents know how to emit progress updates when the channel is Telegram.

### 4. Add a Telegram progress message session

Create a helper that owns one in-place edited Telegram progress message.

Suggested responsibilities:

- create the first progress message
- remember the Telegram `message_id`
- render progress state into short readable text
- throttle edits
- ignore no-op edits
- stop updating cleanly on failure
- finalize with a short completed state if desired

For V1, the transport is simple:

- first write: `sendMessage`
- later writes: `editMessageText`

No draft transport is needed.

### 5. Keep final answer delivery separate

When the provider run completes:

1. finalize the progress message
2. send the full assistant answer as a second Telegram message
3. send files after the final text if needed

This separation is intentional.
The progress message answers "what is happening now?"
The final message answers "what did the agent conclude?"

## Gateway Rendering Rules

The progress message should show a compact live checklist.

Rendering rules:

- show ordered steps in the sequence they were first observed
- show only the latest message per phase
- for `items`, show a short list and truncate aggressively
- keep the full progress message well below Telegram's message limit
- edit at a throttled cadence such as every 750ms to 1500ms

Suggested render shape:

```text
Working on it

1. Planning approach
2. Searching papers
3. Downloading 5 papers
   - Attention Is All You Need
   - DINOv2
   - Segment Anything
   - RT-DETR
   - DETR
4. Summarizing papers
```

When the run finishes, either:

- leave the progress message as-is, or
- edit the header to `Completed`

Do not replace it with the full answer.

## Fallback Behavior

The system must degrade cleanly when streaming is imperfect.

Fallback rules:

- if no progress events arrive, keep typing feedback and send the final answer normally
- if provider stdout is buffered and useless until exit, the feature degrades to current behavior
- if the first progress message fails to send, continue the run and still send the final answer
- if a later edit fails, stop progress edits and keep generating
- if progress parsing fails for one line, ignore that line and continue
- conversation memory should store only the final assistant answer, never partial progress lines

## Prompting Contract

Agent prompts should explicitly define how Telegram progress works.

When the channel is Telegram and the task is long-running, the prompt should instruct the agent to emit concise progress control lines before major work stages.

Examples:

- planning
- searching papers
- downloading papers
- reading or inspecting sources
- summarizing
- drafting the final answer

Good progress messages are:

- short
- concrete
- user-meaningful
- free of fluff

Bad progress messages are:

- generic filler like "still working"
- raw chain-of-thought
- verbose tool logs
- repeated low-signal micro-updates

## Concrete Implementation Plan

### Phase 1: Provider streaming foundation

1. Add progress event and stream callback types in `src/types.ts` or `src/provider-agent.ts`.
2. Refactor `ProviderAgent` to expose `respondStreaming(...)`.
3. Surface `stdout` chunks incrementally instead of waiting only for process exit.
4. Keep `respond(...)` as a compatibility wrapper over the new streaming path.

### Phase 2: Progress protocol parsing

1. Add a parser for reserved `@telegram-progress {...}` lines.
2. Strip parsed control lines from the final answer buffer.
3. Ignore malformed control lines without aborting the run.
4. Add tests for mixed stdout containing both control lines and final answer text.

### Phase 3: Telegram progress transport

1. Add Telegram `editMessageText` support.
2. Add a `TelegramProgressSession` helper.
3. Implement:
   - initial send
   - throttled edits
   - truncation rules for long paper lists
   - no-op edit suppression
   - best-effort finalize

### Phase 4: Gateway integration

1. Update `TelegramGateway.handleWebhook()` to use `respondStreaming(...)`.
2. Start typing feedback as today.
3. Create a progress session when the first progress event arrives.
4. Feed progress events into the progress session.
5. Keep accumulating final assistant text separately.
6. On completion, append only the final answer to conversation history.
7. Send the final answer as a second Telegram message.
8. Send outbound files after the final text.

### Phase 5: Prompt integration

1. Update agent prompt assembly in `src/agent.ts` so Telegram runs can emit progress control lines.
2. Keep the contract narrow and explicit.
3. Avoid provider-specific prompt logic unless a provider forces it.

### Phase 6: Concurrency and safety

1. Decide whether one chat may have multiple active runs.
2. For V1, prefer one active run per chat.
3. If a second message arrives while one run is active, either queue it or reject it clearly.
4. Make sure progress edits from two runs cannot target the same Telegram message.

## Recommended File Changes

- `src/types.ts`
  - add progress event and streaming callback types
- `src/provider-agent.ts`
  - add incremental stdout handling and progress parsing hooks
- `src/agent.ts`
  - add Telegram progress protocol instructions to prompt assembly
- `src/gateway.ts`
  - add Telegram progress-session lifecycle and final-answer split delivery
- `src/runtime.ts`
  - thread the new streaming-capable gateway dependency surface
- `src/telegram-poller.ts`
  - likely no core logic change; keep it focused on inbound update handling
- `tests/runtime.test.ts`
  - cover progress session plus final second message behavior
- `tests/telegram-poller.test.ts`
  - confirm polling still advances offsets during streaming-related failures
- new focused tests if needed
  - progress parser
  - Telegram progress session rendering

## Test Plan

Add deterministic tests for:

- provider streaming emits progress events and final answer text
- progress control lines are excluded from the stored final answer
- gateway creates one progress message and edits it multiple times
- gateway sends the final answer as a second message
- file delivery still happens after the final answer
- progress edit failure does not abort the provider run
- no-progress providers fall back to typing plus final answer
- overlapping requests in the same chat do not corrupt progress state

## Risks And Edge Cases

### Provider-side

- some CLIs may buffer all stdout until exit
- chunk boundaries may split lines mid-JSON
- providers may print noise or logs to stdout

### Telegram-side

- `editMessageText` can fail for unchanged text
- long paper lists can exceed practical message size quickly
- high-frequency edits can hit rate limits

### Runtime-side

- progress events must not leak into conversation memory
- progress state must be isolated per run
- final answer must still send even if streaming breaks halfway through

## Implementation Notes

- Start with plain text only.
- Prefer one active progress message per chat.
- Prefer stable, research-shaped phases over clever formatting.
- Before code implementation, sync the final behavior into `docs/spec.md` so the spec matches the intended Telegram UX.

## Bottom Line

The right feature is not "stream the answer into Telegram."

The right feature is:

1. stream meaningful progress into one edited Telegram status message
2. show concrete task steps such as searching, downloading, and summarizing
3. send the full assistant answer as a second normal Telegram message at the end

That gives users a clearer and more trustworthy research workflow UX.

## Interactive Command Interface Plan

## Goal

Improve Telegram project and agent selection so users can choose from clickable buttons instead of typing ids manually.

The first target UX is:

1. User types `/projects`.
2. OpenColab replies with the current project plus a list of project buttons.
3. User taps one project button.
4. OpenColab switches the active project and confirms the selection.

And similarly:

1. User types `/agents`.
2. OpenColab replies with the current active project plus a list of agent buttons.
3. User taps one agent button.
4. OpenColab switches the active agent and confirms the selection.

This should reduce typing friction and make Telegram control feel more like a real interface instead of a raw command shell.

## Desired User Experience

Example `/projects` response:

```text
Projects
Current: alpha
Tap a project to switch.
```

With inline buttons:

```text
[alpha] [beta]
[gamma] [delta]
[Cancel]
```

Example `/agents` response:

```text
Agents in alpha
Current: professor
Tap an agent to switch.
```

With inline buttons:

```text
[professor] [scout]
[planner] [reviewer]
[Cancel]
```

Key UX rules:

- Use inline keyboards, not reply keyboards.
- Keep the selection flow to one command and one tap whenever possible.
- Confirm the new active project or agent after selection.
- Preserve the current text-command flow as a fallback.
- Do not require users to type ids when they are choosing from an existing list.
- Keep creation text-based for now: `/project create <id>` and `/agent create <id>`.

## Non-Goals For V1

- No button-based project or agent creation flow.
- No free-text modal input flow inside Telegram.
- No deep multi-step wizard for provider setup or configuration.
- No redesign of normal agent-response messaging.
- No attempt to support every Telegram UI primitive at once.

## Product Decision

OpenColab should support both:

- text management commands, for scripting and power users
- button-driven selection commands, for faster Telegram interaction

The button-driven commands should be the primary Telegram UX for choosing existing projects and agents.

Recommended commands:

- `/projects` for interactive project selection
- `/agents` for interactive agent selection

Backward-compatible commands should remain supported:

- `/project list`
- `/project use <project_id>`
- `/agent list`
- `/agent use <agent_id>`

## Current State In This Repository

Current Telegram management is text-only:

- `src/gateway.ts` parses only inbound `message` and `edited_message`
- `src/gateway.ts` management handling is based on slash-command text tokens
- `src/gateway.ts` outbound Telegram delivery supports plain text and files
- `src/types.ts` does not model Telegram `callback_query`
- `src/cli.ts` syncs slash-menu commands with `setMyCommands`, but not button flows

This means button-based selection is not a rendering tweak.
It requires explicit callback-query support in the Telegram gateway.

## Proposed Architecture

### 1. Add button-first selection commands

Introduce two new Telegram commands:

- `/projects`
- `/agents`

Behavior:

- `/projects` renders the project picker
- `/agents` renders the agent picker for the active project

The older `/project ...` and `/agent ...` commands stay valid.

### 2. Add inbound callback-query support

Extend the Telegram inbound model so the gateway can parse button taps.

The gateway needs to understand:

- callback query id
- callback query data
- source chat id
- source message id
- tapping user identity

Without this, Telegram button presses cannot be routed back into project or agent selection logic.

### 3. Add outbound inline-keyboard support

Extend Telegram sending helpers so OpenColab can send:

- `sendMessage` with `reply_markup.inline_keyboard`
- `editMessageText` for updating selection messages when useful
- `answerCallbackQuery` so Telegram acknowledges button taps cleanly

V1 does not need a general UI framework.
It only needs enough support to send a message with buttons and handle the result.

### 4. Reuse existing selection logic

Do not create separate project-selection and agent-selection state machines just for buttons.

Instead:

- keep one source of truth for project switching
- keep one source of truth for agent switching
- have both text commands and callback actions call the same internal selection helpers

This reduces drift between button behavior and text-command behavior.

### 5. Keep callback actions stateless and compact

Use compact callback payloads such as:

```text
prj:use:alpha
agt:use:scout
prj:page:2
agt:page:1
ui:cancel
```

Rules:

- callback data must stay below Telegram size limits
- callback data should be parseable without server-side UI session state
- server-side state should only be introduced if pagination later requires it

### 6. Add pagination only when needed

If project or agent counts are small, show all options in one keyboard.

If the list gets too large:

- add `Prev` and `Next` buttons
- keep the current selection visible
- preserve stable sort order

Pagination should be an implementation detail, not a new command family.

### 7. Confirm selection clearly

After a successful tap:

- answer the callback query
- switch the active project or agent
- send or edit a short confirmation such as:
  - `Active project: alpha`
  - `Active agent: scout (project alpha)`

The user should never have to guess whether the tap succeeded.

## Command Surface Recommendation

Recommended Telegram command surface after the change:

- `/projects` -> interactive project picker
- `/agents` -> interactive agent picker
- `/project create <project_id>`
- `/agent create <agent_id>`
- `/session reset`

Backward compatibility:

- keep `/project list`, `/project use <project_id>`
- keep `/agent list`, `/agent use <agent_id>`
- keep the current slash-menu aliases until the new commands are fully adopted

## Concrete Implementation Plan

### Phase 1: Spec and command design

1. Add the new Telegram UX contract to `docs/spec.md`.
2. Define the canonical commands as `/projects` and `/agents`.
3. Decide the callback-data format and button layout rules.
4. Decide whether selection responses should edit the picker message, send a new confirmation, or both.

### Phase 2: Telegram transport foundation

1. Extend inbound Telegram parsing to support `callback_query`.
2. Extend outbound Telegram helpers to support inline keyboards.
3. Add `answerCallbackQuery`.
4. Add optional `editMessageText` support for button flows.

### Phase 3: Gateway command integration

1. Add `/projects` and `/agents` command handlers in `src/gateway.ts`.
2. Add project-picker rendering.
3. Add agent-picker rendering scoped to the active project.
4. Route callback actions back into the existing project and agent selection logic.
5. Keep text commands fully working.

### Phase 4: Telegram command sync

1. Update `src/cli.ts` command sync to register `/projects` and `/agents`.
2. Keep old aliases during the transition period.
3. Make the new interactive commands the primary surfaced UX in Telegram menus.

### Phase 5: UX refinement

1. Add cancel buttons.
2. Add pagination only if needed.
3. Improve confirmation copy.
4. Decide when editing the original picker message is better than sending a second message.

## Recommended File Changes

- `docs/spec.md`
  - add the Telegram interactive command contract
- `README.md`
  - document the new Telegram picker commands
- `src/types.ts`
  - add Telegram callback-query and keyboard-related types
- `src/gateway.ts`
  - add `/projects` and `/agents` handlers
  - add callback-query routing
  - add picker rendering and selection handling
- `src/cli.ts`
  - add synced Telegram commands for the new picker UX
- `tests/runtime.test.ts`
  - cover picker command and callback behavior
- optional focused gateway tests
  - callback parsing
  - keyboard rendering
  - pagination behavior

## Test Plan

Add deterministic tests for:

- `/projects` returns a project picker instead of only plain text
- tapping a project button switches the active project
- `/agents` returns only agents from the active project
- tapping an agent button switches the active agent
- unauthorized callback queries are rejected
- unpaired callback queries are rejected
- old text commands still work after the new picker flow lands
- large project or agent lists paginate correctly if pagination is enabled
- invalid or stale callback payloads fail cleanly

## Risks And Edge Cases

### Telegram-side

- callback queries must be answered promptly or Telegram shows a stuck spinner
- inline keyboards add a new payload shape that current code does not parse
- message edits can fail if the content is unchanged
- callback data has strict size limits

### Runtime-side

- button taps must not bypass authorization or pairing checks
- project and agent selection logic must not diverge between text and button paths
- concurrent button taps should not leave the runtime in an ambiguous state

### UX-side

- overly large keyboards become hard to use
- mixing old and new commands can confuse users if naming is inconsistent
- button labels should stay short and unambiguous

## Implementation Notes

- Start with selection only, not creation.
- Prefer inline keyboards over reply keyboards.
- Prefer stateless callback payloads.
- Reuse existing project and agent switching logic rather than duplicating it.
- Before code implementation, sync the accepted behavior into `docs/spec.md` so the main spec stays authoritative.

## Bottom Line

The right Telegram improvement is not just "show a text list of projects and agents."

The right improvement is:

1. `/projects` opens a clickable project picker
2. `/agents` opens a clickable agent picker
3. taps route through callback queries
4. the gateway reuses the existing selection logic
5. old text commands remain available as fallback

That gives Telegram a much faster and more legible command interface without turning it into a separate product surface.
