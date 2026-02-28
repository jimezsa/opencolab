# OpenColab v1 Multi-Project Specification

## 1. Purpose

OpenColab v1 is a minimal personal research assistant that supports multiple projects, each with its own agents, and exposes control through CLI and Telegram.

## 2. Product Scope

v1 supports:

- multiple local projects
- multiple agents per project
- one active project at a time
- one active agent inside the active project
- one provider runtime per project: `codex` or `claude_code`
- one user channel: Telegram
- one operator channel: OpenColab CLI

No parallel orchestration between agents/projects is included in this version.

## 3. Architecture

The runtime execution path is:

`Telegram -> Gateway -> Active Project -> Active Agent`

Definitions:

- `Project`: isolated workspace entry persisted in `opencolab.json`.
- `Agent`: assistant instance under a project, with prompt-definition files.
- `Gateway`: local service that validates Telegram pairing and routes messages to the active project/agent.

## 4. Core Capabilities

Required:

- Create/list/select projects from CLI.
- Create/list/select agents from CLI (scoped to selected project).
- Create/list/select projects from Telegram chat commands.
- Create/list/select agents from Telegram chat commands.
- Route Telegram messages to the selected project/agent runtime.
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

- main agent (`researcher_agent`): `projects/<project_id>/`
- additional agents: `projects/<project_id>/subagents/<agent_id>/`

Each agent directory must include:

- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md`

`MEMORY.md` remains reserved for long-term memory only.

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

- `opencolab init`
- `opencolab setup model`
- `opencolab setup telegram`
- `opencolab setup telegram pair`
- `opencolab project`
- `opencolab agent`

Responsibilities:

- configure provider for the active project
- configure one shared Telegram setup for all projects
- create/list/select projects
- create/list/select agents inside active project
- show active project/agent/provider status

## 8. Telegram Management Commands

Gateway must support project/agent management commands from authorized, paired chat.

Minimum supported commands:

- `/project create <project_id>`
- `/project use <project_id>`
- `/project list`
- `/agent create <agent_id>`
- `/agent use <agent_id>`
- `/agent list`

Messages that are not management commands are routed to the active agent.

## 9. Provider Constraints

Supported provider identifiers:

- `codex`
- `claude_code`

No `gemini` adapter in scope for v1.

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
      "activeAgentId": "researcher_agent",
      "agents": {
        "researcher_agent": {
          "id": "researcher_agent",
          "path": "projects/default",
          "files": {
            "agents": "AGENTS.md",
            "identity": "IDENTITY.md",
            "soul": "SOUL.md",
            "tools": "TOOLS.md",
            "user": "USER.md",
            "memory": "MEMORY.md"
          }
        }
      },
      "provider": {
        "name": "codex",
        "model": "<model-name>",
        "apiKeyEnvVar": "OPENAI_API_KEY"
      }
    }
  },
  "telegram": {
    "botTokenEnvVar": "TELEGRAM_BOT_TOKEN",
    "chatId": "<telegram-chat-id>",
    "paired": true,
    "pairedAt": "2026-02-27T00:00:00.000Z"
  }
}
```

Notes:

- secrets are referenced by environment variable names
- extra fields are allowed if they do not break the minimum contract

## 11. Message Handling Rules

- if chat is unpaired, gateway replies with pairing-required guidance
- if paired, gateway processes management commands first
- non-management text is sent to the active project/agent runtime
- while generating, gateway sends Telegram `typing` feedback
- responses are sent to the same chat

## 12. Acceptance Criteria

v1 is complete when all are true:

- CLI can create/select projects and agents.
- Telegram can create/select projects and agents.
- Active project routes to its active agent and provider runtime.
- `opencolab.json` persists active project, all project/agent configs, and one shared Telegram config.
- Main `researcher_agent` files are created in the project root and extra agents are created under `subagents/`.
