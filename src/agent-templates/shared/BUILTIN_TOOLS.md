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

OpenColab owns Telegram live status for routed runs. It derives bounded status from native runtime events instead of an agent-written progress file.

Guidance:

- do real work instead of narrating every command
- keep the final answer separate from intermediate runtime status
- surface real blockers or required human input clearly when they happen
- avoid low-signal "thinking aloud" chatter because OpenColab already renders compact live status

## Selected Shared Skills

- `fast-search`
  Description: Fast scientific paper scouting with `papercli`.
  When to use: for a rapid, evidence-grounded literature brief or quick scientific orientation, with a concise user-facing summary, a PNG-first companion literature-map diagram showing how the main papers connect, and the detailed `findings.md` kept as the canonical report.
- `pro-search`
  Description: Professional paper research with `papercli`.
  When to use: for serious literature synthesis with stronger methodological depth, cross-paper comparison, explicit evidence tracking, a PNG-first companion paper-connection diagram, and a concise user-facing summary that points to the full `findings.md`.
- `deep-search`
  Description: Deep scientific investigation with `papercli`.
  When to use: for comprehensive state-of-the-art reviews, deep comparisons, research strategy, and evidence-heavy decision support, while also producing a compact PNG-first literature-map diagram and keeping the chat reply concise and the detailed `findings.md` as the full deliverable.
- `pageindex-grounded`
  Description: Local-first grounded QA over already-downloaded papers using cached PageIndex trees.
  When to use: for precise follow-up questions, exact claim verification, or bounded cross-paper comparisons that need exact paper or page references from local PDFs after search or summary work is already done.
- `pdf-figure-extract`
  Description: Local-first paper figure extraction with PyMuPDF, optional PageIndex-assisted page selection, and multimodal candidate verification before delivery.
  When to use: for architecture figures, pipeline overviews, system diagrams, tables-as-images, or other paper figures that should be extracted from an already-downloaded local PDF and returned as an image file.
- `autoresearch`
  Description: Iterative keep/discard experiment workflow over one explicitly configured repo, editable file, run command, and metric rule.
  When to use: for repeated training or evaluation loops where the experiment contract is explicit and the agent should make one narrow change, run one bounded experiment, extract the metric, and decide whether to keep or discard the change. Any agent may use it, but the `autoresearch` specialist is the default owner for sustained experiment-loop work. Do not assume the editable file is `train.py` or the run command is `uv run train.py`. Treat non-zero exit or missing metric as failure unless the repo contract says otherwise, and keep discard/rewind operations inside a dedicated disposable branch or worktree only. If remote GPU execution is needed, combine it with `runpod-job`.
- `runpod-job`
  Description: Runpod workflow that defaults to a user-managed Pod: the human creates the Pod, shares the `pod_id`, and the agent uses direct SSH. The OpenColab CLI-managed `gpu server` and `gpu job` path remains available as an explicit opt-in.
  When to use: for code execution, training, evaluation, or other bounded remote GPU jobs on Runpod. Default to asking the human to manually create a Pod with the desired GPU and provide the `pod_id`, because live capacity is often the blocker even when the OpenColab Runpod CLI is otherwise working well. Describe that direct-SSH path as outside the normal OpenColab `run_id` lifecycle, and do not claim that `gpu job exec` works against a raw `pod_id`. If the user explicitly wants the OpenColab-managed lifecycle, use `opencolab gpu server availability --server-id <id>` when live stock matters before launch, pay attention to warnings about Pod-API-incompatible datacenters or known storage-provisioning failures, use `opencolab gpu job exec --run-id <id> --command "<remote command>"` only for a real `run_id`. Always launch with `--wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <run_id>` before reporting so the latest logs are downloaded locally, review `bootstrap`, `stdout`, `stderr`, and `poller`, and explain failed or degraded runs clearly with a proposed next useful action.
- `block-diagram`
  Description: Deterministic D2 block diagram generation with sketch-style SVG by default, optional PNG rendering, and optional LaTeX equation blocks when the diagram needs them.
  When to use: for system, pipeline, model, component, and literature-map diagrams that agents can generate end to end from a text brief, favoring compact layouts, unlabeled arrows unless a label adds concrete meaning, and equation nodes only when they materially clarify a mathematical stage or objective.
