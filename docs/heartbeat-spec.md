# OpenColab Heartbeat Plan

## 1. Status

This document is a planning note for a minimal heartbeat v1.

It is intentionally narrow.
It is not yet a normative runtime contract until promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Goal

Heartbeat should be a delayed follow-up for the default lead agent, not a general scheduler.

After an agent run ends in one of these states:

- completed
- stopped by the user
- timed out by the provider CLI

OpenColab may schedule one later wake-up for the default lead agent `professor`.

When the wake-up fires, the runtime should start one internal turn for `professor` with the prompt:

```text
continue
```

That is the whole feature.

## 3. Scope

V1 supports only:

- the default lead agent `professor`
- one human-edited file at `projects/<project_id>/AGENTS/professor/HEARTBEAT.md`
- one pending wake-up per project
- one fixed internal prompt: `continue`

V1 does not support:

- heartbeat for `beginner`, `autoresearch`, or specialist agents
- periodic multi-agent scanning
- cron syntax
- custom heartbeat prompts
- queued wake-ups
- retries or backoff
- heartbeat-specific notification policies

## 4. `HEARTBEAT.md` Contract

`HEARTBEAT.md` is human-edited.

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
- if no valid `after:` line exists, heartbeat is disabled

Supported v1 duration format should stay small:

- `15m`
- `30m`
- `1h`
- `2h`

Any other text in the file is ignored by the runtime in v1.

## 5. Scheduling Rule

This is not a wall-clock scheduler.
It is a one-shot delay that is armed by a terminal agent event.

Rules:

- only `professor` can be auto-woken
- the agent that just finished does not matter
- any qualifying completion, stop, or timeout can arm the next wake-up for `professor`
- a heartbeat-triggered `professor` run can arm the next heartbeat again when it finishes
- auto-waking `professor` must not implicitly switch the project's active agent selection

## 6. Runtime State

V1 should store one tiny runtime-owned value per project:

- `wake_at`

Recommended location:

- `.opencolab/heartbeat/<project_id>/default-agent.next-wake`

This state exists only to answer:

- when should `professor` receive the next `continue` turn

V1 does not need:

- per-agent heartbeat state
- heartbeat history
- retry counters
- `last_run_at`

## 7. Runtime Flow

Minimal flow:

1. An agent run ends as `completed`, `stopped`, or `timed_out`.
2. The runtime reads `projects/<project_id>/AGENTS/professor/HEARTBEAT.md`.
3. If heartbeat is disabled, clear any pending wake-up and stop.
4. If no wake-up is pending, store `wake_at = now + after`.
5. If a wake-up is already pending, keep the existing one. V1 never queues more than one wake-up.
6. If `professor` starts any turn before the wake-up fires, clear the pending wake-up. That turn can arm the next one when it ends.
7. A small background check, such as once per minute, looks for due wake-ups.
8. When `wake_at <= now` and `professor` is idle, start one internal `professor` turn with the prompt `continue`.
9. Clear the pending wake-up when `professor` starts that turn.
10. If `professor` is busy when the wake-up becomes due, keep the pending wake-up and try again on the next check.

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
Existing stop or timeout recovery summaries can continue to provide the context that `professor` sees on the next turn.

## 9. Notification Rule

V1 should stay quiet by default.

That means:

- no automatic Telegram message just because the wake-up was scheduled
- no routine "heartbeat ran" message
- no new notification policy in this document

The wake-up is for internal follow-through, not background chatter.

## 10. Minimal Implementation Plan

1. Seed `HEARTBEAT.md` only for the default `professor` agent.
2. Parse one `after:` duration from that file.
3. Store one pending `wake_at` timestamp per project.
4. Arm that wake-up when any agent run completes, is stopped by the user, or hits CLI timeout.
5. When the wake-up is due and `professor` is idle, run one internal `continue` turn for `professor`.
6. Keep everything else out of v1.

## 11. Non-Goals

This document does not try to define:

- general workflow automation
- recurring schedules for all agents
- custom prompts per agent
- autonomous agent-to-agent chatter
- rich scheduler state or analytics
- broader behavior changes outside this heartbeat note
