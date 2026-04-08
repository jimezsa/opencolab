# Telegram `/stop` Proposal

This document is a focused proposal for a minimal interrupt feature before any broader "pause on new message" behavior is added to the main product spec.

The goal is to support one explicit Telegram stop command that cancels the current routed agent run and preserves enough context for a later resume.

## Summary

Add a Telegram `/stop` command.

When a routed agent task is currently running for the active Telegram conversation lane, `/stop` must:

- stop the in-flight provider/runtime execution,
- prevent the stopped run from sending a late final answer,
- close its live status surface,
- append a compact recovery summary to session memory,
- send the user a short confirmation reply.

If no routed task is active for that conversation lane, `/stop` should reply with a short "nothing is running" message and do nothing else.

This is intentionally a stop-and-summarize feature, not a true process pause/resume feature.

## Why This First

This is the smallest useful interruption feature that fits the current architecture.

Reasons:

- the gateway already tracks meaningful progress messages during a routed run,
- the gateway already writes compact recovery summaries for failed or timed out runs,
- provider execution is currently modeled as one in-flight CLI process,
- true suspend/resume semantics would be provider-specific and much more complex.

The first version should therefore treat `/stop` as:

- user-requested cancellation,
- plus a resumable summary in conversation memory.

## Scope

In scope:

- Telegram `/stop` command from an authorized, paired chat,
- cancellation of one active routed agent task for the same conversation lane,
- preservation of the latest meaningful runtime progress as a recovery summary,
- protection against stale late replies from a stopped run,
- tests for both normal and edge cases.

Out of scope:

- automatic interruption when any new non-command message arrives,
- true OS-level process suspension and later continuation,
- provider-native checkpointing,
- cancellation of background GPU jobs or manual SSH sessions,
- general multi-run concurrency across one chat lane.

## Conversation Lane

For this feature, an active routed task is scoped to one Telegram conversation lane:

- `chatId`
- plus `messageThreadId` when present

This prevents `/stop` in one Telegram topic/thread from cancelling unrelated work in another topic/thread.

## User-Facing Behavior

### Supported command

- `/stop`

### Command behavior

If a routed agent run is active for the same conversation lane:

1. Mark the run as stopping.
2. Cancel provider execution.
3. Close any active live status session for that run.
4. Append a compact assistant recovery entry to session memory.
5. Send a short Telegram confirmation.

Recommended confirmation copy:

- `Stopped the current task.`
- `Saved the latest progress so you can ask me to continue later.`

If no routed agent run is active for that lane:

- reply with a short no-op message such as `No active task to stop.`

### Resume expectations

The system does not automatically resume a stopped process.

Instead, the next user message may ask the agent to continue, for example:

- `continue from the last stage`
- `resume the stopped task`

The agent should see the recovery summary in session memory and continue from there when reasonable.

## Recovery Summary Requirements

When a run is stopped by `/stop`, the gateway must append a compact assistant recovery entry to the active session memory.

Required content:

- that the previous attempt was stopped by the user,
- the active provider/model label,
- the latest meaningful progress line when available,
- a short next-action hint.

Recommended shape:

```text
Previous attempt was stopped by the user with /stop using <provider>/<model>.
Last progress: <latest meaningful progress message>
Next action: continue from the last completed stage if the user asks to resume.
```

Requirements:

- do not append raw progress events as normal assistant chatter,
- do not dump the full live status history,
- use the latest meaningful progress line, not low-signal token or heartbeat updates,
- if no progress was emitted yet, omit the `Last progress:` line.

## Runtime Model

### Active request registry

The gateway should maintain an in-memory registry of active routed requests keyed by conversation lane.

Each active entry should minimally store:

- request id,
- `chatId`,
- optional `messageThreadId`,
- active project id,
- active agent id,
- provider label,
- current lifecycle state: `running | stopping | stopped | completed`,
- latest meaningful progress message,
- live status session handle,
- cancellation handle for provider execution.

This registry is operational state only.

It must not be persisted as conversation history.

### Stop semantics

`/stop` is a cancellation request, not a graceful provider-native pause.

The runtime should:

- attempt to terminate the provider CLI child process,
- escalate to a stronger kill if the process does not exit promptly,
- mark the request as stopped,
- ignore any subsequent output from that request.

If the provider exits after cancellation and still produces buffered output, that output must not be sent to Telegram as a final answer and must not be appended as a normal assistant reply.

## Provider Integration Requirements

The provider execution layer must expose a cancellation handle for an in-flight routed request.

Minimum behavior:

- one spawned provider CLI process per routed request,
- gateway-owned cancel function,
- child-process termination on `/stop`,
- no late final resolve path after a request is marked stopped.

This proposal does not require provider-specific graceful shutdown semantics beyond child-process termination.

## Live Status Behavior

If a stopped run already has a live status surface:

- stop accepting further progress updates from that run,
- close the live status session,
- do not replace the stop confirmation with another provider-generated completion message.

The final user-visible message after `/stop` should be the explicit stop confirmation, not a stale answer from the cancelled run.

## Polling Constraint

Telegram long polling currently processes updates serially.

That means a later `/stop` update can be blocked behind the very run it is trying to stop.

Therefore this feature requires one of these behaviors:

1. polling dispatch must hand off routed updates without awaiting full request completion, or
2. `/stop` support is only considered complete for webhook/concurrent delivery modes.

Recommended direction:

- make polling dispatch non-blocking after an update has been accepted for execution,
- still advance Telegram update offsets once the runtime has taken ownership of the update,
- ensure a stopped run cannot be retried or resurrected by polling.

## Memory and Transcript Rules

Conversation memory rules for `/stop`:

- append the inbound `/stop` user turn only if command turns are already treated as normal conversation for that lane,
- always append the compact assistant recovery summary for the stopped run,
- do not append the cancelled run's partial output as if it were a finished assistant answer,
- do not append transport-level live status lines as normal conversation turns.

If the product wants command turns excluded from conversational memory, that should remain a separate decision from this proposal.

## Failure Cases

### No active run

`/stop` should return a short no-op response and must not write a recovery summary.

### Stop before first progress event

The summary should still state that the run was stopped by the user, but may omit `Last progress:`.

### Provider does not exit cleanly

The runtime should:

- attempt forced termination,
- still mark the run stopped from the user perspective,
- preserve the latest known progress in the recovery summary,
- log the cleanup problem for diagnostics.

### Late provider output after stop

Late output must be discarded for user-facing delivery.

No final Telegram answer should be sent from the stopped request.

## Testing Requirements

Add focused tests for:

- `/stop` cancels an active routed run,
- `/stop` with no active run returns a no-op message,
- stopped runs append a compact recovery summary,
- stopped runs do not send a late final Telegram answer,
- live status closes cleanly on stop,
- latest meaningful progress is preserved in the summary,
- polling mode can deliver `/stop` while another routed request is still active.

## Future Extension

If this proposal works well, a later phase may add:

- "what are you doing now" as a local status query against the active request registry,
- preemption of an active run when a new normal user message arrives,
- provider-specific resume/checkpoint support where a runtime can actually continue prior work.

Those should be treated as follow-on features, not part of the first `/stop` delivery.
