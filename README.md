# 🐙 OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-F2A900?style=for-the-badge" alt="Project status: Beta">
  <img src="https://img.shields.io/npm/v/opencolab?label=Release&style=for-the-badge" alt="Current release version on npm">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

_Accelerating Scientific Discovery_ — Turn your research into an always-on autonomous lab that investigates, builds, and discovers.

## Features planned for first release

- ✅ Deep Research swarm skills for paper search, grounded QA (Reasoning-based RAG), figure extraction, parallel summaries, and D2 block diagrams.
- ✅ Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, xAI, OpenRouter, and Kimi.
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
┌────────┐   goals/feedback   ┌───────────┐
│ Human  │ ─────────────────▶ │ Professor │
└───┬────┘                    └─────┬─────┘
    │ direct messages               │ coordination / PhD Students
    ├──────────────┬────────────────┼─────────────────┐
    ▼              ▼                ▼                 ▼
┌────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────┐
│ Literature │  │ Experiments │  │ AutoResearch │  │ Beginner │
└────────────┘  └─────────────┘  └──────────────┘  └──────────┘
```

Current runtime architecture:

```text
┌──────────────┐   routed input   ┌─────────┐   active scope   ┌─────────────────┐
│ Telegram/CLI │ ───────────────▶ │ Gateway │ ───────────────▶ │ Project + Agent │
└──────────────┘                  └─────────┘                  └─────────────────┘
                                                                    │
                                    ┌───────────────────────────────┼──────────────────────────────┐
                                    ▼                               ▼                              ▼
                               Provider Runtime                Shared Skills                Execution Target
```

Remote experiment path:

`Telegram/CLI -> Active Project -> Active Agent -> Execution Target -> Remote Run`

## Runtime CLI Install Links

Install the upstream runtime CLI that matches the provider you want OpenColab to drive:

| Provider     | Runtime CLI | Install guide                                                                   | Command  |
| ------------ | ----------- | ------------------------------------------------------------------------------- | -------- |
| `openai`     | Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                            | `codex`  |
| `anthropic`  | Claude Code | [Claude Code setup](https://code.claude.com/docs/en/getting-started)            | `claude` |
| `gemini`     | Gemini CLI  | [Gemini CLI installation](https://geminicli.com/docs/get-started/installation/) | `gemini` |
| `xai`        | PI          | [PI install](https://pi.dev/)                                                   | `pi`     |
| `openrouter` | PI          | [PI install](https://pi.dev/)                                                   | `pi`     |
| `kimi`       | PI          | [PI install](https://pi.dev/)                                                   | `pi`     |

`minimax` runs through the `claude` runtime, and `xai`, `openrouter`, and `kimi` run through `pi`.

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

### Hacky install mode.

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

- One-link installer-managed installs: `opencolab upgrade`
- Manual git/source installs: `opencolab upgrade`
- Generic npm/global installs without installer metadata: `npm install -g opencolab@latest`

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

OpenColab configures provider CLIs for non-interactive runs inside the active project workspace. Each agent stores its own provider configuration, and long-running routed runs use an OpenColab-owned Telegram live status surface driven by native runtime events.

- `openai`: `api_key` with `OPENAI_API_KEY` or `oauth` with `codex login`
- `anthropic`: `api_key` with `ANTHROPIC_API_KEY` or `oauth` with `claude auth login`
- `gemini`: `api_key` with `GEMINI_API_KEY` or `oauth` with the `gemini` CLI login
- `minimax`: `api_key` with `MINIMAX_API_KEY`
- `xai`: `api_key` with `XAI_API_KEY` through the `pi` runtime
- `openrouter`: `api_key` with `OPENROUTER_API_KEY` through the `pi` runtime
- `kimi`: `api_key` with `KIMI_API_KEY` through the `pi` runtime, mapped to the upstream `kimi-coding` provider id
- `ignite` and `opencolab setup model` expose native reasoning-effort choices when the selected provider/model supports them
- OpenAI `gpt-5.4`: `low`, `medium`, `high`, `xhigh`; default `high`
- Anthropic Claude on the Claude runtime: `low`, `medium`, `high`, `xhigh`, `max`; default `high`
- Gemini-based shared tools still require `GEMINI_API_KEY` even when the active agent runtime uses another provider or Gemini OAuth
- `pageindex-grounded` uses `GEMINI_API_KEY` for the local PageIndex runner even when the active agent runtime uses another provider or Gemini OAuth
- `opencolab ignite` prints direct setup links before asking for provider and Runpod API key values, and a BotFather instruction before asking for `TELEGRAM_BOT_TOKEN`
- Routed Codex runs use `codex -a never exec --json --sandbox danger-full-access`, so clone/push and other repo writes are not blocked by the default workspace-write sandbox, and OpenColab normalizes nested Codex lifecycle events into user-facing Telegram activity instead of surfacing raw protocol names
- Routed Claude Code runs use `claude -p --verbose --output-format stream-json` so Telegram live status can consume the current native event stream
- Existing saved Claude-runtime configs on recognized older default arg sets are auto-migrated to the current streaming contract when OpenColab loads state

Common setup flows:

```bash
# Save a Gemini API key for Gemini-based shared tools, including pageindex-grounded
opencolab setup api-key --provider gemini --api-key <your_gemini_key>

# OpenAI OAuth
codex login
opencolab setup model --provider openai --auth oauth --model gpt-5.4 --reasoning-effort high

# Anthropic OAuth
claude auth login
opencolab setup model --provider anthropic --auth oauth --model claude-opus-4-6 --reasoning-effort max

# Gemini OAuth
gemini
opencolab setup model --provider gemini --auth oauth --model gemini-2.5-pro

# xAI
opencolab setup model --provider xai --model grok-code-fast-1 --api-key <your_xai_key>

# OpenRouter
opencolab setup model --provider openrouter --model openai/gpt-5.4 --api-key <your_openrouter_key>

# Kimi
opencolab setup model --provider kimi --model k2p5 --api-key <your_kimi_key>
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

If a routed provider run hits that timeout, OpenColab preserves the inbound request plus a compact recovery note in the agent's active session memory so the next turn can resume from the last known stage instead of starting cold.

## Remote GPU with Runpod

OpenColab keeps remote GPU execution separate from the agent reasoning runtime. Providers still handle planning and coding; Runpod is only the remote experiment target.
For agent-driven remote GPU execution through OpenColab, use the shared `runpod-job` skill.
The default workflow is now human-managed Pod creation: the human creates the Runpod Pod manually, gives the agent the `pod_id`, and the agent saves or reuses a project-scoped manual SSH profile, then uses `opencolab gpu ssh session start|read|write|stop` as the default control path for that Pod instead of parking in raw interactive SSH. This is a capacity-driven default, not a statement that the OpenColab Runpod CLI is broken. In that default path, the skill must describe the work as outside the normal OpenColab `run_id` lifecycle and must not pretend that `opencolab gpu job exec` works with a raw `pod_id`. The preferred manual flow is `opencolab gpu ssh profile save|show|test|set-default` plus transcript-backed `gpu ssh session` commands; bounded `scp`, `rsync`, or one-shot `ssh` helpers are still allowed when file transfer or an explicit user preference requires them, but they are not the default control path. If the user explicitly wants the OpenColab-managed lifecycle, the skill may instead use `opencolab gpu server` and `opencolab gpu job`; in that managed path it should launch jobs in detached mode with `--wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <id>` before reporting, review `bootstrap`, `stdout`, `stderr`, and `poller`, prefer the single `NVIDIA A100 80GB PCIe` GPU with `--auto-stop-policy keep_warm`, and ask whether to keep a finished warm Pod running or cancel it.
Curated/default Runpod targets use the `pytorch-cu12` bootstrap profile unless the operator overrides it.

Default manual Pod flow:

```bash
# Save one user-managed Runpod Pod connection and make it the default for the active agent
opencolab gpu ssh profile save \
  --profile-id runpod-manual-a100 \
  --pod-id abc123xyz \
  --ssh-command "ssh -p 21438 -i ~/.ssh/id_ed25519 root@203.0.113.10" \
  --set-default true

# Validate the saved connection, refreshing host and port from Runpod when possible
opencolab gpu ssh profile test --profile-id runpod-manual-a100

# Start a live line-oriented SSH session from the saved profile
opencolab gpu ssh session start --profile-id runpod-manual-a100

# Read the transcript incrementally
opencolab gpu ssh session read --session-id <session_id>
opencolab gpu ssh session read --session-id <session_id> --offset <next_offset>

# Send one bounded line of input to the remote shell
opencolab gpu ssh session write --session-id <session_id> --stdin "nvidia-smi"
opencolab gpu ssh session write --session-id <session_id> --stdin "tail -n 100 /workspace/train.log"

# Stop the live session when finished
opencolab gpu ssh session stop --session-id <session_id>
```

Optional OpenColab-managed flow:

```bash
# Create or update a project-scoped Runpod target with ordered fallback locations and the curated A100 GPU
opencolab gpu server add \
  --provider runpod \
  --server-id runpod-a100 \
  --location US-KS-2,CA-MTL-1 \
  --gpu-type "NVIDIA A100 80GB PCIe" \
  --gpu-count 1 \
  --bootstrap-profile pytorch-cu12 \
  --volume-name default-runpod-a100 \
  --volume-size-gb 200 \
  --auto-stop-policy keep_warm

# Validate local prerequisites and visible Runpod resources
opencolab gpu server test --server-id runpod-a100

# Check which configured datacenter / GPU candidates are live right now
opencolab gpu server availability --server-id runpod-a100

# Launch a bounded remote job without blocking the agent
start_output="$(
  opencolab gpu job start \
    --server-id runpod-a100 \
    --command "python train.py --epochs 1" \
    --include projects/default,research \
    --artifact outputs/train.log,outputs/metrics.json \
    --wait false
)"
printf '%s\n' "$start_output"
run_id="$(printf '%s\n' "$start_output" | awk -F': ' '/^Run ID:/ {print $2}')"

# Later, inspect the running job when needed
opencolab gpu job status --run-id "$run_id"
opencolab gpu job logs --run-id "$run_id" --stream bootstrap
opencolab gpu job logs --run-id "$run_id" --stream stdout
opencolab gpu job logs --run-id "$run_id" --stream stderr
opencolab gpu job logs --run-id "$run_id" --stream poller

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

opencolab gpu ssh profile save --profile-id <id> [flags]                     # Save or update a manual Pod SSH profile
opencolab gpu ssh profile list                                               # List saved manual Pod SSH profiles
opencolab gpu ssh profile show [--profile-id <id>]                           # Print one saved manual Pod SSH profile as JSON
opencolab gpu ssh profile test [--profile-id <id>]                           # Validate one saved manual Pod SSH profile
opencolab gpu ssh profile remove --profile-id <id>                           # Remove one saved manual Pod SSH profile
opencolab gpu ssh profile set-default --profile-id <id> [--agent-id <id>]   # Set the default manual Pod SSH profile for an agent
opencolab gpu ssh session start [--profile-id <id>] [--agent-id <id>]       # Start a live manual Pod SSH session
opencolab gpu ssh session list                                               # List saved manual Pod SSH sessions
opencolab gpu ssh session read --session-id <id> [--offset <n>]              # Read one transcript slice as JSON
opencolab gpu ssh session write --session-id <id> --stdin "<text>"           # Send one line of input to a live manual SSH session
opencolab gpu ssh session stop --session-id <id>                             # Stop one live manual SSH session

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
- Saved manual Pod SSH profiles live in project state and are separate from OpenColab-managed `run_id` jobs.
- Live manual SSH sessions are explicit opt-in, line-oriented, and transcript-backed under `projects/<project_id>/experiments/ssh-sessions/`.
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
- `opencolab upgrade` upgrades one-link installer-managed package installs, one-link installer-managed hacky clone installs, and manual git/source installs
- managed package and clone upgrades keep the installer-managed runtime root and restart a managed background gateway with its saved settings when one is running
- generic npm/global installs without installer metadata should still be upgraded with the package manager, for example `npm install -g opencolab@latest`
- Telegram webhook endpoint: `POST http://127.0.0.1:4646/api/telegram/webhook`
- Inbound Telegram files are downloaded into the active project under `memory/TelegramInbox/` when possible
- Agents can return files with raw `@telegram-file <json>` lines using relative or absolute local paths
- Long-running work uses one bounded live status surface before the final answer instead of sending a stream of progress messages
- OpenColab waits for real runtime progress before creating the live status surface; it does not send a generic placeholder status card
- In paired private chats, OpenColab prefers Telegram `sendMessageDraft` and keeps the live status compact
- In groups and other non-private chats, OpenColab uses one editable status message and streams a bounded recent tool-activity list
- Live status marks the newest visible step with `🟢` and older visible steps with `⚪` so the current action is easy to spot
- Routed Telegram text replies are prefixed with the active agent id on the first line so one chat can safely manage multiple agents
- Final text replies are split into ordered chunks when needed so Telegram's text limit does not drop the answer
- `sendChatAction` remains active as startup feedback and as fallback when no live status event is available
- If provider execution fails because of auth, timeout, CLI setup problems, or Telegram API delivery issues, the gateway logs the Telegram status and description instead of failing silently

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
/projects
/agents
/session_reset
/stop
```

Telegram slash-menu commands:

```text
/projects
/agents
/session_reset
/stop
```

`/projects` and `/agents` open inline-button pickers in Telegram so users can switch the active project or agent with one tap. `/session_reset` starts a new active session. `/stop` cancels the active routed task for the same chat or topic and saves a compact recovery summary for later resume. Project and agent creation remain CLI-driven.

## Agent Layout and Memory

- Each project keeps shared project context in `projects/<project_id>/PROJECT-AND-TEAM.md`
- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`
- Required agent files: `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, `HEARTBEAT.md`, plus agent-local `SKILLS/`
- `HEARTBEAT.md` is seeded empty for every agent and stays off by default; heartbeat activates only when the user adds a valid `after:` duration such as `after: 30m`
- `HEARTBEAT.md` may also include `notify: digest` to send one compact follow-up after a meaningful heartbeat completion, timeout, failure, or clear blocker, or `notify: live` to show the existing Telegram live-status surface during the heartbeat turn; if `notify:` is omitted, heartbeat stays silent in Telegram
- `HEARTBEAT.md` may include `message: <plain text>` to replace the default heartbeat prompt `continue`; a valid `after:` line is still required
- On first contact, agents must read `BOOTSTRAP.md` before `ALMA.md` whenever `BOOTSTRAP.md` still exists
- The shared `ALMA.md` template sets a completeness-first bar: search before building, test before shipping, prefer permanent fixes over nearby workarounds, and finish the whole task when the real solution is within reach
- `TODO.md` is a lean, actively maintained working list for current focus, top priorities, and live blockers only; agents should rewrite it as priorities change and delete completed or stale items instead of keeping backlog or done-history there
- `PROJECT-AND-TEAM.md` is the canonical shared project context file for goal, scope, constraints, key decisions, humans, agents, and roles
- Agents should treat `PROJECT-AND-TEAM.md` as curated shared context, not as transcript storage or scratch memory
- `professor` is the lead agent and may propose or create durable specialist agents for research, coding, experiments, or writing after human approval
- Professor-led creation uses the OpenColab CLI, for example `opencolab agent create --agent-id <id>`, with follow-up `opencolab setup model --agent-id <id> ...` when per-agent provider setup is needed
- Creating an OpenColab agent is separate from creating a Telegram bot identity; BotFather and token binding remain operator-managed steps
- Shared skills live under `projects/SKILLS/` and are reused across all projects and agents
- Agent-local skills live under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- Built-in templates come from `src/agent-templates/`, with shared scaffolds in `src/agent-templates/shared/` and role overrides in folders such as `professor/`, `beginner/`, `autoresearch/`, and `specialist/`
- The built-in `autoresearch` template is stricter than the generic default: it should carry forward repo-contract details, repeated user corrections, rejected paths, and lessons from failed runs so experiment loops do not keep relearning the same thing
- Current session logs live in `<agent_path>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- Previous-day summaries live in `<agent_path>/memory/Daily/<YYYY-MM-DD>.md`
- Long-term durable facts belong in `MEMORY.md`

Built-in shared workflows include `fast-search`, `pro-search`, `deep-search`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `nano-banana`, `block-diagram`, `autoresearch`, and `runpod-job`. Search skills return stable `findings.md` outputs plus a companion literature-map diagram, `pageindex-grounded` handles exact follow-up QA over already-downloaded papers, `pdf-figure-extract` handles local figure extraction with PyMuPDF, `autoresearch` handles iterative keep/discard experiment loops over one explicitly configured repo without assuming `train.py` or `uv run train.py`, and `runpod-job` now defaults to a user-managed Runpod Pod workflow where the human creates the Pod, shares the `pod_id`, and the agent uses saved `gpu ssh profile` plus transcript-backed `gpu ssh session` commands as the default control path, while reserving raw `scp`, `rsync`, or one-shot `ssh` for bounded helper use and keeping the OpenColab-managed `gpu server` and `gpu job` flow available as an explicit opt-in when the user wants `run_id` tracking and managed lifecycle behavior. Any agent may use `autoresearch`, but the built-in `autoresearch` specialist is the default owner for sustained experiment-loop work.

## Configuration and Development

- `opencolab.json` stores active project state, project and agent maps, per-agent provider config, project-scoped execution targets, optional per-project pending heartbeat wake-up state, and shared Telegram pairing state at the runtime root
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
- autoresearch: https://github.com/karpathy/autoresearch

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- `pi-mono`: https://github.com/badlogic/pi-mono - used as the shared `pi` runtime for providers that do not ship a dedicated CLI.
- `PageIndex`: https://github.com/VectifyAI/PageIndex - used by the shared `pageindex-grounded` workflow for grounded local paper QA.
- `d2`: https://github.com/terrastruct/d2 - used by the shared `block-diagram` workflow for deterministic diagram generation.
- `PyMuPDF`: https://github.com/pymupdf/PyMuPDF - used by the shared `pdf-figure-extract` workflow for local PDF figure extraction.
