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

## Features

- ✅ Deep Research skills for paper search, grounded QA, figure extraction, summaries, and D2 block diagrams.
- ✅ Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- ✅⏳ Multi-project, multi-agent local workspace with CLI and Telegram control.
- ✅⏳ Run Experiment on external GPU servers(Runpod)
- ⏳ Coming: LaTeX-format paper generation.

**Note:** OpenColab is an early-stage, actively evolving project. Features and documentation are rapidly improving—feedback and contributions are welcome!

It combines strategic guidance, parallel investigation, and rigorous synthesis so ideas can move from hypothesis to evidence faster.
The vision is an always-on lab where the research-agent expert group leads execution with discipline, while the human defines initial goals and supports with coordination, key decisions, and key activities.

Check [docs/VISION.md](docs/VISION.md) for project direction and [docs/spec.md](docs/spec.md) for the concrete runtime contract.

<table align="center">
  <tr>
    <td align="center" width="120">
      <img src="docs/assets/codex-runtime.svg" alt="Codex runtime" width="42" height="42"><br>
      <strong>Codex</strong>
    </td>
    <td align="center" width="120">
      <img src="https://cdn.simpleicons.org/anthropic/191919" alt="Claude Code runtime" width="42" height="42"><br>
      <strong>Claude Code</strong>
    </td>
    <td align="center" width="120">
      <img src="https://cdn.simpleicons.org/googlegemini/4285F4" alt="Gemini CLI runtime" width="42" height="42"><br>
      <strong>Gemini CLI</strong>
    </td>
    <td align="center" width="120">
      <img src="docs/assets/pi-runtime.svg" alt="PI runtime" width="42" height="42"><br>
      <strong>PI</strong>
    </td>
  </tr>
</table>

## How It Works

```text
+-----------------------+
| Human (Assistant)     | <-------------|
+-----------+-----------+               |
            ^                           |
            |                           |
            v                           |
+-----------------------+               |
| Shared goals and plan |               |
+-----------+-----------+               |
            ^                           |
            |                           |
            v                           |
+-----------------------+      +------------------+
| Professor (Lead)      | <--> | Beginner Student |
| coordinates execution |      | naive questions  |
+-----------+-----------+      +--------+---------+
            ^                           |
            |                           v
            v
+-----------------------------------------------+
| PhD Students                                  |
| A: literature  B: experiments  C: synthesis   |
+-----------+-----------------------------------+
            ^
            |
            v
+-----------------------+
| Feedback to Human     |
+-----------------------+
```

Current runtime architecture:

`Telegram -> Gateway -> Active Project -> Active Agent -> Provider Runtime`

Remote experiment path:

`Telegram/CLI -> Active Project -> Active Agent -> Execution Target -> Remote Run`

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash
```

## Quickstart (Recommended)

Run interactive first-run setup:

```bash
opencolab ignite
```

Then start the local gateway:

```bash
opencolab gateway start --port 4646
```

`gateway start` runs as a background service by default on macOS/Linux. If you want to run it in the active terminal process, use:

```bash
opencolab gateway start --foreground true --port 4646
```

Useful follow-up commands:

```bash
opencolab upgrade
opencolab gateway status
opencolab project show
opencolab agent show
opencolab gpu server list
```

## Manual Run (git clone + Node)

If you prefer not to use the installer command shim:

```bash
git clone https://github.com/jimezsa/opencolab.git
cd opencolab
pnpm install
pnpm run build
node dist/src/cli.js ignite
node dist/src/cli.js gateway start --foreground true --port 4646
```

## Provider Setup and Auth

OpenColab configures provider CLIs for non-interactive runs inside the active project workspace. Each agent stores its own provider configuration, and long-running runs can stream bounded progress updates back through Telegram by default.

- `openai`: `api_key` with `OPENAI_API_KEY` or `oauth` with `codex login`
- `anthropic`: `api_key` with `ANTHROPIC_API_KEY`
- `gemini`: `api_key` with `GEMINI_API_KEY` or `oauth` with the `gemini` CLI login
- `minimax`: `api_key` with `MINIMAX_API_KEY`
- `xai`: `api_key` with `XAI_API_KEY` through the `pi` runtime
- Gemini-based shared tools still require `GEMINI_API_KEY` even when the active agent runtime uses another provider or Gemini OAuth
- `pageindex-grounded` uses `OPENAI_API_KEY` for the local PageIndex runner when the active agent runtime uses another provider or OpenAI OAuth

Common setup flows:

```bash
# Save a Gemini API key for built-in shared tools
opencolab setup api-key --provider gemini --api-key <your_gemini_key>

# Save an OpenAI API key for pageindex-grounded without changing the active provider runtime
opencolab setup api-key --provider openai --api-key <your_openai_key>

# OpenAI OAuth
codex login
opencolab setup model --provider openai --auth oauth --model gpt-5.3-codex

# Gemini OAuth
gemini
opencolab setup model --provider gemini --auth oauth --model gemini-2.5-pro

# xAI
opencolab setup model --provider xai --model grok-code-fast-1 --api-key <your_xai_key>
```

`pageindex-grounded` also expects `python3` and a local `tools/PageIndex` checkout when you actually run the skill.

If you want Gemini OAuth, install the CLI first:

```bash
npm install -g @google/gemini-cli
```

Provider CLI execution defaults to a 10 minute timeout. Override it in `.env.local` if needed:

```env
OPENCOLAB_CODEX_TIMEOUT_MS=600000
```

## Remote GPU with Runpod

OpenColab keeps remote GPU execution separate from the agent reasoning runtime. Providers still handle planning and coding; Runpod is only the remote experiment target.
For agent-driven remote GPU execution through OpenColab, use the shared `runpod-job` skill.

Common operator flow:

```bash
# Create or update a project-scoped Runpod target with ordered fallback locations and GPUs
opencolab gpu server add \
  --provider runpod \
  --server-id runpod-flex \
  --location US-KS-2,CA-MTL-1 \
  --gpu-type "NVIDIA A100 80GB PCIe,NVIDIA RTX 4090" \
  --gpu-count 1 \
  --volume-name default-runpod-flex \
  --volume-size-gb 200

# Validate local prerequisites and visible Runpod resources
opencolab gpu server test --server-id runpod-flex

# Launch a bounded remote job and wait for completion
opencolab gpu job start \
  --server-id runpod-flex \
  --command "python train.py --epochs 1" \
  --include projects/default,research \
  --artifact outputs/train.log,outputs/metrics.json
```

Important links:

| Topic | Link |
| --- | --- |
| Quickstart / manage Pods | [Manage Pods](https://docs.runpod.io/runpodctl/manage-pods) |
| GPU types | [GPU types reference](https://docs.runpod.io/references/gpu-types) |
| Live cloud availability | [runpodctl get cloud](https://docs.runpod.io/runpodctl/reference/runpodctl-get-cloud) |
| SSH setup | [Use SSH](https://docs.runpod.io/pods/configuration/use-ssh) |
| Network volumes | [Network volumes](https://docs.runpod.io/storage/network-volumes) |
| Pod create API | [Create Pod API](https://docs.runpod.io/api-reference/pods/POST/pods) |

Available commands:

```bash
opencolab gpu server add --provider runpod --server-id <id> [flags]         # Create or update a Runpod GPU target
opencolab gpu server list                                                    # List configured GPU targets
opencolab gpu server show --server-id <id>                                   # Print one target as JSON
opencolab gpu server test --server-id <id>                                   # Check local prerequisites and target candidate readiness
opencolab gpu server remove --server-id <id>                                 # Remove one target from project state

opencolab gpu job start --server-id <id> --command "<command>" [flags]       # Start a remote GPU job
opencolab gpu job status --run-id <id>                                       # Refresh and print job status as JSON
opencolab gpu job logs --run-id <id> [--stream stdout|stderr|bootstrap|poller] # Print one local log stream
opencolab gpu job fetch --run-id <id>                                        # Fetch remote logs and declared artifacts
opencolab gpu job cancel --run-id <id>                                       # Stop the remote job and Pod
opencolab gpu job list                                                       # List local GPU run records
```

Notes:

- `RUNPOD_API_KEY` must exist in `.env.local` or the shell environment.
- Use `--location` for one or more preferred Runpod datacenter ids in fallback order. `--datacenter-id` remains as a legacy alias.
- `--gpu-type` accepts a comma-separated ordered list, so one logical server can choose the first available acceptable GPU.
- OpenColab keeps the first location and first GPU as the target's primary values for compatibility, but job provisioning can fall back across the configured candidates.
- When multiple locations are configured, OpenColab manages Runpod network volumes per datacenter behind the scenes.
- Sync is allowlist-based. Use `--include` and `--exclude` as comma-separated repo-relative paths.
- Declared `--artifact` paths are relative to the remote working directory on the Pod.
- Run records live under `projects/<project_id>/experiments/runs/<run_id>/`.
- Target snapshots are mirrored under `projects/<project_id>/experiments/targets/`.

## Gateway and Telegram

Start the local gateway server:

```bash
opencolab gateway start --port 4646
```

Useful lifecycle commands:

```bash
opencolab upgrade
opencolab gateway status
opencolab gateway logs
opencolab gateway stop
opencolab gateway restart --port 4646
```

- `gateway start` runs as a background service by default on macOS and Linux
- Use `opencolab gateway start --foreground true --port 4646` to keep it in the current terminal
- `opencolab upgrade` updates the current install to the latest `main`, rebuilds OpenColab, and restarts a managed background gateway with its saved settings
- Telegram webhook endpoint: `POST http://127.0.0.1:4646/api/telegram/webhook`
- Inbound Telegram files are downloaded into the active project under `memory/TelegramInbox/` when possible
- Agents can return files with raw `@telegram-file <json>` lines using relative or absolute local paths
- Long-running work can emit bounded `started`, `progress`, `milestone`, `warning`, `needs_input`, or `completed` updates before the final answer
- If provider execution fails because of auth, timeout, or CLI setup problems, OpenColab sends a Telegram error reply instead of silently retrying

## Project and Agent Commands

CLI:

```bash
opencolab upgrade
opencolab project create --project-id <id>
opencolab project use --project-id <id>
opencolab project list
opencolab project show
opencolab agent create --agent-id <id> [--path <path>]
opencolab agent use --agent-id <id>
opencolab agent list
opencolab agent show
opencolab gpu server list
opencolab gpu job list
```

Telegram:

```text
/project create <project_id>
/project use <project_id>
/project list
/agent create <agent_id>
/agent use <agent_id>
/agent list
/session reset
```

Telegram slash-menu aliases:

```text
/project_list
/project_create <project_id>
/project_use <project_id>
/agent_list
/agent_create <agent_id>
/agent_use <agent_id>
/session_reset
```

## Agent Layout and Memory

- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`
- Required agent files: `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, plus agent-local `SKILLS/`
- Shared skills live under `projects/SKILLS/` and are reused across all projects and agents
- Agent-local skills live under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- Built-in templates come from `src/agent-templates/`, with shared scaffolds in `src/agent-templates/shared/` and role overrides in folders such as `professor/`, `beginner/`, and `specialist/`
- Current session logs live in `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- Previous-day summaries live in `<agent_path>/memory/Daily/<YYYY-MM-DD>.md`
- Long-term durable facts belong in `MEMORY.md`

Built-in shared workflows include `fast-search`, `pro-search`, `deep-search`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `nano-banana`, `block-diagram`, and `runpod-job`. Search skills return stable `findings.md` outputs plus a companion literature-map diagram, `pageindex-grounded` handles exact follow-up QA over already-downloaded papers, `pdf-figure-extract` handles local figure extraction with PyMuPDF, and `runpod-job` handles bounded Runpod GPU server and job orchestration through the OpenColab CLI.

## Configuration and Development

- `opencolab.json` stores active project state, project and agent maps, per-agent provider config, project-scoped execution targets, and shared Telegram pairing state
- `.env.local` stores secrets such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `RUNPOD_API_KEY`, and `TELEGRAM_BOT_TOKEN`
- Remote run manifests, status, logs, sync metadata, and fetched artifacts live under `projects/<project_id>/experiments/`
- Secret values should not be committed to git

Development commands:

```bash
pnpm install
pnpm run check
pnpm run build
pnpm test
```

## Inspiration

- openclaw: https://github.com/openclaw/openclaw
- nanoclaw: https://github.com/qwibitai/nanoclaw

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- `PageIndex`: https://github.com/VectifyAI/PageIndex - used by the shared `pageindex-grounded` workflow for grounded local paper QA.
- `d2`: https://github.com/terrastruct/d2 - used by the shared `block-diagram` workflow for deterministic diagram generation.
- `PyMuPDF`: https://github.com/pymupdf/PyMuPDF - used by the shared `pdf-figure-extract` workflow for local PDF figure extraction.
