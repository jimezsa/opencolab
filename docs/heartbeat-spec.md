# OpenColab Heartbeat Plan

## 1. Status

This document is a planning note for agent heartbeat support in OpenColab.

It is intentionally simple and focused on a small v1 design.
It is not yet normative runtime contract until promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Purpose

OpenColab already has strong agent files for startup, planning, and memory, but it does not yet have a lightweight way for an agent to wake itself up on a schedule and check the next thing to do.

The goal is to let selected agents run a small periodic self-check without introducing a heavy scheduler model.

Primary v1 targets:

- `professor`
- `autoresearch`

The intended model is:

- each target agent gets a `HEARTBEAT.md` file in its own folder
- the heartbeat interval is defined inside that file
- if the file has no valid heartbeat interval, heartbeat is off
- the runtime periodically checks whether the agent is due
- when due, the runtime triggers one internal heartbeat turn for that agent

## 3. Design Goal

This feature should stay much simpler than a job scheduler.

V1 should avoid:

- cron syntax
- retry policies
- backoff state machines
- distributed locks
- complex heartbeat history or analytics
- autonomous unsolicited Telegram replies

The point is not to build a general automation platform.
The point is to let `professor` and `autoresearch` wake up, inspect their local state, and act on the next obvious step.

## 4. Core Principle

Use only two persistent pieces of data:

1. `HEARTBEAT.md`
2. one runtime-owned last-run timestamp per agent

That is enough for a clean v1.

## 5. Agent File Layout

Each heartbeat-enabled agent should have:

- `projects/<project_id>/AGENTS/<agent_id>/HEARTBEAT.md`

Recommended v1 seeding:

- seed `HEARTBEAT.md` for built-in `professor`
- seed `HEARTBEAT.md` for built-in `autoresearch`
- do not require it for all other agents yet

The feature may later become generic for any agent, but v1 should stay focused on the two agents that benefit most from periodic review.

## 6. File Contract

`HEARTBEAT.md` is a human-edited file.

It should contain:

- one simple interval line such as `every: 30m`
- plain-language instructions for what the agent should check or do on each wake-up

If the file has no valid `every:` line, heartbeat is disabled.

This is intentionally more robust than trying to decide whether the file is "empty enough".
Comments or placeholder text can remain in the file without accidentally enabling heartbeats.

### Disabled Example

```md
# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
```

### Enabled Example

```md
# HEARTBEAT.md

every: 30m

Review TODO.md and PROJECT-AND-TEAM.md.
If there is a clear next action, do it.
If blocked on the human, write the blocker clearly in TODO.md.
Do not start costly or destructive work without approval.
```

## 7. Interval Format

To keep parsing simple, v1 should support only a small duration format such as:

- `15m`
- `30m`
- `45m`
- `1h`
- `2h`

Recommended parser rule:

- ignore blank lines
- ignore comment lines that start with `#`
- scan for the first valid `every: <duration>` line
- if none is found, heartbeat is disabled

V1 should not support cron expressions.

## 8. Runtime State

The runtime should store only one tiny scheduler value per agent:

- `last_run_at`

Recommended location:

- `.opencolab/heartbeat/<project_id>/<agent_id>.last-run`

This file is runtime-owned, not agent-owned.

It is not:

- conversation memory
- shared project context
- task planning
- part of `HEARTBEAT.md`

It exists only so the runtime can answer:

- when did this agent last run its heartbeat
- is the agent due again now

## 9. Runtime Loop

The background runtime should do a very small periodic check, for example once per minute.

V1 loop:

1. Wake up every minute.
2. Check `professor` and `autoresearch`.
3. Read each agent's `HEARTBEAT.md`.
4. If no valid `every:` line exists, skip that agent.
5. If the agent is already busy handling another turn, skip that agent.
6. Read `last_run_at`.
7. If `now` is earlier than `last_run_at + interval`, skip.
8. If due, run one internal heartbeat turn for that agent.
9. When that turn begins, or when it finishes, write the new `last_run_at` value consistently.

Important simplification:

- v1 assumes one normal OpenColab background process owns this loop
- v1 does not try to coordinate multiple scheduler processes

That is acceptable because OpenColab already has a single background gateway/service model.

## 10. Busy Rule

Heartbeat should never compete with a normal user-driven turn for the same agent.

If an agent is already busy:

- skip this heartbeat check
- wait for the next scheduler tick

This keeps the design simple and prevents overlapping runs for `professor` or `autoresearch`.

## 11. Heartbeat Turn Semantics

A heartbeat run should be treated as an internal runtime-triggered turn, not as a Telegram webhook and not as an ordinary human chat message.

The runtime should supply a compact internal instruction such as:

- this is a heartbeat wake-up
- current time
- the content of `HEARTBEAT.md`
- reminder to inspect normal agent files like `TODO.md` and `PROJECT-AND-TEAM.md`

The agent should then decide whether there is a clear next action.

Expected outcomes:

- no-op if nothing needs to be done
- update local files like `TODO.md`, `PROJECT-AND-TEAM.md`, or `MEMORY.md` when appropriate
- do one bounded next step if the file instructs it and the work is safe
- stop and leave a clear blocker if human input is needed

## 12. Memory Rule

Heartbeat turns should not pollute normal user conversation history.

V1 should therefore avoid appending heartbeat runs into:

- `memory/Session/`
- working memory
- daily summaries intended for human conversation continuity

The heartbeat is not a normal conversation turn.

If a heartbeat discovers something durable, the agent should write it into the correct file instead:

- `TODO.md` for active next steps or blockers
- `PROJECT-AND-TEAM.md` for stable shared project facts
- `MEMORY.md` for durable long-term agent facts

## 13. Notification Policy

V1 should be quiet by default.

That means:

- no autonomous Telegram messages on every heartbeat
- no routine "I checked and nothing changed" messages
- no new notification system in v1

Heartbeat is primarily for self-maintenance and forward progress, not for background chatter.

If a future version wants notification support, it should be added later as an explicit policy layer.

## 14. Why This Is Clean

This design is clean because it keeps responsibilities separate:

- `HEARTBEAT.md` is human-edited policy and instructions
- `TODO.md` remains the active task list
- `PROJECT-AND-TEAM.md` remains curated shared project context
- `MEMORY.md` remains long-term memory
- `.opencolab/heartbeat/...` remains tiny runtime scheduler bookkeeping

It also keeps the parser and runtime behavior small:

- one interval line
- one timestamp file
- one periodic check loop

## 15. Non-Goals

This design should not try to solve:

- general workflow automation
- multi-step recurring pipelines with dependencies
- recurring external notifications
- cross-machine scheduler coordination
- agent-to-agent autonomous chatter on a timer
- complex failure recovery policy

If those become necessary later, they should be added after the simple version proves useful.

## 16. Suggested V1 Defaults

For `professor`, heartbeat should usually focus on:

- reading `TODO.md`
- reading `PROJECT-AND-TEAM.md`
- checking whether there is an obvious next coordination step
- keeping the project moving without spamming the human

For `autoresearch`, heartbeat should usually focus on:

- reading `TODO.md`
- checking whether a bounded next experiment step is already authorized
- updating the local plan or blocker state
- avoiding risky or costly runs unless the instructions explicitly allow them

## 17. Future Extensions

These can wait until after the simple version works:

- notification policies such as `notify: on_change`
- retry or backoff behavior
- optional heartbeat logs
- startup catch-up behavior like "run immediately if overdue"
- support for more agents by default
- richer config front matter

## 18. Recommendation

Start with the smallest viable contract:

- one `HEARTBEAT.md` file per target agent
- one `every:` line for schedule
- one runtime `last_run_at` file
- one minute scheduler tick
- skip when busy
- no normal conversation-memory writes

That should be enough to prove the feature is useful without making OpenColab harder to understand or maintain.
