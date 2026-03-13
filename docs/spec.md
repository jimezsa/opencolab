# OpenColab v1 Multi-Project Specification

## 1. Purpose

OpenColab v1 is a minimal personal research assistant that supports multiple projects, each with its own agents, and exposes control through CLI and Telegram.

## 2. Product Scope

v1 supports:

- multiple local projects
- multiple agents per project
- one active project at a time
- one active agent inside the active project
- one provider runtime per agent: `openai`, `anthropic`, `gemini`, or `minimax`
- one user channel: Telegram
- one operator channel: OpenColab CLI

No parallel orchestration between agents/projects is included in this version.

## 3. Architecture

The runtime execution path is:

`Telegram -> Gateway -> Active Project -> Active Agent`

Definitions:

- `Project`: isolated workspace entry persisted in `opencolab.json`.
- `Agent`: assistant instance under a project, with prompt-definition files.
- `Human`: defines the initial problem, goals, and constraints, then supports the agent group as an assistant for key decisions and key activities.
- `Gateway`: local service that validates Telegram pairing and routes messages to the active project/agent.

## 4. Core Capabilities

Required:

- Create/list/select projects from CLI.
- Create/list/select agents from CLI (scoped to selected project).
- Create/list/select projects from Telegram chat commands.
- Create/list/select agents from Telegram chat commands.
- Route Telegram messages to the selected project/agent runtime.
- Route Telegram text and file messages (documents, photos, audio, video, voice, stickers, and related media) to the selected project/agent runtime.
- For inbound Telegram files, resolve the Telegram `file_id` to a local file inside the active project when possible, using collision-safe local filenames, and pass the local path to the agent runtime alongside metadata and caption text.
- Persist project/agent/provider settings plus one shared Telegram configuration in `opencolab.json`.

Not required in v1:

- web UI
- multi-user support
- background autonomous jobs
- cross-project concurrent execution

## 5. Filesystem Layout

Projects must live under:

- `projects/<project_id>/`

Each project must keep its agents under:

- default lead agent (`professor`): `projects/<project_id>/AGENTS/professor/`
- additional agents: `projects/<project_id>/AGENTS/<agent_id>/`
- shared skill library: `projects/SKILLS/`

Agent naming guidance:

- `professor` is the fixed default lead agent id for each project
- additional agents are PhD-style specialist agents
- additional agent ids should use memorable, descriptive names that reflect their specialty or work style
- additional agent ids do not need to follow a rigid `phd_*` naming scheme

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md`
- `USER.md`
- `TODO.md`
- `MEMORY.md`
- `SKILLS/` for agent-local skills

Shared project skills requirements:

- the repository must expose a shared `projects/SKILLS/` directory
- skills are shared across all agents and all projects and must not be duplicated per agent or per project
- each skill lives under `projects/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from the shared `projects/SKILLS/` directory before using a specialized workflow

Agent-local skills requirements:

- each agent may keep unique agent-local skills under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- agent-local skills are visible only to that agent by default because they live inside the agent folder
- each agent-local skill lives under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from both the shared `projects/SKILLS/` library and the agent-local `SKILLS/` directory when applicable

Initialization requirements:

- when an agent directory is created, `AGENTS.md` must be seeded from an internal runtime template
- when an agent directory is created, `BOOTSTRAP.md` must be seeded from an internal runtime template for first-run identity discovery
- when an agent directory is created, `IDENTITY.md` must be seeded from an internal runtime template
- when an agent directory is created, `TOOLS.md` must be seeded from an internal runtime template that lists the available `fast-search`, `pro-search`, and `deep-search` skills with only a short description and when-to-use guidance
- when an agent directory is created, an empty `SKILLS/` directory must exist for agent-local skills
- the built-in `fast-search`, `pro-search`, and `deep-search` skills must be available from the shared `projects/SKILLS/` directory
- default templates must encode: human defines the initial problem first, then assists agents while they refine and execute
- default templates must encode: before deep investigation, agents must clarify the human's true intention for the topic
- default templates must encode: agents are the expert role and should involve the human for key decisions and support tasks
- the default templates must keep only essential, role-appropriate instructions
- `TODO.md` must be used for active planning and task tracking based on interactions with the human and other agents

`MEMORY.md` remains reserved for long-term memory only.

OpenColab memory is split into three simple layers:

- working memory: current active session tail from the current UTC day only
- recent episodic memory: previous UTC day summary
- long-term semantic memory: curated stable facts in `MEMORY.md`

Each agent must also persist Telegram conversation history under:

- `projects/<project_id>/AGENTS/<agent_id>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- `projects/<project_id>/AGENTS/<agent_id>/memory/Daily/<YYYY-MM-DD>.md`

Requirements for session storage:

- session folders are created automatically on first message
- `YYYY-MM-DD.jsonl` uses current UTC date
- `/session reset` starts a new session folder for the active agent
- conversation logs must not be stored in `.opencolab`
- raw session logs are archival and must not be fed wholesale into provider prompts
- working memory should include only the recent turns from the active session and current UTC day
- recent episodic memory should include only the previous UTC day summary
- `MEMORY.md` should contain only durable facts, preferences, and recurring constraints
- `BOOTSTRAP.md` is onboarding scaffolding and should not be treated as permanent prompt context after initialization
- inbound Telegram files remain shared project resources and should be stored at project scope (for example under `projects/<project_id>/memory/TelegramInbox/`), not duplicated per agent

## 6. Telegram Pairing Flow

Pairing remains mandatory before regular routing.

Sequence:

1. Operator runs pairing start from CLI.
2. System sends short-lived code to the shared configured Telegram chat.
3. Operator completes pairing from CLI with the code.
4. Gateway enables trusted routing.

Requirements:

- code expiry (recommended 10 minutes)
- single-use code
- failed attempts do not enable routing
- non-paired chats are rejected

## 7. CLI Requirements

Required command groups:

- `opencolab ignite`
- `opencolab setup model`
- `opencolab setup telegram`
- `opencolab setup telegram pair`
- `opencolab gateway`
- `opencolab project`
- `opencolab agent`

Responsibilities:

- initialize state and default project/agent files when `ignite` runs
- configure provider for the active agent
- provider configuration must ask for provider and model, and must support provider auth mode selection when available
- `ignite` should offer curated concrete model options per provider; Gemini options must include `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, and `gemini-3-flash-preview`
- OpenAI and Gemini provider auth modes must support `api_key` and `oauth`
- in `api_key` mode, provider API keys must be persisted in `.env.local` using canonical env names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `MINIMAX_API_KEY`)
- in OpenAI `oauth` mode, setup must not require `OPENAI_API_KEY`
- in Gemini `oauth` mode, setup must not require `GEMINI_API_KEY`
- in OpenAI `oauth` mode, runtime preflight must verify Codex login state and return remediation guidance if login is missing
- in Gemini `oauth` mode, runtime must return remediation guidance when the CLI reports missing Google login or missing Gemini credentials
- provider CLI command/args must be auto-derived from internal defaults
- provider CLI defaults must support non-interactive execution with write access to the active project workspace
- when the active agent lives under `projects/<project_id>/AGENTS/<agent_id>/`, provider CLI defaults must still allow access to the parent project workspace
- provider defaults must use concrete model names, not floating aliases
- provider CLI execution timeout must default to 10 minutes and remain configurable via `OPENCOLAB_CODEX_TIMEOUT_MS`
- configure one shared Telegram setup for all projects
- Telegram token values must be persisted in `.env.local` under `TELEGRAM_BOT_TOKEN`
- create/list/select projects
- create/list/select agents inside active project
- show active project/agent/provider status
- `opencolab gateway start` should start a persistent background service by default and return immediately
- `opencolab gateway start --foreground` should run the gateway in the current terminal process
- `opencolab gateway` should support lifecycle commands: `start`, `stop`, `restart`, `status`, and `logs`
- on macOS, gateway background mode should be managed via user `launchd` agent
- on Linux, gateway background mode should be managed via user `systemd` service
- provide an interactive onboarding flow for first-time setup of project selection, provider/model, Telegram setup, and optional pairing
- `ignite` onboarding should allow skipping the current step with `Esc` and continue to the next step
- `ignite` onboarding should detect existing provider setup and allow keeping or updating it
- installer script should make `opencolab` available as a terminal command by installing a user-level shim and ensuring the user bin directory is on `PATH`

## 8. Telegram Management Commands

Gateway must support project/agent management commands from authorized, paired chat.

Minimum supported commands:

- `/project create <project_id>`
- `/project use <project_id>`
- `/project list`
- `/agent create <agent_id>`
- `/agent use <agent_id>`
- `/agent list`
- `/session reset`

Messages that are not management commands are routed to the active agent.

Menu alias compatibility (for Telegram slash command popup):

- `/project_list` -> `/project list`
- `/project_create <project_id>` -> `/project create <project_id>`
- `/project_use <project_id>` -> `/project use <project_id>`
- `/agent_list` -> `/agent list`
- `/agent_create <agent_id>` -> `/agent create <agent_id>`
- `/agent_use <agent_id>` -> `/agent use <agent_id>`
- `/session_reset` -> `/session reset`

## 9. Provider Constraints

Supported provider identifiers:

- `openai`
- `anthropic`
- `gemini`
- `minimax`

Provider/runtime notes:

- provider configuration is stored on each agent, not on the project
- provider config includes auth mode (`api_key` or `oauth` where supported)
- OpenAI and Gemini support `api_key` and `oauth` auth modes
- Anthropic and MiniMax are `api_key` only in v1
- some providers may reuse an existing CLI runtime instead of shipping a dedicated CLI
- `gemini` uses the `gemini` CLI runtime
- Gemini v1 scope is limited to Google login (`oauth`) or `GEMINI_API_KEY`; Vertex AI auth is out of scope
- `minimax` uses the `claude` runtime with MiniMax's Anthropic-compatible gateway

Planned provider-runtime expansion:

- the next provider expansion should separate provider identity from runtime identity so OpenColab can support providers that do not ship their own dedicated CLI
- the first shared fallback runtime should be `pi` from `pi-mono`
- `pi` integration should be modeled as a runtime layer, not as a replacement for explicit provider names
- the first new provider added through `pi` should be `xai`
- future pi-backed providers may include any provider/model combination supported directly by `pi` or by a user-managed pi custom model configuration

Planned runtime architecture:

- provider config should continue to store `name`, `model`, and `authMode`
- provider config should additionally store a runtime selector so OpenColab can distinguish native runtimes from shared runtimes such as `pi`
- native defaults should remain the default for providers with a well-supported dedicated CLI:
  - `openai` -> `codex`
  - `anthropic` -> `claude`
  - `gemini` -> `gemini`
  - `minimax` -> `claude` with Anthropic-compatible gateway env wiring
- providers without a native CLI should default to the `pi` runtime
- OpenColab must keep explicit provider names even when multiple providers share the same runtime so project state, setup UX, and auth handling remain clear

Planned `pi` integration requirements:

- `pi` must run in non-interactive mode for routed Telegram and CLI-triggered agent execution
- `pi` must be invoked from the active agent directory while still allowing access to the active project workspace
- OpenColab should remain the source of truth for project state, Telegram routing, memory files, and conversation logs
- OpenColab should avoid duplicating prompt context that `pi` already loads automatically from local context files
- runtime preflight must verify that the `pi` command is available on `PATH` before attempting execution
- runtime preflight must verify provider credentials required by the selected pi-backed provider before attempting execution
- model configuration for pi-backed providers should prefer runtime discovery when available and fall back to explicit manual model entry when discovery is unavailable or fails
- `xai` setup should use `XAI_API_KEY` as the canonical API key environment variable unless a later pi upstream change requires a different canonical variable
- OpenColab should treat pi sessions, extensions, themes, and other pi-local UX state as out of scope for initial integration unless they are required for non-interactive execution

Planned rollout order:

1. add config and runtime abstraction support for shared runtimes
2. add `xai` as the first pi-backed provider
3. add setup and onboarding support for pi-backed provider selection and model entry/discovery
4. add runtime preflight and operator-facing remediation messages for missing `pi` installation or missing provider credentials
5. evaluate broader support for additional pi-backed providers after `xai` is stable

## 10. Configuration Persistence (`opencolab.json`)

`opencolab.json` is the source of truth and must contain project and agent configuration.

Minimum shape:

```json
{
  "version": 1,
  "activeProjectId": "default",
  "projects": {
    "default": {
      "id": "default",
      "path": "projects/default",
      "activeAgentId": "professor",
      "agents": {
        "professor": {
          "id": "professor",
          "path": "projects/default/AGENTS/professor",
          "provider": {
            "name": "anthropic",
            "model": "<concrete-model-id>",
            "authMode": "api_key"
          },
          "files": {
            "agents": "AGENTS.md",
            "bootstrap": "BOOTSTRAP.md",
            "identity": "IDENTITY.md",
            "alma": "ALMA.md",
            "tools": "TOOLS.md",
            "user": "USER.md",
            "todo": "TODO.md",
            "memory": "MEMORY.md"
          }
        }
      }
    }
  },
  "telegram": {
    "chatId": "<telegram-chat-id>",
    "paired": true,
    "pairedAt": "2026-02-27T00:00:00.000Z"
  }
}
```

Notes:

- secret values are stored in `.env.local` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `TELEGRAM_BOT_TOKEN`)
- when OpenAI auth mode is `oauth`, `OPENAI_API_KEY` is optional
- when Gemini auth mode is `oauth`, `GEMINI_API_KEY` is optional
- `opencolab.json` must not store raw secret values or env-var secret references
- extra fields are allowed if they do not break the minimum contract

## 11. Message Handling Rules

- if chat is unpaired, gateway replies with pairing-required guidance
- if paired, gateway processes management commands first
- `/session reset` creates a new active session folder for the active agent
- non-management text and file messages are sent to the active project/agent runtime
- inbound Telegram file messages should preserve caption text and include attachment metadata in the user message passed to the agent
- when Telegram file download succeeds, attachments should be materialized under the active project (for example under `memory/TelegramInbox/`) with collision-safe local filenames and the agent input should include the local file path
- when Telegram file download fails or times out, routing should continue with caption text plus attachment metadata instead of dropping or indefinitely blocking the message
- while generating, gateway sends Telegram `typing` feedback
- responses are sent to the same chat
- when provider/runtime execution fails for a routed message, gateway replies in Telegram with a short failure notice instead of failing silently
- provider auth/runtime remediation guidance (for example missing Gemini OAuth login or missing API key) must be forwarded to the Telegram user when available
- polling mode must not retry the same failed Telegram update indefinitely once the runtime has consumed it
- agent responses may include `@telegram-file <json>` directives to send Telegram files:
  - example: `@telegram-file {"kind":"document","file":"<file_id_or_url>","caption":"optional"}`
- `setup telegram` should register Telegram bot commands via `setMyCommands` so slash-menu suggestions are available

## 12. Acceptance Criteria

v1 is complete when all are true:

- CLI can create/select projects and agents.
- Telegram can create/select projects and agents.
- Active project routes to its active agent and provider runtime.
- Provider runtimes can edit the active project workspace without interactive permission prompts.
- `opencolab.json` persists active project, all project/agent configs, and one shared Telegram config.
- The default `professor` agent is created under `projects/<project_id>/AGENTS/professor/`.
- Additional agents are created under `projects/<project_id>/AGENTS/<agent_id>/`.
- Agent conversation logs are saved in per-agent `memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`.
