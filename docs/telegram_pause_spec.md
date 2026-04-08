# Telegram `/stop` Spec

## Goal

Add a Telegram `/stop` command that cancels the active routed agent run and saves a short recovery summary for later resume.

This is a stop-and-summarize feature, not true process pause/resume.

## Scope

`/stop` applies only to the active routed run for the same Telegram conversation lane:

- `chatId`
- `messageThreadId` when present

It must not cancel unrelated work in another chat or thread.

## Behavior

If a routed run is active for that conversation lane, `/stop` must:

1. cancel the in-flight provider/runtime execution,
2. close the live status surface for that run,
3. save a compact recovery summary in session memory,
4. prevent the stopped run from sending a late final reply,
5. send a short confirmation reply.

Recommended confirmation:

```text
Stopped the current task.
Saved the latest progress so you can ask me to continue later.
```

If no routed run is active for that conversation lane, `/stop` should reply:

```text
No active task to stop.
```

## Recovery Summary

When a run is stopped by `/stop`, the gateway must append a compact assistant recovery entry to session memory.

Required content:

- the run was stopped by the user with `/stop`,
- the active provider/model,
- the latest meaningful progress message when available,
- a short next-action hint.

Recommended shape:

```text
Previous attempt was stopped by the user with /stop using <provider>/<model>.
Last progress: <latest meaningful progress message>
Next action: continue from the last completed stage if the user asks to resume.
```

Rules:

- omit `Last progress:` if no meaningful progress exists yet,
- do not append raw live status events as normal conversation turns,
- do not append partial cancelled output as if it were a finished assistant answer.

## Runtime Rules

The gateway should keep one in-memory active-request record per conversation lane.

Minimum runtime requirements:

- `/stop` must have a cancellation handle for the in-flight provider process,
- the provider process should be terminated on `/stop`,
- a stopped request must be marked stale,
- stale requests must not send a final Telegram answer after stop,
- stale requests must not append a normal assistant completion turn.

## Polling Constraint

Telegram long polling currently processes updates serially.

`/stop` is only complete if polling mode can interrupt an in-flight routed run. If polling keeps waiting for the old run to finish before handling `/stop`, the feature is incomplete in polling mode.

## Tests

Add focused tests for:

- `/stop` cancels an active routed run,
- `/stop` with no active run returns a short no-op reply,
- stopping a run saves the compact recovery summary,
- a stopped run does not send a late final Telegram reply,
- live status closes cleanly on stop,
- the latest meaningful progress message is preserved when available.
