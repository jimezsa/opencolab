# OpenColab Multi-Bot Telegram V2 Draft

## 1. Status

This document is a design draft for a multi-bot Telegram architecture in OpenColab.

It is intentionally separate from the current runtime contract in `docs/spec.md`.
Nothing in this file is normative for the existing OpenColab runtime until the design is promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Purpose

OpenColab v1 models Telegram as one shared bot configuration and one active Telegram-routed agent inside the active project.

The next step is a project-local agent group that can appear in one Telegram group as multiple distinct bot profiles:

- one lead professor bot
- multiple specialist PhD bots
- optional future provider/runtime variants such as Codex, Gemini CLI, Claude Code, or `pi`

The operator should be able to:

- create Telegram bots manually through BotFather
- bind each bot token to an OpenColab agent through the OpenColab CLI
- run a project where `professor` is the default public coordinator
- allow specialists to reply only when explicitly mentioned with `@username`
- preserve one shared project memory layer across all agents while keeping agent-local memory intact

## 3. Product Position

The design should follow this principle:

`multiple Telegram bot identities != multiple independent systems`

OpenColab should remain one control plane.

Telegram bot profiles are user-facing identities for project agents, not separate orchestration silos.

Examples:

- `@professor_bot` may run on Codex and act as the public lead
- `@vision_phd_bot` may run on Gemini CLI for multimodal tasks
- `@systems_phd_bot` may run on Claude Code for synthesis-heavy work
- a future `@xai_phd_bot` may run through `pi`

All of them still belong to one OpenColab project, one shared project context, and one routing/control layer.

## 4. Why V2 Is Needed

The current repository contract is intentionally simpler:

- one shared Telegram configuration
- one active project
- one active agent inside that project
- one Telegram inbound message routed to one active agent runtime

That model is sufficient for single-bot operation, but it is not sufficient for a group chat where multiple distinct bots should coexist with different reply policies.

The v2 design must therefore introduce:

- a per-bot registry instead of one shared bot config
- mention-aware routing instead of one active Telegram-routed agent
- project-shared memory in addition to agent-local memory
- provisioning rules for specialist creation and bot assignment
- stronger loop prevention and group-chat throttling

## 5. Goals

The multi-bot design should:

- let one project expose multiple Telegram bot identities in the same group
- keep `professor` as the canonical lead agent per project
- make `professor` the default responder for ordinary unmentioned human messages
- make specialist bots respond only when explicitly mentioned by their Telegram usernames
- allow professor to create or request new specialist agents when the user asks or when specialization is justified
- require the operator to bind bot tokens through the OpenColab CLI rather than through normal chat
- keep secrets out of prompts, logs, memory files, and Telegram transcripts
- give all project agents access to curated shared project memory
- preserve existing per-agent session and durable memory patterns
- keep the public Telegram group readable and low-noise

## 6. Non-Goals For The First Multi-Bot Release

The first multi-bot release should not attempt to support:

- fully autonomous bot swarms talking freely in the public group
- dynamic Telegram bot creation through BotFather by agents
- multi-user access control beyond the current trusted chat model
- public multi-turn debates between several specialist bots on every user message
- automatic secret handoff through ordinary conversation
- replacing OpenColab's per-agent memory with one giant shared transcript

## 7. Core Principles

### 7.1 One Control Plane

OpenColab remains the source of truth for:

- project state
- agent definitions
- bot-to-agent mappings
- provider/runtime configuration
- shared project memory
- agent-local memory
- Telegram routing policy
- progress relays

### 7.2 Public Simplicity, Private Coordination

The public group should stay readable.

That means:

- the human normally talks to professor
- specialists reply only when directly invited by `@mention`
- inter-agent coordination should be internal by default, not public
- when several agents contribute, professor should usually synthesize

### 7.3 Secrets Never Travel As Normal Conversation

Bot tokens are operator secrets.

They must not be treated as normal conversational content.
They must be entered through CLI setup flows and stored via OpenColab secret handling only.

## 8. High-Level Architecture

The routing model should become:

`Telegram Group -> Matching Bot Identity -> OpenColab Router -> Target Agent -> Provider Runtime`

The shared coordination model should become:

`Agent -> OpenColab Internal Delegation -> Other Agent -> Result Back To Originating Agent`

The memory model should become:

`Project Shared Memory + Agent Local Memory + Current Message Context`

Important distinction:

- Telegram bot identity decides who is allowed to speak publicly
- OpenColab agent identity decides who reasons, stores memory, and owns the task

In most cases they should map one-to-one, but routing and orchestration still belong to OpenColab.

## 9. Core Concepts

### 9.1 Bot Profile

A `BotProfile` is one real Telegram bot identity created manually by the operator in BotFather and later bound into OpenColab.

It should describe:

- Telegram bot username
- token secret reference
- mapped agent id
- project membership or scope
- enabled status
- reply policy

### 9.2 Agent Public Identity

An agent may have:

- one internal OpenColab id such as `professor`, `vision_phd`, or `systems_phd`
- one mapped Telegram bot profile such as `@opencolab_professor_bot`

The Telegram username is the public trigger surface.
The agent id is the stable local system identity.

### 9.3 Project Shared Memory

Project shared memory is curated context visible to all agents in the project.

It should capture:

- project goal
- project constraints
- current participants
- each participant's role
- each participant's main contribution
- stable human preferences relevant to the whole project
- major current workstreams

It should not store:

- raw secrets
- full Telegram transcripts
- high-volume scratch reasoning
- every temporary observation from every agent run

### 9.4 Agent Local Memory

Agent-local memory remains responsible for:

- active session tail
- previous-day per-agent summary
- durable facts specific to that agent's work

The v2 design adds shared memory.
It does not remove per-agent memory.

## 10. Bot Registry

The current single shared Telegram config should evolve into a bot registry.

The registry should support:

- one or more bot profiles available to the installation
- mapping each bot profile to exactly one agent
- operator-facing enable and disable controls
- validation status
- scoped reply policy

Suggested minimum stored metadata:

- `botId`
- `agentId`
- `telegramUsername`
- `tokenEnvVar`
- `enabled`
- `defaultResponder`
- `replyMode`
- `boundAt`
- `lastValidatedAt`

Suggested reply modes:

- `default_public`
- `mention_only`
- `disabled`

Recommended rules:

- exactly one bot per project should be marked as the default public responder
- that bot should normally be professor
- specialists should default to `mention_only`
- one bot token should never be shared across multiple agents

## 11. Routing Rules

### 11.1 Human To Bots In The Group

Default policy:

- if the human sends a normal group message without agent mention, only professor replies
- if the human mentions exactly one specialist bot, only that specialist replies
- if the human mentions professor and a specialist together, professor owns the public reply and may internally delegate
- if the human mentions multiple specialists without professor, the router should prefer professor as coordinator instead of allowing several public replies

This policy keeps the group coherent and avoids a noisy multi-bot thread.

### 11.2 Specialist Visibility Policy

Specialists should not respond to ordinary group traffic just because they can see it.

Specialists should respond only when:

- directly mentioned by `@username`
- explicitly targeted by a professor-directed handoff policy
- addressed in a private bot chat if such a mode is enabled later

### 11.3 Bot-To-Bot Interaction

Any agent may ask another agent for help, but the default path should be internal delegation, not public bot conversation in the Telegram group.

The public group should not become a place where bots repeatedly mention one another in visible loops.

Recommended v2 rule:

- one public handoff is allowed only when the handoff itself is useful for the human to see
- ordinary specialist consultation should be internal
- professor should remain the default public synthesizer

### 11.4 Loop Prevention

The router must prevent:

- bot mention cycles
- repeated professor-specialist-professor ping-pong
- several specialists all replying to the same message independently
- recursive delegation chains without a clear owner

Minimum guardrails:

- one public owner per inbound human message
- bounded internal delegation depth
- cycle detection on agent call graph per task
- per-agent concurrency limits

## 12. Shared Memory Model

The project should gain a shared memory layer under project scope.

Suggested initial layout:

- `projects/<project_id>/PROJECT.md`
- `projects/<project_id>/TEAM.md`
- `projects/<project_id>/memory/Shared/Daily/<YYYY-MM-DD>.md`

Suggested responsibilities:

- `PROJECT.md`: goal, scope, constraints, key decisions, current direction
- `TEAM.md`: humans, agents, bot usernames, specialties, main contribution areas
- shared daily note: important evolving project-level state worth carrying across agents

Recommended ownership:

- all agents may read shared memory
- professor is the default curator of stable shared memory
- specialists may propose updates, but shared memory should not become a free-for-all scratchpad

## 13. Prompt Context Rules

Prompt construction should evolve from:

- agent-local docs
- agent-local recent session memory

to:

- shared project memory
- agent-local docs
- agent-local recent session memory

Recommended loading order:

1. project shared memory
2. agent identity and operating docs
3. agent-local durable memory
4. current-session working memory
5. current inbound message and attachments

Important rule:

Shared memory should be concise and curated.
OpenColab should not inject large shared transcripts into every agent prompt.

## 14. Professor-Led Specialist Provisioning

Professor should be aware that specialist creation is a normal OpenColab workflow.

Professor may decide that a new specialist is needed when:

- the user asks for it
- repeated expertise gaps appear
- a long-running project benefits from stable specialization

The provisioning flow should be:

1. professor decides a specialist is justified
2. professor requests or triggers `opencolab agent create`
3. the operator configures provider/runtime through CLI
4. the operator binds a Telegram bot token through CLI
5. OpenColab validates the bot and updates the bot registry
6. professor updates shared project memory and roster

Important constraint:

Professor may create the OpenColab agent identity automatically, but Telegram bot creation itself remains a manual BotFather step performed by the operator.

## 15. Bot Token Provisioning And Security

The accepted workflow should be:

1. operator creates a bot in BotFather
2. operator runs a dedicated OpenColab CLI command to bind the token to an agent
3. OpenColab validates the token with Telegram
4. OpenColab stores the token in `.env.local` or equivalent secret storage
5. state stores only metadata and a secret reference, never the raw token

Security requirements:

- bot tokens must never be entered in public group chats
- bot tokens must never be appended to agent session memory
- bot tokens must never be written into `MEMORY.md`, shared project memory, or general prompt context
- bot tokens must be masked in operator-facing status output
- failed validation must not partially bind a broken bot profile

Recommended operator ergonomics:

- after binding, OpenColab should fetch and store the real Telegram bot username
- the operator should not need to type the username manually
- the CLI should make it obvious which bot is mapped to which agent

## 16. Runtime Diversity Per Agent

Each agent should continue to own its own provider/runtime configuration.

The multi-bot design should support combinations such as:

- professor on Codex
- one specialist on Gemini CLI
- one specialist on Claude Code
- one specialist on `pi`

Provider/runtime diversity should remain an agent-level concern, not a Telegram-layer concern.

Telegram routing should choose the agent.
The selected agent's provider/runtime config should choose the execution engine.

## 17. Group Chat UX Policy

The group chat should optimize for clarity over realism.

Recommended rules:

- professor is the normal public face of the project
- specialists speak when invited, not on every turn
- if a specialist performs substantial work, professor may either synthesize it or allow that specialist to post one final direct answer
- progress updates should remain bounded and stricter in groups than in one-to-one chats
- public bot-to-bot chatter should be rare and intentional

## 18. Proposed State Evolution

The v1 top-level shared Telegram config should evolve into a richer structure that can describe multiple bot bindings.

The exact shape can change during implementation, but the design should represent:

- installation-wide or project-scoped bot profiles
- bot-to-agent mapping
- default public responder per project
- reply mode per bot
- validation metadata

The design should also represent project-shared memory as a first-class concept instead of relying only on per-agent files.

## 19. Proposed Rollout Order

### Phase 1: Spec And Data Model

- define bot registry concepts
- define routing rules
- define shared project memory layout
- define security rules for token binding

### Phase 2: Operator Provisioning

- add CLI commands to bind, list, validate, unbind, and inspect bot profiles
- keep token entry operator-only
- validate real Telegram bot identity during binding

### Phase 3: Mention-Based Public Routing

- support professor default reply behavior
- support specialist mention-only behavior
- support deterministic conflict resolution when several bots are mentioned

### Phase 4: Shared Memory Injection

- add `PROJECT.md`, `TEAM.md`, and project shared daily summaries
- expose shared memory to all project agents
- keep update ownership curated

### Phase 5: Professor-Led Specialist Provisioning

- let professor propose or trigger specialist creation
- let the operator complete provider and bot binding steps
- update shared roster automatically after successful provisioning

### Phase 6: Internal Delegation

- support bounded internal agent-to-agent requests
- add loop prevention and run ownership rules
- keep public output synthesized and low-noise

## 20. Migration Principles

The multi-bot release should preserve existing v1 concepts where possible:

- `professor` remains the default lead agent id
- per-agent conversation history remains per-agent
- provider/runtime configuration remains per-agent
- project state remains the central source of truth

Migration should avoid:

- breaking single-bot projects unnecessarily
- exposing secrets in legacy logs
- forcing existing users into multi-bot mode immediately

## 21. Open Questions

Questions to resolve before promotion into the main spec:

- should the bot registry live at installation scope, project scope, or both
- should specialists be able to answer in private chats as well as group mentions
- should professor always synthesize multi-specialist work, or may a specialist reply directly after delegated work
- how much of shared memory should be writable by specialists
- whether one professor bot may coordinate across several projects or whether bot identity should remain project-local
- whether Telegram authorization should continue as one trusted chat only or evolve toward a richer chat allowlist model

## 22. Recommendation

The first implementation should stay disciplined:

- one professor bot as the default public responder
- specialist bots as mention-only participants
- operator-only CLI token binding
- curated project shared memory
- internal delegation by default instead of public bot debates

That version is much more likely to remain understandable, secure, and maintainable than a more theatrical multi-bot swarm design.
