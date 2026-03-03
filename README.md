# OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

OpenColab is a personal multi-agent AI research lab designed to help researchers and accelerate scientific discoveries.

## Why?

Great research is not only intelligence. It needs structure: clear guidance, parallel investigation, rigorous synthesis, and human judgment at critical moments.

Default collaboration model:

- the human defines the initial problem, goals, and constraints
- the agent group refines framing, runs investigation, and iterates
- the human then acts as an assistant to unblock execution and make key decisions

Architecture:

`Telegram -> Gateway -> Active Project -> Active Agent`

- multiple projects
- multiple agents per project
- one active project/agent at a time
- one provider runtime per project: OpenAI or Anthropic
- setup and control via CLI and Telegram commands
- persistence in `opencolab.json`

## Stack

- TypeScript (Node.js ESM)
- pnpm

## Requirements

- Node.js 22+
- pnpm 9+
- Telegram bot token (exported in env var)
- OpenAI Codex CLI or Claude Code CLI + provider API key env var (or mock mode)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash
```

## Quickstart

```bash
pnpm install
pnpm run build
```

Run an interactive, step-by-step first-run setup (state initialization, project, model/provider, Telegram, pairing, and optional extra agent):

```bash
node dist/src/cli.js ignite
```

`ignite` initializes state and default project/agent files automatically.
`AGENTS.md` is seeded from an internal essential researcher template.
That template defaults to a workflow where the human defines the initial problem, then supports the agent group as an assistant.
Fresh initialization defaults the active project provider to `anthropic` with model `claude-opus-4-6`.
`ignite` handles the main first-run setup (project, model/provider, Telegram, command sync, and optional pairing/extra agent).
If you need to adjust settings later, rerun `ignite` or use `setup`, `project`, and `agent` commands directly.
During `ignite`, press `Esc` to skip the current step and continue with the next one.

Start local gateway server:

```bash
node dist/src/cli.js gateway start --port 4646
```

During response generation, the gateway sends Telegram `typing...` feedback automatically.
Telegram inbound supports text plus file/media messages (document, photo, audio, video, voice, video note, animation, sticker).

Agent responses can send Telegram files with directive lines:

```text
@telegram-file {"kind":"document","file":"<file_id_or_url>","caption":"optional"}
```

Telegram webhook endpoint:

`POST http://127.0.0.1:4646/api/telegram/webhook`

## Project and Agent Commands

CLI:

- `opencolab project create --project-id <id>`
- `opencolab project use --project-id <id>`
- `opencolab project list`
- `opencolab project show`
- `opencolab agent create --agent-id <id> [--path <path>]`
- `opencolab agent use --agent-id <id>`
- `opencolab agent list`
- `opencolab agent show`

Telegram (paired and authorized chat):

- `/project create <project_id>`
- `/project use <project_id>`
- `/project list`
- `/agent create <agent_id>`
- `/agent use <agent_id>`
- `/agent list`
- `/session reset`

Telegram slash-menu aliases (for `/` popup command list):

- `/project_list`
- `/project_create <project_id>`
- `/project_use <project_id>`
- `/agent_list`
- `/agent_create <agent_id>`
- `/agent_use <agent_id>`
- `/session_reset`

## Agent Contract

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md`
- `USER.md`
- `TODO.md` (active plan and task list)
- `MEMORY.md` (long-term memory only)

`AGENTS.md` is initialized from a built-in essential researcher template.
`BOOTSTRAP.md` is initialized from a built-in first-run guide to help the agent discover identity and preferences.
`IDENTITY.md` is initialized from a built-in identity scaffold.

Default layout:

- main `researcher_agent`: `projects/<project_id>/`
- additional agents: `projects/<project_id>/subagents/<agent_id>/`

Conversation history layout:

- current session logs: `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- reset active session from Telegram with `/session reset`
- conversation logs are no longer written under `.opencolab`

## Configuration

`opencolab.json` stores runtime state:

- active project id
- projects map
- per-project agents map
- per-project provider config (`openai` or `anthropic`)
- shared Telegram settings and pairing state

Secrets are referenced by env var names and should not be committed to git.

## Development

```bash
pnpm run check
pnpm run build
pnpm test
```

## Inspiration

- openclaw: https://github.com/openclaw/openclaw
- nanoclaw: https://github.com/qwibitai/nanoclaw

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
