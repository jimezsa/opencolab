# 🐙 OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-In%20Progress-orange?style=for-the-badge" alt="Project status: In progress">
  <img src="https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white&style=for-the-badge" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/pnpm-9%2B-F69220?logo=pnpm&logoColor=white&style=for-the-badge" alt="pnpm 9+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
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

```text
+---------------------+      +------------------------+
| Human (Assistant)   | ---> | Shared goals and plan  |
+---------------------+      | (human + agents)       |
                             +------------------------+
                                         |
                                         v
                             +------------------------+
                             | The Professor (Lead)   |
                             | coordinates execution  |
                             +------------------------+
                               /          |          |          \
                              v           v           v           v
                  +----------------+ +----------------+ +----------------+ +------------------+
                  | PhD Student A  | | PhD Student B  | | PhD Student C  | | Beginner Student|
                  | literature     | | experiments    | | synthesis/writ.| | naive questions |
                  +----------------+ +----------------+ +----------------+ +------------------+
                               \          |          /                               |
                                \         |         /                                v
                                 +--------v--------+                    +-------------------+
                                 | Feedback to     | <------------------| Noise to System   |
                                 | Human           |                    +-------------------+
                                 +-----------------+
```

Current minimalistic Architecture:

`Telegram -> Gateway -> Active Project -> Active Agent`

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

Provider runtimes are configured with non-interactive defaults so `claude` and `codex` can edit the active project workspace without waiting for terminal approval prompts.
Subagents also inherit access to the parent project workspace by default.

Start local gateway server:

```bash
opencolab gateway start --port 4646
```

`gateway start` runs as a background service by default on macOS/Linux.
Useful commands:

- `opencolab gateway status`
- `opencolab gateway logs`
- `opencolab gateway stop`
- `opencolab gateway restart --port 4646`

If you want to run it in the active terminal process:

```bash
opencolab gateway start --foreground true --port 4646
```

## Hacky Manual Run (git clone + node)

If you prefer not to use the installer command shim:

```bash
git clone https://github.com/jimezsa/opencolab.git
cd opencolab
pnpm install
pnpm run build
node dist/src/cli.js ignite
node dist/src/cli.js gateway start --foreground true --port 4646
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
`TOOLS.md` is initialized from a built-in tools scaffold that lists the available `fast-search`, `pro-search`, and `deep-search` skills with a short description and when to use each one.

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

Provider CLI command/args are stored per project and are auto-derived from internal defaults.

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
