# OpenColab Multi-Bot Project Routing Spec

## 1. Status

**Implemented.** Phases 1-8 of section 23 are in the runtime; the normative contract now lives in
`docs/spec.md` (sections 2, 3, 4, 6, 7.1, 8, 10, 13.11, 14), with `README.md` and `AGENTS.md`
synced. Phase 9 — removing the deprecated `state.telegram` projection, the legacy
`resolveTelegramBotToken()` shim, and the Studio scalar — is deliberately deferred one release so
a downgrade stays safe.

This document is kept as the design record: it explains the baseline it replaced, why each
decision was made, and what was intentionally left out. Section 6 describes the pre-change code
and its line numbers are therefore historical.

## 2. Problem

Today OpenColab has one Telegram bot, one paired chat, and one globally active project.
Multiple projects and multiple agents per project already exist, but the single bot always
talks to whatever `activeProjectId` / `activeAgentId` happens to be set to.

Consequence for the operator:

- one chat is a shared mailbox for every project
- switching work means `/projects` then `/agents` in the same chat, every time
- the global switch is destructive to context: switching to answer project B changes where a
  project A heartbeat digest or workflow notification lands
- chat history in Telegram interleaves unrelated projects, while OpenColab-side session memory
  silently jumps between agents

Desired behavior: one Telegram bot per project. Open the chat for project A, type, and the
principal agent of project A answers. No switching, no global mode.

## 3. Goals

- bind N Telegram bots to N OpenColab projects, one project per bot
- a message to a bound bot routes to that bot's project and that project's target agent,
  independent of `activeProjectId`
- per-bot pairing and authorization, so each bot trusts exactly its own chat
- per-bot target agent, switchable from inside that bot's chat without touching global state
- project-scoped heartbeat digests and workflow notifications delivered to the bot that owns
  the project
- existing single-bot installs keep working with no manual file edits and no re-pairing
- bot tokens stay operator-entered secrets in `.env.local`, never in `opencolab.json`

## 4. Non-Goals

- multiple bots inside one chat answering the same message (that is
  `docs/multi_bot_telegram_spec.md`, see section 5)
- bot-to-bot public conversation, mention routing, or internal delegation
- several bots bound to the same project
- several projects behind one bot
- multi-user access control beyond the current one-trusted-chat-per-bot model
- agents creating Telegram bots; BotFather stays a manual operator step

## 5. Relationship To The Existing Multi-Bot Draft

`docs/multi_bot_telegram_spec.md` describes a different axis: many bot identities for many
agents **inside one project**, sharing one group, with `@mention` routing, shared project
memory, and internal delegation.

This spec is the other axis: one bot identity per **project**, each in its own chat.

They compose. This spec introduces the bot registry, the per-bot token/transport plumbing, and
the "routing target is resolved from the bot, not from global state" rule. All three are
prerequisites for that draft. The reply-policy and mention-routing layers from that draft stay
out of scope here; a `replyMode` field is reserved in the schema (section 7.2) so it can land
later without another migration.

Recommended order: this spec first, that draft second.

## 6. Current Behavior (Baseline)

Accurate as of `5053ea4`. These are the exact seams the change has to move.

### 6.1 One global Telegram config

`OpenColabState.telegram: TelegramConfig` — `src/types.ts:125`, `src/types.ts:148`.
Holds `chatId`, `paired`, `pairedAt`, `pendingPairingCode`, `pendingPairingExpiresAt`,
`lastChatType`, `lastMessageThreadId`, `lastInteractionAt`, `notifyWorkflowProgress`.
One of each, installation-wide.

### 6.2 One global token

`resolveTelegramBotToken()` reads `TELEGRAM_BOT_TOKEN` from the process env — `src/secrets.ts:43`.
Called from `src/gateway.ts:1520,1643,1686,2461`, `src/telegram-poller.ts:30,175,208`,
`src/cli.ts:1370,1891`, `src/ignite.ts:377,464`.

### 6.3 Transport ignores the state it is handed

Every sender takes a `state: OpenColabState` argument and discards it (`void state;` at
`src/gateway.ts:1583,1599,1627,1642,1673,1685`). The token is re-resolved globally inside
`postTelegramJson` (`src/gateway.ts:1516`). The `state` parameter is therefore already a
vestigial slot in the right place — it becomes the bot context.

### 6.4 Routing resolves from global active state

`handleQueuedWebhook` calls `getActiveProject(state)` and `getProjectActiveAgent(project)` —
`src/gateway.ts:595-596`. The inbound chat does not influence target selection at all.

### 6.5 Authorization is one chat

`handleWebhook` rejects unless `inbound.chatId === state.telegram.chatId`, then requires
`state.telegram.paired` — `src/gateway.ts:445`.

### 6.6 Conversation memory follows global active agent

The gateway's `readConversationMemory` / `appendConversation` / `resetConversationSession` deps
accept a `chatId` and ignore it, using `resolveActiveAgentPath()` —
`src/runtime.ts:277-280`, `src/runtime.ts:1295`.

### 6.7 Provider execution already has the right seam

`ProviderAgent.respond()` resolves active project/agent itself (`src/provider-agent.ts:71-79`)
and then delegates to `respondFor(project, agent, input, options)`. `respondFor` is already used
by web chat and by the workflow runner, so explicit routing needs no new provider plumbing.

### 6.8 One poller, one offset, one webhook path

`startTelegramPolling(runtime, ...)` is started once in `src/http.ts:60-62`, holds a single
`offset`, and calls `deleteWebhook` on start. Webhook ingestion is the single path
`POST /api/telegram/webhook` — `src/http.ts:87`.

### 6.9 Lanes are chat-scoped

`buildTelegramConversationLaneKey(chatId, messageThreadId)` — `src/gateway.ts:1936` — keys
`activeRequests` and `laneQueues`, and therefore `/stop` scoping and busy detection.

### 6.10 Heartbeat is project-scoped already; delivery is not

`runHeartbeatTick` iterates every project (`src/runtime.ts:1242-1278`), but digests go through
`gateway.sendHeartbeatDigest` (`src/gateway.ts:496`) and live status through
`gateway.openHeartbeatLiveStatus` (`src/gateway.ts:520`), both of which read the single
`state.telegram.chatId`.

### 6.11 Workflow notifications are global-flag, global-chat

`createTelegramWorkflowNotifierFactory` gates on `state.telegram.notifyWorkflowProgress` and
sends to `state.telegram.chatId` — `src/telegram-workflow-notifier.ts:38-50` — even though
`WorkflowService` instances are already per project (`src/runtime.ts:1213`).

### 6.12 Command menu sync is single-token

`syncTelegramBotCommands(chatId)` — `src/cli.ts:1367` — resolves the global token and pushes one
command list across `default`, `all_private_chats`, `all_group_chats`, and the one chat scope.

### 6.13 Migration machinery exists and is version-gated

`CURRENT_VERSION = 2` (`src/project-config.ts:30`), `normalizeState` (`:505`),
`normalizeSharedTelegram` (`:912`), `migrateTelegram` (`:963`).
`normalizeSharedTelegram` already absorbs *legacy per-project* `telegram` blocks, so a
project-scoped Telegram config is a shape this codebase has carried before.
`mergeProjectStateChanges` (`:384`) is a generic three-way JSON merge, so a new keyed map merges
per key and key deletion propagates correctly.

## 7. Target Model

### 7.1 Concepts

- **Bot profile** — one real Telegram bot created in BotFather, bound to exactly one project.
  Identified by a stable local `botId`.
- **Binding** — `botId -> projectId`, plus an optional pinned `agentId`.
- **Target agent** — the agent that answers in that bot's chat. Defaults to the bound project's
  `activeAgentId` and can be pinned per bot.
- **Bot context** — the resolved `{ botId, token, projectId, agentId, chat state }` tuple that
  every Telegram API call and every routed turn must carry.

Rule: **the bot decides the project. Global `activeProjectId` must not participate in Telegram
routing.** `activeProjectId` keeps its meaning for the CLI and for OpenColab Studio only.

### 7.2 Bot profile shape

Stored in `opencolab.json` under a new installation-scoped map. No secrets.

```json
{
  "telegramBots": {
    "professor_main": {
      "id": "professor_main",
      "enabled": true,
      "scope": "pinned",
      "projectId": "quantum-rl",
      "agentId": null,
      "tokenEnvVar": "TELEGRAM_BOT_TOKEN_PROFESSOR_MAIN",
      "telegramBotId": "7712345678",
      "telegramUsername": "quantumrl_professor_bot",
      "replyMode": "default_public",
      "showAgentPrefix": true,
      "chatId": "123456789",
      "paired": true,
      "pairedAt": "2026-09-30T10:00:00.000Z",
      "pendingPairingCode": null,
      "pendingPairingExpiresAt": null,
      "lastChatType": "private",
      "lastMessageThreadId": null,
      "lastInteractionAt": "2026-10-01T08:12:00.000Z",
      "notifyWorkflowProgress": true,
      "boundAt": "2026-09-30T09:58:00.000Z",
      "lastValidatedAt": "2026-09-30T09:58:00.000Z"
    }
  }
}
```

Field contract:

| field | rule |
| --- | --- |
| `id` | `^[a-z0-9][a-z0-9_]{0,31}$`. Immutable. Defaults to a slug of `telegramUsername`. |
| `enabled` | `false` means no poller, no webhook acceptance, no outbound delivery. |
| `scope` | `"pinned"` (project-bound) or `"floating"` (legacy: follows `activeProjectId`). |
| `projectId` | Required when `scope` is `"pinned"`. Must exist in `projects`. Ignored when floating. |
| `agentId` | `null` means "the bound project's `activeAgentId`". Non-null pins one agent. |
| `tokenEnvVar` | Env key holding the token. `^[A-Z][A-Z0-9_]*$`. Never the token itself. |
| `telegramBotId`, `telegramUsername` | Filled from `getMe` at bind time. Operator never types them. |
| `replyMode` | Reserved for the mention-routing draft. v1 accepts only `"default_public"`. |
| `showAgentPrefix` | Whether replies carry the `agentId` first line (`src/gateway.ts:2354`). |
| `chatId` … `lastInteractionAt` | Per-bot copy of today's `TelegramConfig` chat fields. |
| `notifyWorkflowProgress` | Per-bot. Defaults to `true`, matching today's v2 default. |

Invariants, enforced at normalization time:

- at most one enabled bot per `projectId` (v1 constraint; a second bind to the same project is
  rejected with a clear error naming the existing bot)
- `tokenEnvVar` is unique across bots
- `telegramBotId` is unique across bots
- a bot whose `projectId` no longer exists is normalized to `enabled: false` and reported as
  `orphaned` by status output, never silently repointed at another project

### 7.3 State schema version 3

`CURRENT_VERSION` goes to `3`. `OpenColabState` gains `telegramBots: Record<string, TelegramBotProfile>`.

`state.telegram` is **kept** for one release as a read-only projection of the default bot, so a
downgrade to a v2 binary does not brick a paired install. It is written on every save, never read
by new code, and removed in the release after this one. `docs/spec.md` must mark it deprecated
the moment this lands.

### 7.4 Migration from v2

Added to `migrateTelegram`'s neighborhood as a new version-gated step in `normalizeState`,
derived entirely from existing state — no operator action, no file editing. This matters because
the live install runs on a remote Windows host and upgrades itself from code.

For a v2 state:

1. If `telegramBots` is already present and non-empty, leave it alone.
2. Otherwise, if `state.telegram.chatId` is set, create one bot:
   - `id`: `"default"`
   - `scope`: `"floating"`
   - `projectId`: `state.activeProjectId` (recorded, but unused while floating)
   - `agentId`: `null`
   - `tokenEnvVar`: `"TELEGRAM_BOT_TOKEN"`
   - all chat/pairing/notify fields copied verbatim from `state.telegram`
   - `telegramBotId` / `telegramUsername`: `null`, backfilled lazily on the next successful
     `getMe` (first poller start or first `commands sync`)
3. Otherwise create no bots. An unconfigured install stays unconfigured.

`scope: "floating"` is deliberate: the upgrade must not change observable behavior. The migrated
bot keeps following `activeProjectId` and keeps answering with the global active agent, exactly as
today, including `/projects` and `/agents` mutating global state. Pinning is an explicit operator
action (section 13), and `opencolab setup telegram status` must say so in one line.

Downgrade note: a v2 binary reading a v3 file sees `version: 3` (treated as "newer than every
migration", so no migration re-applies) plus the projection in `state.telegram`, and keeps
working as a single-bot install. Extra keys are already tolerated.

## 8. Secret Storage

- one env var per bot, in `.env.local`, written through the existing
  `writeSecretToLocalEnv` (`src/secrets.ts`)
- default naming: `TELEGRAM_BOT_TOKEN_<ID_UPPERCASED>`; the migrated `default` bot keeps the bare
  `TELEGRAM_BOT_TOKEN`
- `resolveTelegramBotToken()` is replaced by `resolveTelegramBotTokenFor(profile)`. The bare
  `resolveTelegramBotToken()` stays only as the default-bot shim used by legacy CLI paths and is
  removed with `state.telegram`.
- a bot with a missing token resolves to `tokenMissing`: it is skipped by the poller, rejected by
  the webhook path with a logged reason, and shown as `token missing (<ENV_VAR>)` in status output.
  It must not fall back to another bot's token.

Hard requirements:

- tokens never enter `opencolab.json`, prompts, agent memory, session logs, live status, or
  Telegram messages
- status and list output masks tokens to a fixed form (`present` / `missing`), never a prefix
- `getMe` must succeed before a binding is persisted; a failed validation persists nothing

## 9. Bot Context Threading

The mechanical core of the change. Today's transport functions accept `state` and ignore it.
Replace that parameter with an explicit context:

```ts
export interface TelegramBotContext {
  botId: string;
  token: string;
  profile: TelegramBotProfile;
}
```

Required changes:

- `postTelegramJson(method, payload)` takes `ctx` and builds `https://api.telegram.org/bot${ctx.token}/${method}`
- `TelegramSender`, `TelegramDraftSender`, `TelegramStatusMessageCreator`,
  `TelegramMessageEditor`, `TelegramTypingSender`, `TelegramFileSender`,
  `TelegramCallbackAnswerer` all take `ctx` in place of `state`
- `TelegramLiveStatusSession` stores `ctx` instead of `state`
- `defaultTelegramFileSender` and `defaultTelegramCallbackAnswerer`, which build URLs inline
  (`src/gateway.ts:1643,1686`), take `ctx`
- `resolveInboundFiles` is given the **resolved** project path, not the active one
  (`src/gateway.ts:638`)
- outbound `@telegram-file` resolution is given the **resolved** agent path, not the active one
  (`src/gateway.ts:688`)
- no module-level token lookup survives in `src/gateway.ts`

Because the dependency-injection points in `RuntimeOptions` (`src/runtime.ts:141-148`) already
pass these senders through for tests, the signature change is one coordinated edit across
`gateway.ts`, `runtime.ts`, `telegram-workflow-notifier.ts`, and the test doubles.

## 10. Inbound Ingestion

### 10.1 Polling

`startTelegramPolling` becomes `startTelegramPollers(runtime, options)`, returning a handle that
owns one loop per enabled, token-present bot.

Per loop:

- its own `offset`, primed exactly as today (`deleteWebhook` then a zero-timeout `getUpdates`)
- its own `getMe` on start, to backfill `telegramBotId` / `telegramUsername` and to fail fast with
  a named error on an invalid token
- every update is handed to the runtime **tagged with its `botId`**:
  `runtime.handleTelegramWebhook(update, { botId })`
- a failing loop (invalid token, revoked bot, repeated 409) logs `bot=<id>` and stops only itself;
  other bots keep running
- the handle's `stop()` stops every loop

Registry changes while the gateway is running must be picked up without a restart: the poller
supervisor re-reads the registry on a fixed interval (reuse the heartbeat tick cadence) and
starts/stops loops to match. This matters because `opencolab telegram bot add` runs in a separate
CLI process against a live gateway, and `opencolab.json` is already merge-safe across processes
(`src/project-config.ts:384`).

409 note: Telegram conflicts are per token, so independent bots never conflict with each other.
Two OpenColab installs sharing one token still conflict, and the error must name the bot.

### 10.2 Webhook

- new path `POST /api/telegram/webhook/:botId`
- legacy `POST /api/telegram/webhook` resolves to the `default` bot when it exists, else returns
  `400 unknown_bot`
- an unknown or disabled `:botId` returns `404 unknown_bot` without touching Telegram

### 10.3 Signature change

`OpenColabRuntime.handleTelegramWebhook(body, source)` where
`source: { botId: string }`. `TelegramGateway.handleWebhook(body, source)` likewise. The `botId`
is **never** read from the Telegram payload; it comes from the transport that received it.

## 11. Routing And Authorization

`handleWebhook` ordering, replacing `src/gateway.ts:445`:

1. parse the payload; unparseable is ignored as today
2. resolve the bot profile from `source.botId`; unknown or disabled -> `unknown_bot`, nothing sent
3. resolve the token; missing -> `token_missing`, nothing sent, logged once per bot per minute
4. authorize: reject unless `inbound.chatId === profile.chatId` -> `unauthorized_chat`
5. require `profile.paired`; otherwise reply with that bot's pairing instruction
6. resolve the routing target (section 11.1)
7. build the lane key including `botId` (section 15)
8. handle `/stop`, remember the chat target on the **profile**, then queue the turn

### 11.1 Target resolution

```
pinned:    project = projects[profile.projectId]
           agent   = profile.agentId ?? project.activeAgentId
floating:  project = projects[activeProjectId]          // today's behavior
           agent   = project.activeAgentId
```

Failure cases, each answered in-chat with a plain sentence and no provider run:

- bound project missing -> "This bot is bound to project `<id>`, which no longer exists. Rebind with `opencolab telegram bot bind`."
- pinned agent missing -> "Agent `<id>` is no longer in project `<id>`." and the bot falls back to
  the project's `activeAgentId` for that turn only, without rewriting the profile
- project has no agents -> error message, no run

### 11.2 Execution

The resolved pair is passed explicitly all the way down:

- `respond` dep becomes `respondFor(project, agent, input, options)` — already exists at
  `src/provider-agent.ts:82`
- `readConversationMemory` / `appendConversation` / `resetConversationSession` take the resolved
  agent path instead of `resolveActiveAgentPath()` (`src/runtime.ts:277-280`)
- `ensureAgentFiles` is called for the resolved agent before the turn
- `onAgentTurnStarted` / `onAgentTurnFinished` already carry `(projectId, agentId)`; they now carry
  the resolved pair, which fixes heartbeat bookkeeping for non-active projects as a side effect

No global state is read or written on the routing path for a pinned bot. In particular, a message
to bot B must not change `activeProjectId`.

### 11.3 Session memory consequence

Sessions stay per agent (`memory/Session/`, `memory/Daily/`), unchanged. Two bots can never share a
session because two bots can never share a project in v1. An agent reached from both Telegram and
Studio web chat continues to share one session, which is existing, intended behavior.

## 12. Management Commands Per Bot

In a `pinned` bot's chat:

- `/agents` lists and switches **that bot's target agent** by writing `profile.agentId`. It must
  not write `project.activeAgentId` and must not touch `activeProjectId`. The picker header names
  the project so the operator can see where they are.
- `/projects` does **not** switch anything. It replies with the binding
  (`This chat is bound to project <id>. Target agent: <id>.`) plus the one CLI line to rebind.
  Rationale: the entire point of this feature is that a chat has a fixed project.
- `/whoami` (new) prints bot id, `@username`, project, target agent, provider/model, pairing time.
- `/session_reset` resets the resolved agent's session, not the global active agent's.
- `/stop` is unchanged in behavior, but lane-scoped by `botId` too.
- `/workflow_notifications on|off|status` writes `profile.notifyWorkflowProgress`.

In a `floating` bot's chat, `/projects` and `/agents` keep today's global-switch behavior exactly.

Callback data stays short to respect Telegram's 64-byte limit. `agt:use:<agentId>` is already
unqualified and is resolved against the lane's bot, so no new prefix is needed; `prj:use:*` is only
emitted by floating bots.

## 13. CLI Surface

New namespace, additive:

```
opencolab telegram bot add     --token <value> [--id <slug>] --project <id> [--agent <id>] [--floating]
opencolab telegram bot list    [--json]
opencolab telegram bot show    --id <bot>
opencolab telegram bot bind    --id <bot> --project <id> [--agent <id>|--agent-auto]
opencolab telegram bot pin     --id <bot>          # floating -> pinned, keeps current project
opencolab telegram bot unbind  --id <bot>          # pinned -> floating
opencolab telegram bot enable  --id <bot>
opencolab telegram bot disable --id <bot>
opencolab telegram bot remove  --id <bot> [--keep-token]
opencolab telegram bot pair    --id <bot> [start|complete --code <code>]
opencolab telegram bot test    --id <bot>          # getMe + one sendMessage to the paired chat
opencolab telegram commands sync [--id <bot>|--all]
```

`add` sequence, all-or-nothing:

1. validate flags; derive `id` from the `getMe` username when `--id` is absent
2. `getMe` with the supplied token; on failure print the Telegram error and persist nothing
3. check invariants from section 7.2 (one bot per project, unique token var, unique Telegram bot id)
4. write the token to `.env.local` under the derived `tokenEnvVar`
5. persist the profile with `paired: false`
6. `setMyCommands` / `setChatMenuButton` for the new bot
7. print the `t.me/<username>` link and the next step (pairing)

Preserved for compatibility, as aliases over the `default` bot:

- `opencolab setup telegram --bot-token --chat-id`
- `opencolab setup telegram pair start|complete`
- `opencolab setup telegram commands sync`
- `opencolab setup telegram workflow-notifications on|off|status`

`opencolab setup telegram status` (and `project show`) must list every bot with project, target
agent, pairing state, token presence, and scope — with one explicit line when a bot is still
`floating`, because that is the upgrade default and the operator needs to know why their chat still
follows the global project.

## 14. Pairing Per Bot

Pairing stays mandatory and becomes per bot. `startPairing` / `completePairing`
(`src/gateway.ts:361,410`) take a `botId` and read/write that profile's pairing fields.

- the code is sent through that bot's token to that bot's `chatId`
- a pending code on bot A is independent of bot B
- the handshake flow (`waitForTelegramHandshake`, `src/telegram-poller.ts:204`) takes a token and
  must not run while that bot's poller is active, for the same 409 reason as today; the existing
  conflict message gains `bot=<id>`
- `completePairing` must reject a code that belongs to a different bot

## 15. Concurrency And Lanes

Lane key becomes `botId + "|" + chatId + "|" + (messageThreadId ?? "")`.

Separately, serialize per resolved agent. Two different bots cannot target the same agent in v1
(one bot per project, and an agent belongs to one project), but Telegram and web chat and
heartbeat can all reach one agent. Today `isAgentBusy(projectId, agentId)`
(`src/gateway.ts:915`) is only consulted by the heartbeat tick. Requirement: a routed Telegram turn
must not start while the same agent has a turn in flight; it queues on an
`(projectId, agentId)` keyed queue. Shared `memory/Session/` files make overlapping turns on one
agent unsafe, and multi-bot traffic makes the overlap likely rather than theoretical.

Different bots on different projects run fully in parallel.

## 16. Heartbeat Delivery

`runHeartbeatTick` already iterates all projects. Delivery becomes project-addressed:

- `sendHeartbeatDigest(botCtx, text)` and `openHeartbeatLiveStatus(botCtx, projectId, agentId, provider)`
  take the bot resolved from the project
- resolution: the enabled, paired, token-present bot whose `projectId` matches; for floating bots,
  match only when the project is the active one
- when no bot owns the project, the digest is **skipped** and a single line is logged
  (`heartbeat digest skipped: no telegram bot bound to project <id>`)

This is a behavior change: today a heartbeat in any project lands in the one chat. The spec takes
the change deliberately — delivering project A's digest into project B's chat is the bug this
feature exists to remove. Status output must therefore show, per project, which bot will receive
its heartbeats and workflow notifications, so a missing binding is visible before it is silent.

## 17. Workflow Notification Delivery

`createTelegramWorkflowNotifierFactory` becomes project-aware. `WorkflowService` instances are
already per project (`src/runtime.ts:1213`), so the factory for project P resolves P's bot once per
run and returns `null` when there is none, when it is unpaired, or when
`profile.notifyWorkflowProgress` is false. The notifier's live-status session is constructed with
that bot's context and that bot's `lastMessageThreadId`.

## 18. Ignite Flow

`configureTelegram` (`src/ignite.ts:358`) becomes per-project and runs after project selection.

- if the selected project already has a bot: show it, offer reconfigure, skip by default
- otherwise: BotFather guidance (unchanged copy, `src/ignite.ts:108`), token prompt,
  `getMe`, bind to the selected project as `pinned`, then the existing handshake pairing
  (`src/ignite.ts:371`) scoped to that bot
- when the install has a migrated `floating` bot and the operator is igniting a second project,
  offer once to pin the existing bot to its current project, so the two chats stop competing
- the summary block (`src/ignite.ts:168`) lists each bot as `@username -> project (agent)`

## 19. Command Menu Sync

`syncTelegramBotCommands` takes a bot context and syncs that bot only; `--all` iterates.
`autoSyncTelegramCommandsIfConfigured` (`src/cli.ts:1486`) iterates every configured bot and
reports per-bot results without aborting the whole sync on one failure.

The command list is per scope:

- pinned bots publish `/agents`, `/whoami`, `/session_reset`, `/stop`, `/workflow_notifications`
- floating bots additionally publish `/projects`

## 20. OpenColab Studio

`src/web/server/health.ts:70-73` and `src/web/shared/types.ts:155` currently expose one
`telegram: { paired, pendingPairing, chatPresent }`.

Change to a list, keeping the scalar as a deprecated projection of the default bot for one release:

```ts
telegramBots: Array<{
  id: string;
  username: string | null;
  projectId: string | null;
  agentId: string | null;
  scope: "pinned" | "floating";
  enabled: boolean;
  paired: boolean;
  pendingPairing: boolean;
  tokenPresent: boolean;
}>
```

No chat ids, no tokens. `docs/web_interface_spec.md` is updated in the same change.

## 21. Security Requirements

- tokens only in `.env.local`, one key per bot, written through `writeSecretToLocalEnv`
- `opencolab.json` holds `tokenEnvVar` only; a raw-looking token value found in a profile field is
  rejected at normalization with a clear error rather than being used
- no cross-bot token fallback, ever
- `getMe` validation before persisting a binding; no partial binds
- a token entered as a chat message is never accepted; the bind path is CLI-only
- bot tokens absent from live status, session logs, `MEMORY.md`, prompt context, and error text
  surfaced to Telegram
- `remove --id` deletes the profile and, unless `--keep-token`, removes its `.env.local` key, and
  prints the BotFather `/revoke` reminder
- per-bot chat authorization stays strict equality against `profile.chatId`; one trusted chat per
  bot in v1

## 22. Failure Modes And Diagnostics

Every one of these must produce a log line that names the bot and, where applicable, a single
plain-language Telegram reply. None may fall back to another bot or to the active project.

| condition | behavior |
| --- | --- |
| token missing | bot skipped; status shows `token missing (<ENV_VAR>)`; no Telegram call |
| token invalid / revoked | poller for that bot stops with a named error; others continue |
| `getUpdates` 409 | named error identifying the bot and the likely second consumer |
| unknown `botId` on webhook | `404 unknown_bot`, nothing sent |
| message from an unpaired chat | that bot's pairing instruction |
| bound project deleted | bot auto-disabled at normalization, reported as `orphaned` |
| pinned agent deleted | one-turn fallback to `activeAgentId` plus an in-chat note |
| two bots bound to one project | rejected at bind time, naming the existing bot |
| duplicate `tokenEnvVar` or Telegram bot id | rejected at bind time |

## 23. Rollout Phases

Each phase is independently shippable and leaves the tree green.

1. **Schema and migration.** `TelegramBotProfile`, `telegramBots`, `CURRENT_VERSION = 3`,
   normalization, invariants, v2 -> v3 migration producing one `floating` bot, `state.telegram`
   projection. No behavior change. Tests in `tests/project-config.test.ts`.
2. **Bot context in transport.** Replace `state` with `TelegramBotContext` across the senders,
   `postTelegramJson`, `TelegramLiveStatusSession`, and the notifier. Still one bot at runtime.
   No behavior change.
3. **Operator provisioning.** `opencolab telegram bot *`, `getMe` validation, per-bot token
   storage, per-bot `setMyCommands`, status output. Bots can be created but are not yet routed.
4. **Multi-poller ingestion.** One poller per enabled bot, `botId`-tagged updates, per-`botId`
   webhook path, supervisor re-reading the registry.
5. **Bot-scoped routing.** Per-bot authorization and pairing, target resolution, explicit
   `respondFor`, agent-path-scoped conversation memory, `botId` in the lane key, per-agent
   serialization. This is the phase that delivers the feature.
6. **Per-bot commands.** `/agents` writing `profile.agentId`, `/projects` becoming informational on
   pinned bots, `/whoami`, per-bot workflow-notification toggle.
7. **Project-addressed notifications.** Heartbeat digests and workflow notifiers resolved by
   project. Status output showing which bot owns each project's notifications.
8. **Ignite and docs.** Per-project Telegram step, offer to pin the migrated bot, promote this
   spec into `docs/spec.md`, sync `README.md` and `AGENTS.md`.
9. **Cleanup, one release later.** Remove `state.telegram`, `resolveTelegramBotToken()`, and the
   Studio scalar projection.

## 24. Acceptance Criteria

1. Two bots, two projects: a message to bot A is answered by project A's target agent and a
   message to bot B by project B's, with no `/projects` switch and no change to `activeProjectId`.
2. The two chats never cross-deliver: A's replies, live status, files, heartbeat digests, and
   workflow notifications all land in A's chat only.
3. `/agents` in A's chat changes only A's target agent; B's target agent and
   `project.activeAgentId` are untouched.
4. `/projects` in a pinned chat reports the binding and changes nothing.
5. Conversation memory for a turn in A's chat is written under project A's target agent's
   directory, with no entry under the globally active agent.
6. Two bots can run turns concurrently; two turns on one agent serialize.
7. `/stop` in A's chat stops only A's in-flight run.
8. Upgrading an existing single-bot install changes nothing observable: same chat, still paired,
   same routing, no re-pairing, no manual file edit, and `TELEGRAM_BOT_TOKEN` still honored.
9. Pinning the migrated bot takes one CLI command and does not require re-pairing.
10. A bot with a missing or invalid token is skipped and reported, and never borrows another bot's
    token.
11. `opencolab.json` contains no token values; every bot shows a `tokenEnvVar` only.
12. Status output names, per project, which bot receives its heartbeats and workflow notifications,
    and says `none` when there is no binding.
13. Removing a bot leaves the other bots fully working.

## 25. Test Plan

- `tests/project-config.test.ts` — v2 -> v3 migration (with and without a configured chat),
  idempotence, invariant rejection, orphan auto-disable, three-way merge with concurrent bot
  add/remove, `state.telegram` projection fidelity.
- `tests/telegram-poller.test.ts` — per-bot offsets, `botId` tagging, one bot failing without
  stopping others, supervisor start/stop on registry change, 409 message naming the bot.
- new `tests/gateway-routing.test.ts` — per-bot authorization, pinned/floating target resolution,
  deleted project and deleted agent paths, conversation memory written to the resolved agent path,
  lane isolation across bots, per-agent serialization, `/agents` writing `profile.agentId`,
  `/projects` being inert on a pinned bot.
- `tests/runtime.test.ts` — heartbeat digest routed to the owning project's bot and skipped with a
  log when unbound; workflow notifier resolved per project.
- `tests/cli.test.ts` — `telegram bot add/bind/pin/list/remove`, invariant errors, token written to
  the right env key, legacy `setup telegram` aliases still operating on the default bot.
- `tests/secrets.test.ts` — per-bot env key derivation and validation, no cross-bot fallback.
- `tests/ignite.test.ts` — per-project Telegram step, the pin-the-migrated-bot offer.

Existing gateway tests that construct senders with `state` need the `TelegramBotContext` swap; that
is the bulk of the mechanical test churn and lands in phase 2.

## 26. Documentation To Update

Per `AGENTS.md`, `docs/spec.md` changes first, then the rest in the same change:

- `docs/spec.md` — section 6 (pairing becomes per bot), section 8 (commands become bot-scoped),
  section 10 (`telegramBots` in the persisted shape, `telegram` marked deprecated),
  section 13.11 (heartbeat delivery addressing)
- `README.md` — multi-bot quickstart and the `opencolab telegram bot` reference
- `AGENTS.md` — the Telegram routing contract line and the `src/gateway.ts` / `src/telegram-poller.ts`
  descriptions
- `docs/web_interface_spec.md` — health payload shape
- `docs/multi_bot_telegram_spec.md` — note that the registry and bot-context layers are specified here
- `docs/telegram_pair_handshake_spec.md` — per-bot handshake scoping
- `CHANGELOG.md`

## 27. Open Questions

1. Should `floating` survive past the cleanup release, or should everything be pinned and
   `/projects` disappear from Telegram entirely? Keeping it is purely a migration affordance.
2. Should a project be allowed more than one bot (for example a private operator chat plus a
   shared group)? v1 says no; lifting it means `chatId` becomes a list and the "one bot per
   project" invariant becomes "one bot per project per chat".
3. Should an unbound project's heartbeat digest fall back to a designated default bot instead of
   being dropped? A `--fallback-bot` setting would be easy, but it reintroduces cross-project
   delivery.
4. Should `agentId` default to pinned-on-first-use (sticky) rather than tracking
   `project.activeAgentId`? Sticky is more predictable in chat; tracking keeps CLI and Telegram
   agreeing.
5. Should Studio expose bind/unbind, or stay read-only on the registry as it is for the rest of
   state?

## 28. Recommendation

Ship phases 1-5 as one release and stop there. That is the whole user-visible ask: a bot per
project, answered by that project's principal agent, with the existing chat untouched by the
upgrade. Phases 6-7 are the follow-up that makes notifications stop crossing projects, and the
mention-routing work in `docs/multi_bot_telegram_spec.md` only becomes tractable once the registry
and bot-context layers from phases 1-2 exist.

The two choices that matter most and should not be traded away for convenience:

- **`botId` comes from the transport, never from the payload.** Trusting the update body to say
  which bot it belongs to would make chat authorization spoofable.
- **No cross-bot token or project fallback.** Every fallback in this subsystem converts a visible
  misconfiguration into a message delivered to the wrong chat, which is exactly the failure this
  feature is meant to eliminate.
