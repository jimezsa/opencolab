# OpenColab Heartbeat Plan

## 1. Status

This document is a planning note for a minimal heartbeat v1.

It is intentionally narrow.
It is not yet a normative runtime contract until promoted into `docs/spec.md`, `README.md`, and implementation.

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
- heartbeat-specific notification policies

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

## 12. Follow-Up Plan: Minimal Telegram Feedback for Heartbeat

This section revises the earlier follow-up idea toward minimal intervention.

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
