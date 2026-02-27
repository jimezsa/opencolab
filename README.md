# OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab banner" />
</p>

OpenColab is a personal multi-agent AI research lab designed to help researchers and accelerate scientific discoveries.

It follows an academic collaboration model:

- a **Professor agent** guides strategy and synthesis
- multiple **Student agents** execute experiments in parallel
- Student agents can challenge the Professor with evidence-based disagreement
- the **Human researcher** supervises and approves key decisions

## What OpenColab Enables

- Parallel research execution across multiple agents.
- Structured collaboration: group chat, private chats, and regular meetings.
- Human access to the team over Telegram.
- Practical runtimes for agent work: local machine, SSH compute, and Google Colab workflows.
- Flexible code collaboration: per-agent GitHub repositories and shared team repositories.
- Scientific writing pipeline: agents generate LaTeX papers and the human coauthors directly.
- Human-visible logs, artifacts, discussions, and decisions.

## v1 Focus

- Keep architecture simple and local-first.
- Prioritize reliability, auditability, and human control checkpoints.
- Deliver a practical power tool before advanced autonomy.

## General Architecture

```mermaid
flowchart TB
  Human[Human Researcher]
  CLI[CLI]
  Web[Local Web UI/API]
  Telegram[Telegram Bridge]

  Human --> CLI
  Human --> Web
  Human --> Telegram

  subgraph ControlPlane[OpenColab Control Plane (Node.js/TypeScript)]
    Orchestrator[Orchestrator]
    Registry[Agent Registry]
    Collaboration[Chats + Meetings]
    Skills[SKILL Registry]
    RepoPaper[Repositories + LaTeX Paper Service]
    Checkpoints[Approval Checkpoints]
    Router[Task Router]
    Runner[Agent Runner]
    Adapters[Provider Adapters<br/>codex | claude_code | gemini]
  end

  CLI --> Orchestrator
  Web --> Orchestrator
  Telegram --> Orchestrator

  Orchestrator --> Registry
  Orchestrator --> Collaboration
  Orchestrator --> Skills
  Orchestrator --> RepoPaper
  Orchestrator --> Checkpoints
  Orchestrator --> Router
  Router --> Runner
  Runner --> Adapters

  Adapters --> Local[Local Compute]
  Adapters --> SSH[SSH Compute / GPU Hosts]
  Adapters --> Colab[Google Colab]

  Orchestrator --> SQLite[(SQLite)]
  Orchestrator --> FS[(Project Filesystem<br/>runs, logs, artifacts, chats, meetings, papers, repos)]
```

- Single-process local control plane orchestrates all workflows.
- Agents can run in parallel across different provider CLIs.
- All operational state is persisted locally in SQLite + filesystem artifacts.

## Getting Started

```bash
npm install
npm run build
node dist/src/cli.js setup
node dist/src/cli.js init
node dist/src/cli.js project create demo-lab
node dist/src/cli.js run start --project demo-lab --goal "Evaluate a new research idea"
node dist/src/cli.js run status <run_id>
```

First-time setup wizard (`opencolab setup`) guides you through:

- provider CLI command configuration
- default model args per provider
- API key input persisted in `opencolab.json`
- Telegram bot/chat configuration
- mock-vs-real execution mode

Run local web control UI:

```bash
node dist/src/cli.js web start --port 4646
```

## Telegram Bridge

After running `setup` with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, point Telegram to the local API webhook:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-public-url>/api/telegram/webhook"
```

If OpenColab is running locally, expose `http://127.0.0.1:4646` through a tunnel (for example `ngrok`) and use that public URL.

Supported Telegram commands:

- `/help` or `/start`
- `/agents`
- `/agent <agent_id>` (or `/agent clear`)
- `/ask <agent_id> <message>`
- `/run <run_id>` to set active run
- `/status [run_id]`
- `/approve [run_id]`
- `/pause [run_id]`
- `/stop [run_id]`

Plain text messages are routed to the active agent (if set with `/agent`), otherwise they are recorded as human input for the active run and mirrored to the run group chat log.

By default, v1 runs agent tasks in deterministic mock mode so the workflow works without installed CLIs.
Set `OPENCOLAB_FORCE_MOCK_CLI=0` to execute real CLI commands.

## Configure Provider CLIs

Add one template per provider CLI:

```bash
node dist/src/cli.js agent template add \
  --template-id tpl_openai_codex \
  --provider openai \
  --cli-command codex \
  --default-args "run" \
  --default-env "OPENAI_API_KEY=your_key"

node dist/src/cli.js agent template add \
  --template-id tpl_anthropic_claude \
  --provider anthropic \
  --cli-command claude_code \
  --default-env "ANTHROPIC_API_KEY=your_key"

node dist/src/cli.js agent template add \
  --template-id tpl_google_gemini \
  --provider google \
  --cli-command gemini \
  --default-env "GEMINI_API_KEY=your_key"
```

Create agent instances from those templates:

```bash
node dist/src/cli.js agent instance add \
  --agent-id professor_codex \
  --template-id tpl_openai_codex \
  --role professor

node dist/src/cli.js agent instance add \
  --agent-id student_claude_1 \
  --template-id tpl_anthropic_claude \
  --role student

node dist/src/cli.js agent instance add \
  --agent-id student_gemini_1 \
  --template-id tpl_google_gemini \
  --role student

node dist/src/cli.js agent list
```

Run using real provider CLIs:

```bash
OPENCOLAB_FORCE_MOCK_CLI=0 node dist/src/cli.js run start \
  --project demo-lab \
  --goal "Your research goal"
```

## Project Status

v1 baseline implementation is now included in `src/` with:

- local SQLite persistence
- parallel multi-agent orchestration
- CLI control surface
- local web control surface
- SKILLS directory support

Primary docs:

- [Product Spec](docs/spec.md)
- [Vision](docs/VISION.md)

## License

MIT. See [LICENSE](LICENSE).
