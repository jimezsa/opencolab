# Telegram Pairing Handshake Spec

## Goal

Make Telegram pairing in `opencolab ignite` a one-step handshake.

Today the user must supply three things: bot token, chat id, and a 6-digit
pairing code. This spec removes the chat id and pairing code prompts. After the
bot token is set, ignite waits for the user to send any message to the bot; the
inbound message auto-detects the chat id and completes pairing in one step.

## Rationale

An inbound Telegram message carries both facts pairing needs at once:

- `message.chat.id` — the chat id to authorize.
- proof the sender controls that chat — they just sent from it.

The pairing code only exists to prove chat ownership when the chat id is typed
manually. Once the chat id comes from a real inbound message, the code is
redundant.

## Scope

- Changes apply to the ignite onboarding flow only (`configureTelegram` in
  `src/ignite.ts`).
- The bot-token prompt is unchanged.
- The existing `startPairing` / `completePairing` methods and the
  `opencolab setup telegram pair start|complete` CLI commands stay as-is, as a
  manual fallback.

## Behavior

After the bot token is confirmed in `configureTelegram`:

1. If Telegram is already configured and paired, keep current behavior (offer to
   keep or reconfigure).
2. Drain pending updates first (`deleteWebhook` + advance offset past existing
   updates) so a stale message cannot auto-pair.
3. Show where to send the message. Call `getMe` to display the bot `@username`
   and a `t.me/<username>` link when available; fall back to a generic hint if
   `getMe` fails.
4. Prompt: `Open Telegram, message your bot, and send any message (e.g. "hello").`
5. Long-poll `getUpdates` until the first `message`-type update arrives. Accept
   **any** text message (do not require the literal word `hello`).
6. Extract `chatId = String(message.chat.id)`.
7. Persist chat id and mark paired in one step (see Runtime Rules), then call
   `syncTelegramCommands(chatId)`.
8. Send a short confirmation reply to the chat, e.g. `Paired ✅ OpenColab is
   connected to this chat.`
9. Print a terminal confirmation echoing the detected chat id and sender.

## Runtime Rules

- Add a runtime/gateway method to complete pairing from a detected chat id
  without a code, e.g. `markTelegramPaired(chatId)`. It must set `chatId`,
  `paired = true`, `pairedAt`, and clear `pendingPairingCode` /
  `pendingPairingExpiresAt`.
  - Reason: `setupTelegram` forces `paired = false` whenever `chatId` changes
    (`src/runtime.ts:485`), so the ignite flow cannot rely on `setupTelegram`
    alone to reach a paired state.
  - Do not reuse `startPairing` for this — it sends a spurious code message to
    the chat.
- The authorized-chat check in `handleWebhook` is unchanged; it already compares
  `String(chat.id)` against `state.telegram.chatId`, which matches the stored
  value.

## Ignite Wiring

- Add a new injected dependency alongside `syncTelegramCommands`, e.g.
  `waitForTelegramHandshake({ timeoutMs, onWaiting })`, implemented in `cli.ts`
  next to `syncTelegramBotCommands` (where token + Telegram API access live).
- It returns `{ chatId, chatType, sender, text } | null` (null on
  timeout/cancel).
- Reuse the polling primitives from `src/telegram-poller.ts`
  (`deleteWebhook`, `getUpdates`, offset priming); export them or a one-shot
  helper as needed.

## Cancel and Timeout

- Poll with an overall timeout (default ~3 minutes) and emit periodic
  "still waiting…" messages via `onWaiting`.
- On timeout, offer: retry the handshake, or fall back to manual chat-id entry
  (existing `setupTelegram` + code flow), or skip Telegram.
- Skipping leaves Telegram unconfigured, same as today.

## Constraints

- Only one `getUpdates` consumer can run at a time. The handshake assumes no
  gateway poller is running (normal during onboarding). If `getUpdates` returns a
  conflict error, surface a clear message telling the user to stop any running
  gateway and retry.

## Tests

Add focused tests for:

- handshake returns the chat id from the first inbound message,
- stale/pre-existing updates are drained and do not trigger auto-pairing,
- `markTelegramPaired` sets `paired = true` and clears pending code fields,
- ignite completes pairing without prompting for chat id or code,
- timeout returns null and offers the fallback path,
- any text message (not only `hello`) completes the handshake.
