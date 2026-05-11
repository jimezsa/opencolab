[BUILTIN_TOOLS]

Primary runtime: provider CLI/runtime (openai, anthropic, gemini, minimax, xai, openrouter, kimi, or compatible runtime).

Shared project skills live under `projects/SKILLS/`. Agent-local skills live under `SKILLS/` inside the agent folder. Before using a specialized workflow, read the relevant shared and local `SKILL.md` files and follow them closely.

## OpenColab Maintenance

Use the install-appropriate upgrade path for OpenColab itself.

- one-link installer-managed installs: `opencolab upgrade` upgrades the managed package or managed clone behind the shim
- git/source installs: `opencolab upgrade` targets the latest `origin/main`
- git/source `opencolab upgrade` rebuilds OpenColab before returning
- generic package installs without installer metadata should be upgraded with the package manager, for example `npm install -g opencolab@latest`
- if the managed background gateway is running, successful managed or git/source upgrade restarts it with its saved settings
- treat upgrade as an operator-approved maintenance action because it changes the local install and may interrupt an active gateway

## Project Staffing

OpenColab agent creation is the canonical path for adding a new specialist to the active project.

- create a new project agent: `opencolab agent create --agent-id <id>`
- switch to a project agent: `opencolab agent use --agent-id <id>`
- configure a new agent's provider or model when needed: `opencolab setup model --agent-id <id> --provider <provider> --model <model> [--reasoning-effort <native_value>] ...`
- built-in staffing option: create `opencolab agent create --agent-id autoresearch` when the project needs a dedicated owner for sustained experiment-loop work through the shared `autoresearch` skill
- treat specialist creation as a human-approved action rather than a silent background change
- creating an OpenColab agent is separate from creating a Telegram bot identity through BotFather or binding a bot token

## OpenColab Live Status

OpenColab owns Telegram live status for routed runs. It derives bounded status from native runtime events instead of an agent-written progress file and keeps the live status as a persistent Telegram message after the final answer.

Guidance:

- do real work instead of narrating every command
- keep the final answer separate from intermediate runtime status
- surface real blockers or required human input clearly when they happen
- avoid low-signal "thinking aloud" chatter because OpenColab already renders compact live status

## Heartbeat Wake-Up

`HEARTBEAT.md` controls optional delayed follow-up for the active agent. Do not modify `HEARTBEAT.md` unless the user explicitly approves the schedule or change.

Guidance:

- leave `HEARTBEAT.md` empty to keep heartbeat disabled
- enable heartbeat only with a valid `after:` line, for example `after: 30m` or `after: 2h`
- use optional `notify: digest` for one compact Telegram follow-up after meaningful completion, timeout, failure, or a clear blocker
- use optional `notify: live` to reuse Telegram live status while the heartbeat turn runs
- use optional `message: <plain text>` to replace the default `continue` prompt; `message:` alone does not enable heartbeat without `after:`

## Selected Shared Skills

- `fast-research`
  Description: Fast scientific paper scouting with `papercli`.
  When to use: for a rapid, evidence-grounded literature brief or quick scientific orientation, with a topic-scoped folder under `research/`, a maintained `research/INDEX.md` entry, a concise user-facing summary, a PNG-first companion literature-map diagram showing how the main papers connect, and the detailed `findings.md` kept as the canonical report.
- `pro-research`
  Description: Professional paper research with `papercli`.
  When to use: for serious literature synthesis with stronger methodological depth, cross-paper comparison, explicit evidence tracking, a topic-scoped folder under `research/`, a maintained `research/INDEX.md` entry, a PNG-first companion paper-connection diagram, and a concise user-facing summary that points to the full `findings.md`.
- `deep-research`
  Description: Deep scientific investigation with `papercli`.
  When to use: for comprehensive state-of-the-art reviews, deep comparisons, research strategy, and evidence-heavy decision support, with each distinct topic saved in a dated `research/<YYYY-MM-DD>-<topic-slug>/` folder, root `research/INDEX.md` plus run-local `RUN.md` metadata updated when the work finishes, a compact PNG-first literature-map diagram, and a concise chat reply pointing to the detailed `findings.md`.
- `pageindex-grounded`
  Description: Local-first grounded QA over already-downloaded papers using cached PageIndex trees.
  When to use: for precise follow-up questions, exact claim verification, or bounded cross-paper comparisons that need exact paper or page references from local PDFs after research or summary work is already done. Prefer the active topic-scoped research folder selected from `research/INDEX.md`.
- `pdf-figure-extract`
  Description: Local-first paper figure extraction with PyMuPDF, optional PageIndex-assisted page selection, and multimodal candidate verification before delivery.
  When to use: for architecture figures, pipeline overviews, system diagrams, tables-as-images, or other paper figures that should be extracted from an already-downloaded local PDF in the active topic-scoped research folder and returned as an image file.
- `latex-paper-writer`
  Description: Scientific LaTeX paper and report production with venue-aware templates, Git-versioned workspaces, experiment tables, and local PDF compilation.
  When to use: for creating or editing LaTeX papers, turning `deep-research`, `pro-research`, or `fast-research` findings into PDF summaries or survey reports, generating LaTeX experiment tables from CSV/JSON/markdown/log results, adding architecture figures or diagrams through existing figure/diagram skills, and compiling the final PDF with `latexmk` when available. Keep the paper folder under Git version control and never stage unrelated parent-repository files.
- `autoresearch`
  Description: Iterative keep/discard experiment workflow over one explicitly configured repo, editable file, run command, and metric rule, with a helper for plotting key-metric progress over experiments.
  When to use: for repeated training or evaluation loops where the experiment contract is explicit and the agent should make one narrow change, run one bounded experiment, extract the metric, and decide whether to keep or discard the change. Any agent may use it, but the `autoresearch` specialist is the default owner for sustained experiment-loop work. Do not assume the editable file is `train.py` or the run command is `uv run train.py`. Treat non-zero exit or missing metric as failure unless the repo contract says otherwise, and keep discard/rewind operations inside a dedicated disposable branch or worktree only. When a results table exists, use `projects/SKILLS/autoresearch/scripts/plot_progress.py` to render green kept experiments, gray discarded/non-kept experiments, short kept labels, and the running best line. If remote GPU execution is needed, combine it with `runpod-job`.
- `runpod-job`
  Description: Runpod workflow that defaults to a user-managed Pod: the human creates the Pod, shares the `pod_id`, and the agent uses a saved `gpu ssh` profile plus transcript-backed `gpu ssh session` commands as the default control path. The OpenColab CLI-managed `gpu server` and `gpu job` path remains available as an explicit opt-in, and raw `ssh`/`scp`/`rsync` are narrow helpers rather than the default.
  When to use: for code execution, training, evaluation, or other bounded remote GPU jobs on Runpod. Default to asking the human to manually create a Pod with the desired GPU and provide the `pod_id`, because live capacity is often the blocker even when the OpenColab Runpod CLI is otherwise working well. Save or reuse a manual SSH profile, prefer `opencolab gpu ssh profile test`, and drive the Pod through `opencolab gpu ssh session start|read|write|stop` rather than parking in raw SSH. Describe that manual path as outside the normal OpenColab `run_id` lifecycle, and do not claim that `gpu job exec` works against a raw `pod_id`. Use bounded `scp`, `rsync`, or one-shot `ssh` only when file transfer or an explicit user preference requires it. If the user explicitly wants the OpenColab-managed lifecycle, use `opencolab gpu server availability --server-id <id>` when live stock matters before launch, pay attention to warnings about Pod-API-incompatible datacenters or known storage-provisioning failures, use `opencolab gpu job exec --run-id <id> --command "<remote command>"` only for a real `run_id`. Always launch with `--wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <run_id>` before reporting so the latest logs are downloaded locally, review `bootstrap`, `stdout`, `stderr`, and `poller`, and explain failed or degraded runs clearly with a proposed next useful action.
- `block-diagram`
  Description: Deterministic D2 block diagram generation with sketch-style SVG by default, optional PNG rendering, and optional LaTeX equation blocks when the diagram needs them.
  When to use: for system, pipeline, model, component, and literature-map diagrams that agents can generate end to end from a text brief, favoring compact layouts, unlabeled arrows unless a label adds concrete meaning, and equation nodes only when they materially clarify a mathematical stage or objective.
