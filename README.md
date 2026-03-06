# 🐙 OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

_Accelerating Scientific Discovery_ — Turn one researcher into an always-on autonomous research lab that investigates, builds, and publishes.

## Coming Features

- Deep research workflows for scientific papers
- LaTeX-format paper generation
- Run experiments on Google Colab notebooks or external GPU servers
- Agent collaboration across providers: OpenAI, Anthropic, Google, xAI, and more

**Note:** OpenColab is an early-stage, actively evolving project. Features and documentation are rapidly improving—feedback and contributions are welcome!

It combines strategic guidance, parallel investigation, and rigorous synthesis so ideas can move from hypothesis to evidence faster.
The vision is an always-on lab where the research-agent expert group leads execution with discipline, while the human defines initial goals and supports with coordination, key decisions, and key activities.

Check [docs/VISION.md](docs/VISION.md) to see project direction.

## Why?

Great research is not only intelligence. It needs structure: clear guidance, parallel investigation, rigorous synthesis, and human judgment at critical moments.

Default collaboration model:

- the human defines the initial problem, goals, and constraints
- before deep research, agents clarify the human's true intention for the topic
- the agent group refines framing, runs investigation, and iterates
- the agent group is the expert and does not offload expert reasoning; the human assists coordination, key decisions, and key activities

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
- Telegram bot token (stored in `.env.local` as `TELEGRAM_BOT_TOKEN`)
- OpenAI Codex CLI or Claude Code CLI + provider API key (stored in `.env.local` as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) (or mock mode)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash
```

The installer clones OpenColab to `~/.opencolab`, creates `~/.local/bin/opencolab`, and updates your shell PATH profile when needed.
On macOS, if `opencolab` is not immediately available, run:

```bash
source ~/.zprofile
```

## Quickstart (Recommended)

Run interactive first-run setup (state initialization, project, model/provider, Telegram, pairing, and optional extra agent):

```bash
opencolab ignite
```

`ignite` initializes state and default project/agent files automatically.
`AGENTS.md` is seeded from an internal essential researcher template.
That template defaults to a workflow where the human defines the initial problem, the agents clarify true intent before deep research, and the human supports the expert agent group as an assistant.
Fresh initialization defaults the active project provider to `anthropic` with model `claude-opus-4-6`.
Provider setup asks for provider, model, and API key value; `ignite` writes keys to `.env.local` automatically.
If a provider key already exists in `.env.local`, `ignite` detects it and lets you keep or update it.
`ignite` handles the main first-run setup (project, model/provider, Telegram, command sync, and optional pairing/extra agent).
If you need to adjust settings later, rerun `ignite` or use `setup`, `project`, and `agent` commands directly.
During `ignite`, press `Esc` to skip the current step and continue with the next one.

Start local gateway server:

```bash
opencolab gateway start --port 4646
```

## Hacky Manual Run (git clone + node)

If you prefer not to use the installer command shim:

```bash
git clone https://github.com/jimezsa/opencolab.git
cd opencolab
pnpm install
pnpm run build
node dist/src/cli.js ignite
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

Secret values are stored in `.env.local` and should not be committed to git.
`opencolab.json` stores only non-secret runtime state.

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
