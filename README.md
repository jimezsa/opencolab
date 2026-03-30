# 🐙 OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-F2A900?style=for-the-badge" alt="Project status: Beta">
  <img src="https://img.shields.io/npm/v/opencolab?label=Release&style=for-the-badge" alt="Current release version on npm">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

_Accelerating Scientific Discovery_ — Turn one researcher into an always-on autonomous research lab that investigates, builds, and publishes.

## Features planned for first release

- ✅ Deep Research swarm skills for paper search, grounded QA (Reasoning-based RAG), figure extraction, parallel summaries, and D2 block diagrams.
- ✅ Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- ✅ Multi-project, multi-agent local workspace with CLI and Telegram control.
- ✅ Run Experiment on external GPU servers(Runpod)
- ⏳ Coming: LaTeX-format paper generation.

**Note:** OpenColab is an early-stage, actively evolving project. Features and documentation are rapidly improving—feedback and contributions are welcome!

It combines strategic guidance, parallel investigation, and rigorous synthesis so ideas can move from hypothesis to evidence faster.
The vision is an always-on lab where the research-agent expert group leads execution with discipline, while the human defines initial goals and supports with coordination, key decisions, and key activities.

Check [docs/VISION.md](docs/VISION.md) for project direction and [docs/spec.md](docs/spec.md) for the concrete runtime contract.

<table align="center">
  <tr>
    <td align="center" width="120">
      <img src="docs/assets/openai-runtime.svg" alt="OpenAI logo for Codex runtime" width="42" height="42"><br>
      <strong>Codex</strong>
    </td>
    <td align="center" width="120">
      <img src="docs/assets/claude-runtime.svg" alt="Claude logo for Claude Code runtime" width="42" height="42"><br>
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

## Runtime CLI Install Links

Install the upstream runtime CLI that matches the provider you want OpenColab to drive:

| Provider    | Runtime CLI | Install guide                                                                   | Command  |
| ----------- | ----------- | ------------------------------------------------------------------------------- | -------- |
| `openai`    | Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                            | `codex`  |
| `anthropic` | Claude Code | [Claude Code setup](https://code.claude.com/docs/en/getting-started)            | `claude` |
| `gemini`    | Gemini CLI  | [Gemini CLI installation](https://geminicli.com/docs/get-started/installation/) | `gemini` |
| `xai`       | PI          | [PI install](https://pi.dev/)                                                   | `pi`     |

`minimax` runs through the `claude` runtime, and `xai` runs through `pi`.

## Install

Published npm package install:

```bash
npm install -g opencolab
```

Repository-managed installers default to the published npm package:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash
```

Windows PowerShell:

```powershell
powershell -c "irm https://opencolab.ai/install.ps1 | iex"
```

The macOS/Linux installer keeps runtime state under `~/.opencolab` by default and installs the package into a user-owned npm prefix.
The Windows installer uses `%LOCALAPPDATA%\OpenColab\root` for runtime state, `%LOCALAPPDATA%\OpenColab\package` for the npm prefix, and `%LOCALAPPDATA%\OpenColab\bin\opencolab.cmd` as the user shim.
For packaged installs, OpenColab defaults to that runtime root even when you invoke `opencolab` outside the directory. `opencolab.json` and `.env.local` live directly under the runtime root, while internal state lives under `<runtime_root>/.opencolab/`.
`install.sh` now fails fast on Windows and points users to `install.ps1`.
Run `opencolab --version` to print the installed CLI version, or just run `opencolab` to see the version in the top help banner immediately.

If the npm package is not published yet for the version you want, the one-link installers also support a hacky git-clone mode.

macOS / Linux clone mode:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash -s -- --hacky
```

Windows PowerShell clone mode:

```powershell
& ([scriptblock]::Create((irm https://opencolab.ai/install.ps1))) --hacky
```

Optional clone-mode overrides:

- `OPENCOLAB_CLONE_DIR`: source checkout location
- `OPENCOLAB_REPO_URL`: git remote to clone
- `OPENCOLAB_BRANCH`: branch to check out

Clone mode is intentionally rough. It builds a local checkout and wires the `opencolab` shim to `node dist/src/cli.js`.

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
opencolab gateway status
opencolab project show
opencolab agent show
opencolab gpu server list
```

Upgrade notes:

- Git/source installs: `opencolab upgrade`
- npm/global installs: `npm install -g opencolab@latest`

## Manual Run (git clone + Node)

If you need an unreleased version or prefer to run from a source checkout:

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
- `pageindex-grounded` uses `GEMINI_API_KEY` for the local PageIndex runner even when the active agent runtime uses another provider or Gemini OAuth
- `opencolab ignite` prints direct setup links before asking for provider and Runpod API key values, and a BotFather instruction before asking for `TELEGRAM_BOT_TOKEN`

Common setup flows:

```bash
# Save a Gemini API key for Gemini-based shared tools, including pageindex-grounded
opencolab setup api-key --provider gemini --api-key <your_gemini_key>

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

Provider CLI execution defaults to a 30 minute timeout. Override it in `.env.local` if needed:

```env
OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS=1800000
```

## Remote GPU with Runpod

OpenColab keeps remote GPU execution separate from the agent reasoning runtime. Providers still handle planning and coding; Runpod is only the remote experiment target.
For agent-driven remote GPU execution through OpenColab, use the shared `runpod-job` skill.
For longer agent-driven jobs, the skill should usually launch with `--wait false` and return the `run_id` promptly. The agent can inspect `opencolab gpu job status` and `opencolab gpu job logs` later when the user explicitly asks about the running job or asks to monitor it, and can use `opencolab gpu job exec --run-id <id> --command "<remote command>"` for bounded direct Pod inspection when SSH-backed access is needed.
Curated/default Runpod targets use the `pytorch-cu12` bootstrap profile unless the operator overrides it.

Common operator flow:

```bash
# Create or update a project-scoped Runpod target with ordered fallback locations and GPUs
opencolab gpu server add \
  --provider runpod \
  --server-id runpod-flex \
  --location US-KS-2,CA-MTL-1 \
  --gpu-type "NVIDIA A100 80GB PCIe,NVIDIA RTX 4090" \
  --gpu-count 1 \
  --bootstrap-profile pytorch-cu12 \
  --volume-name default-runpod-flex \
  --volume-size-gb 200

# Validate local prerequisites and visible Runpod resources
opencolab gpu server test --server-id runpod-flex

# Check which configured datacenter / GPU candidates are live right now
opencolab gpu server availability --server-id runpod-flex

# Launch a bounded remote job without blocking the agent
start_output="$(
  opencolab gpu job start \
    --server-id runpod-flex \
    --command "python train.py --epochs 1" \
    --include projects/default,research \
    --artifact outputs/train.log,outputs/metrics.json \
    --wait false
)"
printf '%s\n' "$start_output"
run_id="$(printf '%s\n' "$start_output" | awk -F': ' '/^Run ID:/ {print $2}')"

# Later, inspect the running job when needed
opencolab gpu job status --run-id "$run_id"

# Run one bounded command directly on the launched Pod when needed
opencolab gpu job exec --run-id "$run_id" --command "nvidia-smi"
```

Important links:

| Topic                    | Link                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Quickstart / manage Pods | [Manage Pods](https://docs.runpod.io/runpodctl/manage-pods)                           |
| GPU types                | [GPU types reference](https://docs.runpod.io/references/gpu-types)                    |
| Live cloud availability  | [runpodctl get cloud](https://docs.runpod.io/runpodctl/reference/runpodctl-get-cloud) |
| SSH setup                | [Use SSH](https://docs.runpod.io/pods/configuration/use-ssh)                          |
| Network volumes          | [Network volumes](https://docs.runpod.io/storage/network-volumes)                     |
| Pod create API           | [Create Pod API](https://docs.runpod.io/api-reference/pods/POST/pods)                 |

Available commands:

```bash
opencolab gpu server add --provider runpod --server-id <id> [flags]         # Create or update a Runpod GPU target
opencolab gpu server list                                                    # List configured GPU targets
opencolab gpu server show --server-id <id>                                   # Print one target as JSON
opencolab gpu server availability --server-id <id>                           # Check live datacenter/GPU capacity for one target
opencolab gpu server test --server-id <id>                                   # Check local prerequisites and target candidate readiness
opencolab gpu server remove --server-id <id>                                 # Remove one target from project state

opencolab gpu job start --server-id <id> --command "<command>" [flags]       # Start a remote GPU job
opencolab gpu job status --run-id <id>                                       # Refresh and print job status as JSON
opencolab gpu job logs --run-id <id> [--stream stdout|stderr|bootstrap|poller] # Print one local log stream
opencolab gpu job exec --run-id <id> --command "<command>"                   # Run one bounded remote command over the job Pod SSH path
opencolab gpu job fetch --run-id <id>                                        # Fetch remote logs and declared artifacts
opencolab gpu job cancel --run-id <id>                                       # Stop the remote job and Pod
opencolab gpu job list                                                       # List local GPU run records
```

Notes:

- `RUNPOD_API_KEY` must exist in `.env.local` or the shell environment.
- Use `--location` for one or more preferred Runpod datacenter ids in fallback order. `--datacenter-id` remains as a legacy alias.
- `--gpu-type` accepts a comma-separated ordered list, so one logical server can choose the first available acceptable GPU.
- `opencolab gpu server availability --server-id <id>` shows a live snapshot of matching datacenter/GPU stock before launch; it helps pick a target, but it does not reserve capacity.
- The availability output also warns about known launch blockers such as datacenters rejected by the current Pod API schema or locally observed network-volume provisioning failures.
- OpenColab keeps the first location and first GPU as the target's primary values for compatibility, but job provisioning can fall back across the configured candidates.
- When multiple locations are configured, OpenColab manages Runpod network volumes per datacenter behind the scenes.
- Sync is allowlist-based. Use `--include` and `--exclude` as comma-separated repo-relative paths.
- Declared `--artifact` paths are relative to the remote working directory on the Pod.
- `opencolab gpu job exec --run-id <id> --command "<command>"` is the minimal direct-Pod access path for agents and prints JSON with `runId`, `targetId`, `exitCode`, `stdout`, and `stderr`.
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
- `opencolab upgrade` updates git/source installs to the latest `main`, rebuilds OpenColab, and restarts a managed background gateway with its saved settings
- npm/global installs should be upgraded with the package manager, for example `npm install -g opencolab@latest`
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

- Each project keeps shared project context in `projects/<project_id>/PROJECT-AND-TEAM.md`
- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`
- Required agent files: `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, plus agent-local `SKILLS/`
- On first contact, agents must read `BOOTSTRAP.md` before `ALMA.md` whenever `BOOTSTRAP.md` still exists
- `PROJECT-AND-TEAM.md` is the canonical shared project context file for goal, scope, constraints, key decisions, humans, agents, and roles
- Agents should treat `PROJECT-AND-TEAM.md` as curated shared context, not as transcript storage or scratch memory
- `professor` is the lead agent and may propose or create durable specialist agents for research, coding, experiments, or writing after human approval
- Professor-led creation uses the OpenColab CLI, for example `opencolab agent create --agent-id <id>`, with follow-up `opencolab setup model --agent-id <id> ...` when per-agent provider setup is needed
- Creating an OpenColab agent is separate from creating a Telegram bot identity; BotFather and token binding remain operator-managed steps
- Shared skills live under `projects/SKILLS/` and are reused across all projects and agents
- Agent-local skills live under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- Built-in templates come from `src/agent-templates/`, with shared scaffolds in `src/agent-templates/shared/` and role overrides in folders such as `professor/`, `beginner/`, and `specialist/`
- Current session logs live in `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- Previous-day summaries live in `<agent_path>/memory/Daily/<YYYY-MM-DD>.md`
- Long-term durable facts belong in `MEMORY.md`

Built-in shared workflows include `fast-search`, `pro-search`, `deep-search`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `nano-banana`, `block-diagram`, and `runpod-job`. Search skills return stable `findings.md` outputs plus a companion literature-map diagram, `pageindex-grounded` handles exact follow-up QA over already-downloaded papers, `pdf-figure-extract` handles local figure extraction with PyMuPDF, and `runpod-job` handles bounded Runpod GPU server and job orchestration through the OpenColab CLI, preferring detached launch for longer runs so agents can return a `run_id` promptly and inspect the run later on demand while also surfacing failed or degraded runs clearly with a proposed next action.

## Configuration and Development

- `opencolab.json` stores active project state, project and agent maps, per-agent provider config, project-scoped execution targets, and shared Telegram pairing state at the runtime root
- `.env.local` stores secrets such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `RUNPOD_API_KEY`, and `TELEGRAM_BOT_TOKEN` at the runtime root
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

- `pi-mono`: https://github.com/badlogic/pi-mono - used as the shared `pi` runtime for providers that do not ship a dedicated CLI.
- `PageIndex`: https://github.com/VectifyAI/PageIndex - used by the shared `pageindex-grounded` workflow for grounded local paper QA.
- `d2`: https://github.com/terrastruct/d2 - used by the shared `block-diagram` workflow for deterministic diagram generation.
- `PyMuPDF`: https://github.com/pymupdf/PyMuPDF - used by the shared `pdf-figure-extract` workflow for local PDF figure extraction.
