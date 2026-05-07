# Telegram Live Status Plan

## Goal

Replace the current prompt-driven Telegram progress path with an OpenColab-native live status system.

The target UX is:

1. User sends a request in Telegram.
2. OpenColab acknowledges quickly.
3. OpenColab shows one bounded live status surface while the run is active.
4. OpenColab sends one separate final answer when the run completes.

This is not token-by-token answer streaming.
The user should see useful status, not every internal action.

## Product Decision

OpenColab should own Telegram live status.
Agents should not be responsible for remembering a Telegram-specific progress protocol.

The primary transport should be `sendMessageDraft`.
The fallback transport should be one editable message using `sendMessage` plus `editMessageText`.

Final answer delivery remains separate from live status:

- live status answers: "what is happening now?"
- final answer answers: "what did the agent conclude?"

## Telegram Capability Notes

Relevant Telegram Bot API changes:

- Bot API 9.3 on December 31, 2025 added `sendMessageDraft`, allowing partial messages to be streamed while generation is in progress
- Bot API 9.5 on March 1, 2026 allowed all bots to use `sendMessageDraft`
- `editMessageText` remains the universal fallback for bot-authored messages
- `sendChecklist` and `editMessageChecklist` are not the default path because they require a connected business account
- `sendChatAction` remains only a short-lived hint and is not a real live status surface

## Current Problems In This Repository

### 1. Progress is still prompt-driven

Today, routed provider runs inject `OPENCOLAB_PROGRESS_FILE` and depend on the agent to append JSON lines.

That causes the exact failure mode seen in practice:

- weaker agents forget the contract
- progress quality varies by provider
- the runtime cannot guarantee bounded UX

### 2. Telegram transport is still message-spam oriented

Today, progress events are sent as fresh Telegram messages instead of being rendered as one owned status surface.

That creates unnecessary chat noise.

### 3. Provider integrations are not using native event streams

Current provider execution still centers on "spawn CLI, buffer stdout, return one final string".

That is the wrong abstraction for live status.

## Desired User Experience

The live surface should feel like a compact status card, not a transcript.

Example:

```text
Agent activity

⚪ Inspecting the project.
⚪ Reviewing the current Telegram flow.
⚪ Comparing Telegram API options.
🟢 Writing the integration plan.
```

Then, after completion, a second normal message:

```text
Here is the full answer...
```

UX rules:

- keep one live surface per run
- do not show every shell command or every tool call
- do not stream half-written final prose
- keep final answer separate
- keep conversation memory limited to the user turn and final assistant answer

## Transport Strategy

### Primary: `sendMessageDraft`

Use `sendMessageDraft` by default for paired one-to-one Telegram chats.

Why:

- it is the newest Telegram-native primitive for partial live text
- it maps directly to the "single live status surface" idea
- it avoids sending many separate chat messages

### Secondary: editable status message

Use `sendMessage` plus `editMessageText` when:

- the chat is not eligible for draft mode
- draft behavior is unavailable or unreliable in the current client context
- draft sending fails for the current run

### Last resort fallback

If both live-status transports fail:

- keep `sendChatAction` as short-lived fallback feedback
- still deliver the final answer normally

## Scope Rules

This live status design applies to routed Telegram runs for:

- Codex
- Claude Code
- Gemini CLI
- Pi

It should also work for OpenColab-owned long-running workflows such as search, Runpod, downloads, and other built-in operations.

## Core Architecture

### 1. Provider-native event adapters

OpenColab should consume machine-readable runtime events from each provider instead of asking the agent to print Telegram progress.

Initial adapter targets:

- Codex: `codex exec --json`
- Claude Code: `claude -p --output-format stream-json`
- Gemini CLI: `gemini --output-format stream-json`
- Pi: `--mode json`

Possible later upgrades:

- Gemini ACP mode
- Pi RPC mode

These richer modes may be useful later, but they are not required for the first native rollout.

### 2. One OpenColab status model

Provider-specific events should be normalized into a provider-agnostic internal model.

Suggested event categories:

- `ack`
- `phase_change`
- `counter_update`
- `warning`
- `needs_input`
- `finalizing`
- `done`

Suggested user-facing phases:

- inspecting workspace
- reading context
- searching or retrieving
- editing files
- running checks
- waiting for input
- preparing final answer

This model should not expose raw provider events directly to Telegram.

### 3. Status compression layer

OpenColab should compress low-level runtime activity into bounded user-facing updates.

Compression rules:

- merge repeated low-signal tool activity into the current phase
- emit updates on meaningful phase changes
- emit counter updates only when the delta is meaningful
- let warnings and blockers bypass normal throttling
- keep one stable message body instead of narrating everything

OpenColab should decide what is worth showing.
The agent should not decide Telegram rendering.

### 4. Telegram live status session

Add a dedicated Telegram live-status session abstraction with ownership of:

- transport selection for the run
- first acknowledgment
- current live text
- throttling
- no-op suppression
- failure downgrade
- finalization

Suggested transport order:

1. `sendMessageDraft`
2. `sendMessage` plus `editMessageText`
3. `sendChatAction` only

## Rendering Rules

The live surface should remain short and stable.

Rendering rules:

- plain text only in v1
- one short heading plus a few current lines
- do not include raw JSON, tool names, or stack traces
- do not list every file touched
- truncate aggressively when lists grow
- prefer replacing the current body instead of appending indefinitely

Good examples:

- `Reviewing the current Telegram gateway flow`
- `Comparing Telegram draft mode with editable-message fallback`
- `Running validation checks`
- `Waiting for your confirmation before continuing`

Bad examples:

- `Running rg, then sed, then cat, then another rg`
- `Thinking...`
- partial final prose
- internal chain-of-thought

## Gateway Lifecycle

For a routed Telegram run:

1. accept and validate the inbound message
2. start short-lived typing feedback immediately
3. create a live-status session
4. consume provider-native runtime events
5. normalize and compress them into OpenColab status events
6. render those events through the live-status session
7. accumulate the final answer separately
8. stop live status when the run finishes or fails
9. send the final answer as a normal Telegram message
10. send files after the final answer when needed

Important rules:

- final answer must remain a distinct message
- operational status must not be appended to conversation memory
- timeout recovery may mention the last meaningful status, but not replay the whole stream

## Removal Plan For The Current Streaming Implementation

The current implementation should be removed for normal routed Telegram agent runs once the native path is ready.

Remove or stop relying on:

- prompt instructions that tell agents to append JSON progress to `OPENCOLAB_PROGRESS_FILE`
- default injection of `OPENCOLAB_PROGRESS_FILE` for generic Telegram provider streaming
- polling a JSONL file as the primary provider-to-gateway progress transport
- tests that expect one fresh Telegram message per progress event
- any Telegram-specific prompt contract such as reserved progress control lines

What should remain:

- the general OpenColab concept of bounded operational progress
- OpenColab-owned progress for internal workflows
- a separate timeout-recovery summary path

In other words:

- keep the product behavior
- replace the transport and ownership model

## Phased Implementation Plan

### Phase 1: spec and architecture lock

1. Update the Telegram plan and the main spec so OpenColab-native status becomes the official design.
2. Explicitly mark prompt/file-driven Telegram progress as legacy.
3. Define the internal normalized event model and Telegram transport-selection rules.

### Phase 2: provider-native streaming foundation

1. Add a stream-capable provider interface alongside the current `respond(...)` shape.
2. Implement native event adapters for Codex, Claude Code, Gemini CLI, and Pi.
3. Keep a compatibility wrapper during migration so non-Telegram callers do not break immediately.

### Phase 3: status normalization and compression

1. Add the provider-agnostic OpenColab status model.
2. Map provider-native events into bounded phases and counters.
3. Add throttling and no-op suppression before anything reaches Telegram.

### Phase 4: Telegram transport layer

1. Add `sendMessageDraft` support.
2. Add editable-message fallback support with `editMessageText`.
3. Add one `TelegramLiveStatusSession` abstraction that chooses the transport and manages the run.
4. Keep `sendChatAction` only as a startup or failure fallback.

### Phase 5: gateway integration

1. Update the gateway to drive live status from normalized runtime events.
2. Keep final answer accumulation separate from the live surface.
3. Make sure files are still delivered after the final message.
4. Ensure the normal conversation log stores only the final answer.

### Phase 6: legacy path removal

1. Remove progress-file injection from normal Telegram provider runs.
2. Remove prompt guidance that asks agents to emit Telegram progress.
3. Remove the JSONL file relay as the default Telegram progress path.
4. Rewrite tests to validate the new OpenColab-owned transport behavior.

### Phase 7: rollout and guardrails

1. Prefer one active run per chat in the initial rollout.
2. If a second run arrives, queue it or reject it clearly.
3. Add fallback downgrades when draft mode or message editing fails.
4. Keep telemetry for transport failures so rollout quality can be judged quickly.

## Recommended File Changes

- `docs/spec.md`
  - make OpenColab-native live status the authoritative design
- `docs/telegram_spec.md`
  - keep this implementation-focused plan aligned with the main spec
- `src/provider-agent.ts`
  - move from progress-file relay to native stream adapters
- `src/provider.ts`
  - declare which runtime mode each provider adapter should use
- `src/gateway.ts`
  - add Telegram live-status session lifecycle and final-answer split delivery
- `src/types.ts`
  - add normalized runtime event and live-status types
- `src/agent.ts`
  - remove Telegram progress-writing guidance once migration completes
- `tests/runtime.test.ts`
  - replace message-per-progress expectations with live-session expectations
- focused Telegram transport tests
  - draft mode
  - editable fallback
  - failure downgrade

## Test Plan

Add deterministic coverage for:

- Codex native event streaming drives OpenColab status correctly
- Claude Code native event streaming drives OpenColab status correctly
- Gemini CLI native event streaming drives OpenColab status correctly
- Pi native event streaming drives OpenColab status correctly
- draft mode is used when eligible
- editable-message fallback is used when draft mode is unavailable or fails
- live status never pollutes conversation memory
- final answer still sends if live status breaks mid-run
- file delivery still happens after the final answer
- overlapping runs in one chat do not corrupt each other

## Risks And Open Questions

### Telegram-side

- `sendMessageDraft` is new and needs client-behavior validation in real chats
- draft mode is private-chat oriented and should not be assumed universal
- finalization semantics must be validated so the final `sendMessage` does not leave a stale draft surface behind

### Provider-side

- native event schemas differ across runtimes
- some runtimes may expose more tool detail than should reach the user
- some runtimes may still require a thin compatibility layer during migration

### Product-side

- too much status detail will still feel noisy even with a better transport
- too little status detail will feel dead
- status compression rules need to be strict enough that Telegram feels intentional

## Bottom Line

The right Telegram feature is not "teach every agent to stream progress correctly."

The right feature is:

1. OpenColab reads native runtime events from Codex, Claude Code, Gemini CLI, and Pi
2. OpenColab compresses them into a small user-facing status model
3. Telegram renders that model through `sendMessageDraft` by default
4. `editMessageText` remains the fallback
5. the final answer remains a separate normal message
6. the current prompt/file-based streaming implementation is removed for normal Telegram runs

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
