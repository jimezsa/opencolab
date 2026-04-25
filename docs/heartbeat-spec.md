# OpenColab Heartbeat Plan

## 1. Status

This document is a planning note for a minimal heartbeat v1.

It is intentionally narrow.
It is not yet a normative runtime contract until promoted into `docs/spec.md`, `README.md`, and implementation.

Sections 1-11 describe the minimal heartbeat scheduling behavior.
Section 12 describes the minimal digest notification extension.
Section 13 describes a proposed live Telegram status extension for heartbeat wake-ups.
Section 14 describes a proposed configurable wake-up message extension.

## 2. Goal

Heartbeat should be a delayed follow-up for the active agent, not a general scheduler.

After an agent run ends in one of these states:

- completed
- stopped by the user
- timed out by the provider CLI

OpenColab may schedule one later wake-up for that same active agent.

When the wake-up fires, the runtime should start one internal turn for that agent with the prompt:

```text
continue
```

That is the whole feature.

## 3. Scope

V1 supports only:

- one human-edited file at `projects/<project_id>/AGENTS/<agent_id>/HEARTBEAT.md`
- an empty `HEARTBEAT.md` seeded when an agent is created
- only the current active agent may arm or receive an automatic wake-up
- disabled-by-default behavior that activates only after explicit user setup
- one pending wake-up per project
- one fixed internal prompt: `continue`

V1 does not support:

- multiple pending wake-ups per project
- periodic multi-agent scanning
- cron syntax
- custom heartbeat prompts
- retries or backoff
- live heartbeat status surfaces

## 4. `HEARTBEAT.md` Contract

`HEARTBEAT.md` is human-edited.
OpenColab should create this file as an empty stub when the agent is created.
There is no default heartbeat time in v1.
This feature must stay off until the user explicitly enables it.

The runtime reads only one setting:

- `after: <duration>`

Example:

```md
# HEARTBEAT.md

after: 30m
```

Rules:

- ignore blank lines
- ignore comment lines that start with `#`
- read the first valid `after:` line
- if no valid `after:` line exists, heartbeat is disabled, including the seeded empty file
- if `HEARTBEAT.md` is missing on older or manually edited agents, heartbeat is disabled
- OpenColab must not auto-fill a default `after:` value

Supported v1 duration format should stay small:

- `15m`
- `30m`
- `1h`
- `2h`

Any other text in the file is ignored by the runtime in v1.

## 5. Scheduling Rule

This is not a wall-clock scheduler.
It is a one-shot delay that is armed by a terminal event for the active agent.

Rules:

- only the project's active agent can be auto-woken
- a qualifying completion, stop, or timeout may arm a wake-up only for the same agent that just finished
- a later qualifying run from a different active agent replaces any older pending wake-up for the project
- if the project's active agent selection changes before the wake-up fires, clear the pending wake-up
- a heartbeat-triggered run can arm the next heartbeat again when it finishes

## 6. Runtime State

V1 should store one tiny runtime-owned record per project:

- `agent_id`
- `wake_at`

This should reuse existing runtime state in `.opencolab/opencolab.json` rather than introducing a separate heartbeat file.
The runtime already knows the default project and current active agent there, so heartbeat should extend that existing per-project state with one pending wake-up record.

This state exists only to answer:

- which agent should receive the next `continue` turn
- when that turn should fire

V1 does not need:

- per-agent heartbeat state
- heartbeat history
- retry counters

## 7. Runtime Flow

Minimal flow:

1. The active agent's run ends as `completed`, `stopped`, or `timed_out`.
2. The runtime reads `projects/<project_id>/AGENTS/<agent_id>/HEARTBEAT.md` for that same agent.
3. If heartbeat is disabled, clear any pending wake-up and stop.
4. Store or replace the pending wake-up with `{ agent_id, wake_at = now + after }`.
5. If that same agent starts any turn before the wake-up fires, clear the pending wake-up. That turn can arm the next one when it ends.
6. If the project active-agent selection changes away from the pending `agent_id`, clear the pending wake-up.
7. A small background check, such as once per minute, looks for a due pending wake-up.
8. When `wake_at <= now`, the pending `agent_id` is still the active agent, and that agent is idle, start one internal turn for that agent with the prompt `continue`.
9. Clear the pending wake-up when that turn starts.
10. If the pending agent is busy when the wake-up becomes due, keep the pending wake-up and try again on the next check.

Important simplification:

- V1 assumes one normal OpenColab background process owns this small check loop

## 8. Turn Semantics

The automatic wake-up is an internal runtime-triggered turn.

It is not:

- a Telegram webhook
- a human chat message
- a special rich heartbeat payload

The injected prompt should stay minimal:

- `continue`

V1 should reuse existing normal runtime/session behavior where possible.
No special heartbeat transcript format is required for this plan.
Existing stop or timeout recovery summaries can continue to provide the context that the agent sees on the next turn.

## 9. Notification Rule

V1 should stay quiet by default.

That means:

- no automatic Telegram message just because the wake-up was scheduled
- no routine "heartbeat ran" message
- no new notification policy in this document

The wake-up is for internal follow-through, not background chatter.

## 10. Minimal Implementation Plan

1. Allow `HEARTBEAT.md` for any agent.
2. Seed an empty `HEARTBEAT.md` when an agent is created.
3. Keep heartbeat disabled by default. Do not set any default schedule automatically.
4. Enable heartbeat only when the user explicitly edits `HEARTBEAT.md` with a valid `after:` value.
5. Parse one `after:` duration from that file.
6. Store one pending `{ agent_id, wake_at }` record per project.
7. When the active agent completes, is stopped by the user, or hits CLI timeout, arm or replace the pending wake-up for that same agent.
8. Clear the pending wake-up if the active agent changes or the target agent starts another turn before the wake-up fires.
9. When the wake-up is due and the same agent is still active and idle, run one internal `continue` turn for that agent.
10. Keep everything else out of v1.

## 11. Non-Goals

This document does not try to define:

- general workflow automation
- simultaneous heartbeats for multiple agents
- background scans across all agents
- custom prompts per agent
- autonomous agent-to-agent chatter
- rich scheduler state or analytics
- broader behavior changes outside this heartbeat note

## 12. Minimal Telegram Digest Feedback for Heartbeat

This section records the minimal follow-up idea that keeps heartbeat quiet by default and, when explicitly enabled, sends one compact final Telegram digest.

It is still non-normative until promoted into `docs/spec.md`, `README.md`, and implementation.
The goal is to add just enough feedback to avoid silent background completions without turning heartbeat into a second full Telegram workflow.

### 12.1 Goal

When a heartbeat wake-up finishes meaningful work, OpenColab should be able to send one compact Telegram follow-up instead of staying completely silent.

That means:

- keep scheduling and wake-up firing quiet
- avoid routine "heartbeat started" chatter
- avoid live progress surfaces for background runs
- send at most one bounded completion notice when the user explicitly opts in

### 12.2 Proposed User Controls

The follow-up should extend `HEARTBEAT.md` with one additional optional setting:

- `notify: quiet | digest`

Planned behavior:

- `quiet`: preserve current silent behavior after the heartbeat turn finishes
- `digest`: send one compact completion or blocker summary after the background turn finishes

Important compatibility rule:

- if `notify:` is omitted, keep heartbeat behavior unchanged and silent

Example:

```md
# HEARTBEAT.md

after: 30m
notify: digest
```

The runtime should continue to ignore unknown lines so this remains human-editable and forward-compatible.

### 12.3 Minimal Delivery Scope

The first implementation should stay intentionally narrow.

It should:

- keep the heartbeat turn as an internal `continue` turn
- reuse the existing plain Telegram text send path for the final digest message
- avoid live status, progress cards, and editable status surfaces for heartbeat
- avoid introducing per-agent lane tracking in the first cut
- avoid broad new state unless it is strictly required for safe delivery

This is a deliberately smaller target than the broader lane-aware design.
The intended target is the one shared paired Telegram chat that OpenColab already knows about, not a remembered per-agent lane.

### 12.4 Delivery Rules

Notification policy in `notify: digest` mode:

- always notify on `failed`
- always notify on `timed_out`
- always notify on clear human-input blockers
- notify on `completed` only when the run produced meaningful output
- do not send a message just because the wake-up was armed
- do not send a message just because the wake-up fired

Meaningful output should mean at least one of:

- non-trivial assistant text
- a clear state-change summary such as "I finished the draft review and updated TODO.md"

No-op or near-empty `continue` turns should stay quiet even in `digest` mode.

### 12.5 Safety Rules

The minimal implementation should prefer silence over risky delivery.

For this minimal plan, "safe delivery target" means the exact Telegram chat currently configured and paired in OpenColab.

Rules:

- if no paired Telegram chat is configured, skip notification
- if the paired chat is a private chat, send the heartbeat digest there
- if the paired chat is a group or supergroup where the Telegram bot is already included, send the heartbeat digest to that same group chat
- do not guess a different chat, fallback chat, or per-agent destination
- do not guess a Telegram topic or thread for background delivery
- if topic-specific routing would be required to land in the intended place, skip notification in the first cut
- do not add per-agent lane tracking or group-topic routing logic in the first cut

This means the first implementation should be treated as paired-chat-first, not private-chat-only.
Private chats and plain group chats are in scope.
Topic-aware group delivery remains out of scope until a later lane-aware design is introduced.

### 12.6 Digest UX

`notify: digest` should send a single compact text message.

The digest should stay short:

- first line identifies the agent
- one short line says this was a heartbeat follow-up
- one concise result or blocker summary

Examples:

```text
professor

Heartbeat follow-up completed.
I finished the comparison notes for the two papers and updated the project TODO with the next experiment.
```

```text
professor

Heartbeat follow-up needs input.
Runpod capacity is still unavailable for A100 80GB in the requested region. Confirm whether I should retry with the backup location.
```

### 12.7 Explicit Non-Goals for the Minimal Version

The minimal heartbeat notification follow-up should not try to include:

- live heartbeat status updates
- progress-event streaming during background runs
- per-agent Telegram lane persistence
- topic or thread preservation in group chats
- guessing which group topic should receive a background heartbeat digest
- file delivery changes
- a new background notification scheduler beyond the existing heartbeat trigger

These may be revisited later, but they should not block the first intervention.

### 12.8 Incremental Implementation Plan

1. Extend the planning docs and later the normative spec to define the minimal heartbeat notification behavior.
2. Parse `notify:` from `HEARTBEAT.md` while preserving backward compatibility with the current `after:`-only file.
3. Keep `notify:` omitted as fully silent behavior.
4. Add one bounded heartbeat digest send path that reuses existing Telegram text delivery.
5. Deliver failures, timeouts, and clear human-input blockers first.
6. Add successful completion digests only for meaningful non-trivial outputs.
7. Support delivery to the exact paired private chat or paired group chat, but skip risky topic-specific delivery in the first cut instead of inventing lane-tracking state.
8. Add tests for quiet-mode suppression, digest-mode success delivery, failure delivery, and missing-target safety behavior.

## 13. Follow-Up Plan: Live Telegram Status for Heartbeat

This section is the next proposed behavior change.
It supersedes the earlier "avoid live status" limitation only when the user explicitly opts in.

It is still non-normative until promoted into `docs/spec.md`, `README.md`, tests, and implementation.
The goal is to let a user see what a heartbeat-woken agent is doing in Telegram by reusing the existing OpenColab live-status implementation instead of adding a second progress system.
If the configurable wake-up message extension in Section 14 is implemented, live status should work the same way for the resolved configured message as it does for the default `continue` message.

### 13.1 Goal

When a heartbeat wake-up starts an internal turn, OpenColab should be able to show the same bounded live status surface used for routed Telegram turns.

That means:

- keep heartbeat disabled by default
- keep scheduling and wake-up arming quiet
- create no generic "heartbeat started" placeholder
- create a live status surface only after the first meaningful provider progress event
- reuse the current Telegram draft/editable-message live status renderer
- keep final digest behavior separate from the live status surface
- avoid copying operational progress events into normal conversation memory

### 13.2 Proposed User Controls

Extend `HEARTBEAT.md` with one additional notification mode:

- `notify: quiet | digest | live`

Planned behavior:

- `quiet`: preserve fully silent behavior
- `digest`: send one compact final completion, blocker, timeout, or failure summary after the heartbeat turn finishes
- `live`: stream bounded live status during the heartbeat turn, then optionally send the same compact final digest when the outcome is meaningful

Compatibility rules:

- if `notify:` is omitted, keep heartbeat silent
- existing `notify: digest` behavior remains final-only
- `notify: live` is the only mode that may create a live status surface

Example:

```md
# HEARTBEAT.md

after: 30m
notify: live
```

The runtime should continue to ignore unknown lines so the file remains human-editable and forward-compatible.

### 13.3 Delivery Target

Heartbeat currently knows the paired Telegram `chatId`, but not enough context to fully reuse the live-status transport in every chat shape.
Live heartbeat status should therefore persist the last safe Telegram target metadata from authorized inbound Telegram activity.

Recommended shared Telegram state additions:

- last paired chat type, such as `private`, `group`, or `supergroup`
- last message thread id when the paired chat uses Telegram topics
- last interaction timestamp for diagnostics and future policy decisions

Rules:

- use only the configured paired chat id
- do not guess a different chat
- in private chats, use the same draft-first behavior as routed Telegram turns
- in groups and supergroups, use the same editable-message behavior as routed Telegram turns
- if a recent message thread id is known, preserve it for status and final digest delivery
- if no chat type is known, fall back conservatively to editable-message status in the paired chat
- if Telegram delivery fails, keep the heartbeat run and conversation memory behavior intact

This avoids treating heartbeat as a webhook while still giving the live-status renderer enough target context to behave like the normal Telegram path.

### 13.4 Runtime Flow

`notify: live` should keep the heartbeat turn as an internal runtime-triggered turn.
It should not fabricate a Telegram webhook or route through management-command parsing.

Planned flow:

1. A pending heartbeat wake-up becomes due.
2. The runtime confirms the target agent is still active and idle.
3. The runtime resolves the wake-up message, defaulting to `continue` unless Section 14's configured message is present.
4. The runtime clears the pending wake-up and starts the internal wake-up turn with the resolved message.
5. If `notify: live` is enabled and Telegram is paired, the runtime asks the gateway to open a heartbeat live-status session for the paired Telegram target.
6. Provider progress events are fanned out to both:
   - heartbeat progress state for final digest and recovery summaries
   - the gateway live-status session for Telegram rendering
7. The live-status session creates its Telegram surface only after meaningful provider progress exists.
8. The live-status session closes before any final digest text is sent.
9. The heartbeat turn appends normal user and assistant conversation entries, using the resolved wake-up message as the user turn.
10. The runtime records the heartbeat outcome and arms the next wake-up when eligible.

### 13.5 Gateway Reuse

The implementation should reuse the current live-status machinery rather than creating a heartbeat-specific renderer.

Recommended shape:

- extract or expose a small gateway helper that creates a `TelegramLiveStatusSession` for a supplied target
- return an `onProgress` function that accepts normal `TaskProgressEvent` values
- return a `close` function that drains the same internal queue used by routed Telegram turns
- keep the existing status throttling, line limits, headings, `🟢` current-line marker, and `⚪` older-line marker
- keep private-chat draft preference and group editable-message behavior unchanged

The provider adapter should continue to emit the existing normalized progress events.
Heartbeat must not ask agents to print a Telegram-specific progress protocol.

### 13.6 Stop Behavior

Once heartbeat progress is visible in Telegram, `/stop` should be able to cancel it.

Recommended behavior:

- register a live heartbeat run in the gateway's active request tracking for the paired chat lane
- give the heartbeat provider call an abort signal
- when `/stop` arrives in that lane, close the live status, abort the provider call, append a compact recovery entry, and record the heartbeat outcome as `stopped`
- send the existing stopped-task confirmation text
- avoid sending a final digest after an explicit stop unless a later product decision asks for it

If stop support proves too large for the first live-status patch, it may be split into a second patch, but the first patch should not make `/stop` misleading.

### 13.7 Conversation Memory Rules

Live heartbeat status remains operational metadata.

Rules:

- do not append live status lines as assistant conversation messages
- keep the internal user turn as the resolved wake-up message, defaulting to `continue`
- keep the final assistant response in normal conversation memory
- on timeout or failure, append the same compact recovery entry style used by heartbeat today, preferably including the last meaningful progress message
- do not include transport-only Telegram labels in conversation memory

### 13.8 Digest Interaction

`notify: live` may still send a final digest, but the digest should remain compact.

Rules:

- live status answers "what is happening now"
- digest answers "what happened"
- the digest should be sent after live status closes
- no-op or near-empty heartbeat responses should not send a completion digest
- failures, timeouts, and clear human-input blockers should still notify when Telegram delivery is available

This keeps the live surface useful during execution without turning the final message into a progress transcript.

### 13.9 Safety Rules

The live heartbeat implementation should prefer silence over risky or confusing delivery.

Rules:

- do nothing if no paired Telegram chat is configured
- do nothing if the bot is not paired
- do not create a status surface before meaningful provider progress exists
- do not send repeated routine heartbeat-started messages
- do not invent per-agent Telegram destinations
- do not create a second progress event model
- do not make heartbeat scheduling depend on Telegram delivery success
- if live status delivery fails, continue the heartbeat run and still allow final digest delivery if configured and safe

### 13.10 Incremental Implementation Plan

1. Promote the `notify: live` behavior into `docs/spec.md`, then sync `README.md`, `AGENTS.md`, tests, and code in the implementation change.
2. Extend `HEARTBEAT.md` parsing to accept `notify: live` while preserving omitted `notify:` as quiet.
3. Persist last authorized Telegram target metadata needed for live status: chat type, optional message thread id, and timestamp.
4. Refactor the gateway live-status session into a reusable helper that can be opened for routed Telegram turns and heartbeat turns.
5. Wire `runHeartbeatTurn` to open that helper only for `notify: live` and paired Telegram state.
6. Fan out provider progress to both heartbeat progress recording and the live-status helper.
7. Close and drain the live-status helper before final digest delivery or recovery handling.
8. Add `/stop` support for visible heartbeat runs through the same active-request lane where practical.
9. Add tests for quiet mode, digest-only mode, live status creation/editing, no-placeholder behavior, private-chat draft use, group editable-message use, topic preservation, memory cleanliness, delivery failure tolerance, and stop behavior.

## 14. Follow-Up Plan: Configurable Wake-Up Message

This section is a proposed extension to the original fixed `continue` prompt.
It is still non-normative until promoted into `docs/spec.md`, `README.md`, tests, and implementation.

The goal is to let the human configure what the agent receives when heartbeat wakes it, while keeping `continue` as the backward-compatible default.

### 14.1 Goal

The heartbeat wake-up should be able to send a human-configured message to the agent instead of always sending exactly:

```text
continue
```

This is useful when the user wants the wake-up to focus on a specific kind of follow-through, such as checking an experiment, revisiting a TODO, or continuing only a particular research thread.

The configured message should stay simple:

- it is plain text
- it is read from `HEARTBEAT.md`
- it is sent as the internal user turn for the heartbeat run
- it is recorded in normal conversation memory as the heartbeat user turn
- it does not change the scheduling model

### 14.2 Proposed User Control

Extend `HEARTBEAT.md` with one optional setting:

- `message: <plain text>`

Example:

```md
# HEARTBEAT.md

after: 30m
notify: live
message: Check whether the latest Runpod experiment finished, summarize the result, and update TODO.md with the next step.
```

If `message:` is omitted, the runtime must use the default message:

```text
continue
```

### 14.3 Parsing Rules

The first implementation should support a single-line message only.

Rules:

- ignore blank lines
- ignore comment lines that start with `#`
- parse the first valid `message:` line
- trim surrounding whitespace from the message value
- if `message:` is empty after trimming, fall back to `continue`
- if multiple valid `message:` lines exist, use the first one and ignore the rest
- keep unknown lines ignored for forward compatibility
- enforce a bounded maximum length before sending the message to the provider

Recommended initial maximum:

- 1,000 characters after trimming

If the configured message exceeds the limit, the runtime should treat it as invalid and fall back to `continue`.
This keeps accidental paste-heavy `HEARTBEAT.md` edits from turning heartbeat into a large hidden prompt injection surface.

Multi-line messages may be added later, but they should not block the first implementation.
If multi-line support is added, prefer an explicit block syntax such as `message: |` with indented lines rather than guessing from arbitrary trailing file content.

### 14.4 Runtime Semantics

The resolved wake-up message is the message that the runtime sends to the provider when the heartbeat fires.

Resolution order:

1. Read `HEARTBEAT.md` when the wake-up starts.
2. If heartbeat is disabled because `after:` is missing or invalid, do not run.
3. If a valid bounded `message:` exists, use it.
4. Otherwise use `continue`.

The pending heartbeat state should not need to store the message.
The pending state should remain only the scheduling record, such as `{ agent_id, wake_at }`.
This lets the human edit the wake-up message before the heartbeat fires without rewriting runtime state.

The configured message must not make heartbeat a general scheduler.
It only changes the content of the single internal turn that was already going to happen.

### 14.5 Interaction With Notifications

The configured message should work with all notification modes:

- `notify:` omitted or `notify: quiet`: run silently using the resolved message
- `notify: digest`: run using the resolved message, then apply the existing compact digest policy
- `notify: live`: run using the resolved message and stream provider progress through the reused live-status surface

The configured message itself should not be sent to Telegram as a separate notification.
Telegram users should see either live status derived from runtime progress, a final digest, or nothing, depending on `notify:`.

### 14.6 Safety Rules

The configured message is user-owned local configuration, but it still needs bounded behavior.

Rules:

- keep `after:` required; a `message:` alone must not enable heartbeat
- default to `continue` on missing, empty, or invalid `message:`
- do not support variable expansion in the first implementation
- do not interpolate secrets, env vars, paths, dates, Telegram metadata, or prior messages
- do not execute the message as a shell command
- do not treat the message as markdown directives for Telegram file delivery
- do not copy live-status or transport-only labels into the configured message

This keeps the feature predictable and prevents `HEARTBEAT.md` from becoming a second automation language.

### 14.7 Incremental Implementation Plan

1. Promote the configurable wake-up message behavior into `docs/spec.md`, then sync `README.md`, `AGENTS.md`, tests, and code in the implementation change.
2. Extend heartbeat settings parsing to return `{ delayMs, notifyMode, message }`.
3. Preserve `continue` as the default when `message:` is omitted or invalid.
4. Use the resolved message for the heartbeat provider input `text` field.
5. Use the resolved message for the heartbeat conversation user entry.
6. Keep pending heartbeat state unchanged; do not persist the message in `opencolab.json`.
7. Ensure digest and live-status behavior uses provider progress and final response, not the raw configured message as a Telegram notification.
8. Add tests for omitted message defaulting to `continue`, configured message reaching the agent responder, configured message appearing in conversation memory, empty or oversized message fallback, and compatibility with `notify: digest` and `notify: live`.
