# Repository Guidelines

## Project Structure & Module Organization
OpenColab is a TypeScript/Node.js ESM CLI and local gateway for a multi-project, multi-agent research workflow.
Keep repository guidance aligned with the actual runtime, not aspirational structure.

Top-level sources of truth:

- `docs/spec.md`: source of truth for requirements and architecture.
- `docs/VISION.md`: product direction and long-term intent.
- `README.md`: quickstart, high-level overview, and condensed runtime/reference guide.
- `package.json`: npm package metadata, published CLI surface, and pack/publish lifecycle hooks.
- `install.sh`: package-first macOS/Linux installer, managed-install manifest writer, and command shim setup, with optional `--hacky` git-clone fallback.
- `install.ps1`: package-first Windows PowerShell installer, managed-install manifest writer, and command shim setup, with optional `--hacky` git-clone fallback.
- `projects/SKILLS/`: shared built-in skill library copied into agent prompts, not per-project duplicates, including search, summarization, grounded paper QA, scientific LaTeX paper/report writing, image, architecture-diagram, and iterative experiment-loop workflows. Packaged installs must ship this directory too.
- `src/`: TypeScript implementation.
- `src/agent-templates/`: built-in agent markdown scaffolds loaded by the runtime when seeding agent files and prompt context, with shared files in `shared/` and role-specific folders such as `professor/`, `beginner/`, `autoresearch/`, and `specialist/`. Packaged installs must ship the runtime-accessible equivalents.
- `tests/`: Node `node:test` suite.

Core implementation areas:

- `src/cli.ts`: CLI entrypoint, top-level help/version output, interactive prompts, setup flows including standalone provider-key writes, and gateway lifecycle commands.
- `src/ignite.ts`: first-run onboarding for project selection, curated provider model/auth/reasoning setup including OAuth-capable provider flows, direct API-key setup links, BotFather token guidance, built-in shared-tool key setup including `GEMINI_API_KEY` prerequisites for Gemini shared tools and `pageindex-grounded`, Telegram setup, and pairing.
- `src/runtime.ts`: stateful orchestration across config, project state, gateway routing, memory, and provider execution.
- `src/experiments.ts`: local experiment bookkeeping helpers for target snapshots, run manifests, status files, logs, artifacts, and sync metadata.
- `src/gpu-providers/runpod/index.ts`: Runpod-backed execution-target validation, availability-aware location/GPU selection, Pod lifecycle, SSH sync/bootstrap/launch, and run reconciliation.
- `src/manual-ssh.ts` and `src/manual-ssh-worker.ts`: saved manual Pod SSH profile management, transcript-backed live session control, and detached SSH session worker lifecycle.
- `src/http.ts`: local HTTP server, health/state endpoints, Telegram webhook ingestion, and optional long polling startup.
- `src/gateway.ts`: Telegram authorization, pairing, command routing including `/stop` cancellation with recovery summaries, typing updates, live-status ownership, split final-text delivery, and Telegram API error reporting.
- `src/gateway-service.ts`: persistent background gateway service management for macOS `launchd` and Linux `systemd`.
- `src/telegram-poller.ts`: Telegram long-polling loop and update ingestion.
- `src/upgrade.ts`: install-aware OpenColab upgrade flow for one-link installer-managed package or clone installs plus manual git/source checkouts, with guidance only for generic package installs.
- `src/provider.ts`: provider defaults, runtime selection, auth-mode support, OAuth setup/remediation hints, CLI args including current Claude Code `stream-json` requirements, migration signatures for previously-shipped Claude defaults, and env wiring.
- `src/provider-agent.ts`: provider-backed execution, runtime preflight/error handling including OAuth session checks for supported runtimes, and provider-to-gateway progress-event forwarding.
- `src/agent.ts`: agent file seeding, shared/agent-local skill discovery, and prompt assembly.
- `src/agent-templates.ts`: built-in agent template loading and default-doc resolution.
- `src/conversation.ts`: per-agent session logs, previous-day summaries, and prompt-memory loading.
- `src/install.ts`: install-root detection, installer-managed install manifest handling, and runtime-root resolution across `OPENCOLAB_ROOT`, packaged-install defaults, and cwd fallback for source checkouts.
- `src/project-config.ts`: `opencolab.json` defaults, normalization, migration including recognized stale Claude CLI arg upgrades, and project/agent path helpers.
- `src/config.ts`: root config, runtime-root-aware path resolution, and local env loading.
- `src/secrets.ts`: `.env.local` secret read/write helpers.
- `src/types.ts`: shared persisted-state and runtime interfaces.

Agent contract details that matter for implementation:

- Each project must seed `projects/<project_id>/PROJECT-AND-TEAM.md` as the canonical shared project context file visible to all agents.
- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`.
- Required agent files are `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, `HEARTBEAT.md`, plus agent-local `SKILLS/`.
- `HEARTBEAT.md` must be seeded as an empty file when an agent is created, stays disabled by default, and only enables delayed auto-wake behavior when the user adds a valid `after:` value; it may also include optional `notify: digest` for one compact paired-chat Telegram follow-up after a meaningful heartbeat run finishes, optional `notify: live` to reuse Telegram live status while the heartbeat turn runs, and optional `message: <plain text>` to replace the default `continue` heartbeat prompt.
- Shared skills live only under `projects/SKILLS/`; do not duplicate them into each project or agent. Source and packaged installs must both provide the built-in shared skill library.
- The shared `block-diagram` skill defaults to compact layouts with unlabeled arrows, supports optional LaTeX equation blocks when they materially clarify a model or pipeline, and only uses edge labels when they carry concrete meaning such as a protocol or payload, not generic `input` or `output` text.
- The shared `fast-search`, `pro-search`, and `deep-search` skills must keep their `findings.md` formats stable while also producing a companion literature-map block diagram through `block-diagram`, returning concise, friendly channel-agnostic summaries, and, when appropriate, returning `findings.md` plus a PNG-first diagram through the active channel's file-delivery mechanism, with SVG fallback if PNG rendering is unavailable.
- The shared `pageindex-grounded` skill is the canonical local-first path for grounded follow-up QA over already-downloaded papers. It must keep selection bounded, cache PageIndex trees under `research/pageindex/`, use `GEMINI_API_KEY` for the local PageIndex runner, and answer with exact paper or page references plus explicit limitations when coverage is partial.
- The shared `pdf-figure-extract` skill is the canonical local-first path for extracting and returning figures from already-downloaded papers. It must use PyMuPDF, work even when PageIndex artifacts are missing, optionally reuse `research/pageindex/` to narrow candidate pages, and require multimodal verification of shortlisted figure candidates when the active provider supports local image inspection.
- The shared `latex-paper-writer` skill is the canonical path for creating, editing, versioning, compiling, and returning scientific LaTeX papers, reports, and search-derived PDF summaries. It must keep each paper workspace under Git version control, use venue-aware templates without claiming official compliance unless verified, compile with `latexmk` when available while surfacing install guidance when missing, generate experiment-result tables, reuse `deep-search`/`pro-search`/`fast-search` findings and `pageindex-grounded` evidence, use `pdf-figure-extract` and `block-diagram` for visuals when appropriate, and return final PDFs through the active channel's file-delivery mechanism when requested.
- The shared `autoresearch` skill is the canonical path for iterative keep/discard experiment loops over one explicitly configured repo. It is a normal shared skill available to every agent, but the built-in `autoresearch` agent is the default owner for sustained experiment-loop work. It must require explicit `repo_path`, `editable_file_path`, `run_command`, and `metric_rule`, treat non-zero exit or missing metric as failure by default, use a dedicated disposable branch or worktree for keep/discard iteration, and must not assume `train.py` or `uv run train.py`.
- The shared `runpod-job` skill is the canonical AI-facing path for Runpod work. Even though the OpenColab Runpod CLI remains supported, the default skill workflow should assume live GPU capacity may be the blocker: ask the human to manually create a Runpod Pod with the desired GPU, wait for the user to provide the `pod_id`, save or reuse a project-scoped manual SSH profile through `opencolab gpu ssh profile ...`, and then use `opencolab gpu ssh session start|read|write|stop` as the default control path for that user-managed Pod instead of parking in raw direct SSH. The skill must describe that manual path as outside the normal OpenColab `run_id` lifecycle, must not invent a `run_id`, and must not claim that `opencolab gpu job exec` works directly against a raw `pod_id`. It should prefer `opencolab gpu ssh profile test` before starting a session, set an active-agent default when appropriate, and only use bounded `scp`, `rsync`, or one-shot `ssh` helpers when file transfer or an explicit user request requires them. If the user explicitly wants the OpenColab-managed lifecycle, the skill may instead use `opencolab gpu server` and `opencolab gpu job`, should use `opencolab gpu server availability --server-id <id>` when current datacenter or GPU stock needs to be checked before launch, should pay attention to warnings about Pod-API-incompatible datacenters or known storage-provisioning failures, and should use `opencolab gpu job exec --run-id <id> --command "<remote command>"` for bounded direct Pod inspection when SSH-backed access is needed. On that managed path it must launch jobs in detached mode with `--wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <run_id>` before reporting so the latest remote logs are downloaded locally, review `bootstrap`, `stdout`, `stderr`, and `poller` when summarizing a run, prefer a single `NVIDIA A100 80GB PCIe` GPU with `keep_warm` for curated targets, ask the user whether to keep a finished warm Pod running or cancel it, use `pytorch-cu12` for curated/default targets, and surface failed or degraded runs clearly with a proposed next action.
- Conversation history belongs under agent-local `memory/Session/` and `memory/Daily/`, not under `.opencolab`.
- Routed provider timeouts or failures must preserve the inbound user turn and append a compact assistant recovery entry to the active session history, while keeping raw progress events out of normal conversation memory.
- `TOOLS.md` is the user-owned local tooling layer; repo-managed built-in tool guidance must be injected at prompt-build time rather than copied into `TOOLS.md`.
- The seeded `ALMA.md` contract must encode a completeness-first execution standard: search before building, test before shipping, prefer permanent fixes over nearby workarounds, and finish the whole task when the real solution is within reach.
- The seeded `AGENTS.md` contract must require agents to read `BOOTSTRAP.md` before `ALMA.md` whenever bootstrap still exists, so first-contact identity setup cannot be skipped.
- The seeded `TODO.md` contract must keep a lean working list with only the current focus, top priorities, and live blockers, defaulting to at most three open priority items unless the user explicitly asks for a broader plan.
- The seeded `AGENTS.md` contract must require agents to continuously maintain `TODO.md`, rewriting it when priorities change and deleting completed or stale items instead of accumulating backlog or done-history there.
- The seeded `AGENTS.md` contract must explain that `PROJECT-AND-TEAM.md` is the project-scoped shared context file, is read after `TODO.md` and before `MEMORY.md`, and must be consulted before agents edit it.
- The seeded `professor` contract must teach professor-led specialist creation through the OpenColab CLI, require human approval before creation, and require roster updates in `PROJECT-AND-TEAM.md`.
- The seeded `autoresearch` contract must orient that agent around iterative experiment execution through the shared `autoresearch` skill, default ownership of sustained experiment-loop work, and explicit carry-forward of repo-contract details, user corrections, rejected paths, and lessons from failed runs.
- The seeded `specialist` and `beginner` contracts must state that they do not create more specialists by default and should route staffing recommendations back through `professor`.
- The seeded `AGENTS.md` contract must explain that OpenColab owns Telegram live status for routed runs, derives it from runtime events instead of an agent-written progress file, expects agents to avoid low-signal step-by-step chatter, and may surface a bounded recent tool-activity list in Telegram groups.
- Telegram live status should mark the newest visible line with `🟢` and older visible lines with `⚪` so the current step remains obvious in chat.
- Codex lifecycle events such as `item.started`, `item.completed`, and `turn.completed` must be normalized before Telegram rendering and must never appear verbatim in live status text.
- Routed Telegram text replies should be prefixed with the active agent id on the first line, but that transport-only label must not be copied into normal conversation memory.
- The seeded agent docs must explain that Telegram file return directives must be emitted as raw `@telegram-file <json>` lines rather than markdown-wrapped snippets.

For behavior changes, update `docs/spec.md` first, then sync `README.md`, `AGENTS.md`, and code in the same change.

## Build, Test, and Development Commands
Use these commands for normal development:

- `pnpm install`
- `pnpm run check` (TypeScript typecheck)
- `pnpm run build`
- `pnpm test`
- `node dist/src/cli.js upgrade`
- `node dist/src/cli.js ignite`
- `node dist/src/cli.js gateway start --foreground true --port 4646`
- `node dist/src/cli.js gateway status`
- `node dist/src/cli.js project show`
- `node dist/src/cli.js gpu server list`
- `node dist/src/cli.js gpu server availability --server-id <id>`
- `node dist/src/cli.js gpu ssh profile list`
- `node dist/src/cli.js gpu ssh session list`
- `node dist/src/cli.js gpu job list`
- `node dist/src/cli.js gpu job exec --run-id <id> --command "<remote command>"`

Useful repository checks:

- `rg --files docs src tests projects/SKILLS`
- `rg -n "pattern" docs/spec.md docs/VISION.md README.md src tests`
- `git diff -- docs/spec.md docs/VISION.md README.md AGENTS.md`
- `git status --short`
- `npm pack --dry-run`

## Coding Style & Naming Conventions
- Language: TypeScript (Node.js ESM).
- Keep code ASCII unless non-ASCII is required.
- Prefer small, focused modules and explicit types on public interfaces.
- Naming: `kebab-case` filenames, `camelCase` functions/variables, `PascalCase` classes.
- Keep state normalization and path-building logic deterministic and easy to test.
- Prefer updating provider/runtime defaults in one place (`src/provider.ts`) and secret/env behavior in one place (`src/secrets.ts`).
- Keep CLI copy, onboarding prompts, and Telegram responses concise and concrete.
- Keep comments concise and only where logic is non-obvious.

## Testing Guidelines
- Place tests in `tests/`.
- Use deterministic tests with the built-in Node test runner.
- Keep coverage focused on:
  - `opencolab.json` defaults/migrations
  - project and agent file seeding plus prompt assembly (`PROJECT-AND-TEAM.md`, `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, `HEARTBEAT.md`, `SKILLS/`)
  - shared skills vs agent-local skills behavior
  - npm/package publish surface, packaged asset availability, and install-mode-aware upgrade behavior
  - provider defaults, auth modes, CLI args, runtime env wiring, and preflight/remediation behavior
  - availability-aware Runpod target normalization, fallback selection inputs, and per-location volume behavior
  - `ignite` onboarding branches, including keep-existing setup and Esc-to-skip flows
  - Telegram authorization, pairing flow, slash-command aliases, routing, and file/media handling
  - long-running task progress updates from provider runtime to Telegram without polluting conversation memory
  - conversation memory persistence in `memory/Session/` and `memory/Daily/`
  - background gateway service rendering/status logic where it is pure and testable
- Run `pnpm run check && pnpm run build && pnpm test` before pushing.

## Commit & Pull Request Guidelines
Use Conventional Commits:

- `feat: add pi-backed provider onboarding`
- `fix: preserve active agent during state normalization`
- `docs: sync spec readme and agents guidance`
- `test: cover telegram file routing fallback`

PRs should include:

- concise summary of what changed and why,
- affected files/modules,
- verification steps run,
- follow-up work or limitations.

## Security & Configuration Tips
- Never commit secrets (API keys, tokens, private keys).
- Use environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `RUNPOD_API_KEY`, `TELEGRAM_BOT_TOKEN`).
- Provider CLI execution defaults to 30 minutes and can be overridden locally with `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS`.
- Keep local runtime artifacts out of git:
  - `opencolab.json`
  - `.env.local`
  - `.opencolab/`
  - `projects/*/experiments/runs/`
  - `projects/*/AGENTS/*/memory/`
  - `projects/*/memory/TelegramInbox/`
- Redact personal or host-identifying information when sharing logs/docs externally.
- Provider CLIs run with workspace access; keep added directories and permission changes narrowly scoped.
