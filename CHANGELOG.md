# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Fixed

- Windows background gateway tasks now run through a hidden supervisor script that restarts the foreground gateway after any exit, with Task Scheduler restart-on-failure kept as an outer safety net.

### Changed

- Seeded role `AGENTS.md` templates are now shorter and defer reusable maintenance, memory, tool, and runtime-surface rules to the shared agent files and injected built-in guidance.
- Shared `ALMA.md` guidance now carries common evidence-discipline rules for separating facts, assumptions, and open questions, citing non-obvious claims, stating uncertainty, and avoiding invented sources, data, results, or tool outputs.
- The bootstrap template no longer suggests example agent names during first-run identity setup.

## [0.2.0] - 2026-05-08

### Added

- Seeded `PROJECT-AND-TEAM.md` now includes front matter for a short project name, short description, and project emoji, and professor guidance now tells the lead agent to fill those fields once project identity is known.

### Changed

- OpenColab Studio now renders the projects list as a card grid with NotebookLM-style cards sourced from each project's `PROJECT-AND-TEAM.md` front matter (`project_name`, `project_description`, `project_emoji`), pastel tint hashed by project id, large emoji, 2-line clamped title, and a footer with relative activity time and agent count.
- OpenColab Studio agent cards now share the project card layout — pastel tint hashed by agent id, larger provider avatar top-left, active badge, 2-line clamped agent id, and a provider/model footer with a heart-icon heartbeat status line that shows the time-until-wake from `HEARTBEAT.md` `after:` or `idle` when none is scheduled — and both grids use the same responsive breakpoints and inset horizontal padding.
- The OpenColab Studio dashboard stat cards (active project, projects, agents, gateway) and the project detail Agents tab now share the same pastel-tinted, ring-less card style and inset horizontal padding as the projects and agents grids; the agent card markup is now a single shared component reused by the agents roster and project detail.
- The web interface spec was updated to require card grids for both projects and agents while keeping tables for artifacts and runs.

## [0.1.11] - 2026-05-04

### Fixed

- Telegram file return directives now upload local `file://` URLs and Windows absolute paths as multipart files while keeping remote URLs as Bot API references.
- Windows background gateway startup no longer opens an extra closeable Command Prompt window; Task Scheduler now launches the gateway through a hidden noninteractive PowerShell wrapper.

## [0.1.10] - 2026-05-04

### Fixed

- Windows `opencolab gateway start` now supports background mode through a per-user Task Scheduler task instead of failing with the macOS/Linux-only service error.
- Manual SSH live session state writes are now atomic, avoiding intermittent `Unknown manual SSH session` reads while the detached worker updates `session.json`.

## [0.1.9] - 2026-05-03

### Added

- Added OpenColab Studio, a local web interface served by the existing gateway that exposes a sidebar-driven dashboard for active project/agent, projects, agents, conversations, artifacts, GPU runs, and gateway/provider health.
- Added a Vite + React + Tailwind v4 + shadcn/ui client under `src/web/client/`, read-only `/api/web/*` DTO handlers under `src/web/server/`, and shared DTOs under `src/web/shared/types.ts`.
- Added `pnpm run web:dev` and `pnpm run web:build` scripts; `pnpm run build` now builds and copies the static client bundle into `dist/web/`, and the published package now ships `dist/web` alongside `dist/src`.
- Added the shared `latex-paper-writer` skill for creating, editing, Git-versioning, compiling, and returning scientific LaTeX papers, reports, and research-derived PDF summaries with venue-aware starter templates, experiment-result table generation, and PDF build validation.
- Added an optional ML/LLM architecture diagram template under the shared `block-diagram` skill for neural-network, transformer, training, and quantization diagrams.
- Added an `autoresearch` progress graph helper that plots the configured key metric over experiment number with green kept experiments, gray discarded experiments, short kept-experiment labels, and a running-best line.

### Changed

- The gateway HTTP server now delegates non-Telegram, non-`/api/state`, non-`/health` routes to the web layer, which serves `/api/web/*` JSON and the built client bundle from `dist/web/` (or `src/web/client/dist` in source mode), with credential values never exposed in health DTOs.
- Seeded agent instructions and built-in prompt guidance now explain how to configure `HEARTBEAT.md` and require explicit user approval before agents modify heartbeat schedules.
- Built-in shared-skill guidance now includes `latex-paper-writer`, and the LaTeX PDF build path prefers `latexmk` while keeping a bounded `pdflatex` fallback and platform-specific install remediation.
- Renamed the shared paper research skills from `fast-search`, `pro-search`, and `deep-search` to `fast-research`, `pro-research`, and `deep-research`, including their shared skill directories, prompt guidance, and LaTeX research-to-PDF integration reference.

## [0.1.8] - 2026-04-26

### Added

- Every agent now seeds an empty `HEARTBEAT.md`, and users can enable a delayed active-agent wake-up by adding a valid `after: <duration>` line such as `after: 30m`.
- Telegram now supports `/stop` for cancelling the active routed task in the same chat or topic, saving a compact recovery summary in session memory so a later turn can resume from the last known stage.

### Changed

- `ignite` onboarding now offers OpenAI `gpt-5.5`, Anthropic `claude-opus-4-7`, and matching OpenRouter model ids in the curated model chooser.
- Supported OpenAI and Anthropic reasoning-effort defaults now use `high`, and Anthropic Claude models now also expose `xhigh`.
- `HEARTBEAT.md` now supports `notify: live` for Telegram live status during heartbeat wake-ups and `message: <plain text>` to replace the default `continue` prompt.
- After an active-agent run completes, is stopped, or times out, OpenColab can now arm one quiet per-project heartbeat wake-up in `opencolab.json`, and the background gateway process will fire one internal `continue` turn when that same agent is still active and idle at the scheduled time.
- `HEARTBEAT.md` can now opt into one compact paired-chat Telegram follow-up with `notify: digest`, so meaningful heartbeat completions, timeouts, failures, and clear blockers no longer have to stay completely silent.
- Routed provider execution now exposes a gateway-owned cancellation path so stopped Telegram runs close live status cleanly, suppress stale late replies, and avoid appending cancelled partial output as a finished assistant answer.
- Telegram long polling now dispatches consumed updates without waiting for the previous routed run to finish, so `/stop` can interrupt an in-flight task instead of being blocked behind it.
- CLI help for `opencolab gpu ssh` and `opencolab gpu ssh session` now includes concrete manual-SSH session examples for `start`, `read`, `write`, and `stop`.
- Routed Codex runs now use `codex -a never exec --json --sandbox danger-full-access`, so clone, push, and other repo writes are not blocked by the default workspace-write sandbox, and OpenAI reasoning-effort injection now preserves the correct `codex exec` argument order.
- Seeded agents now use a stronger completeness-first `ALMA.md` standard that explicitly prefers permanent fixes, searching before building, and testing before shipping when the real solution is within reach.
- The built-in `autoresearch` agent now seeds a dedicated `ALMA.md` and stricter continuity guidance so repo-contract details, repeated user corrections, rejected paths, and lessons from failed runs carry forward across experiment loops.
- Seeded agents now treat `TODO.md` as a lean live working list for current focus, top priorities, and active blockers only, defaulting to at most three open priority items and continuously pruning completed or stale entries instead of accumulating backlog or done-history there.

### Removed

- Legacy Codex default CLI arg migration support for older `["exec", "-"]` configs.

## [0.1.7] - 2026-04-06

### Added

- Anthropic provider setup now supports `oauth` mode through Claude Code login, including runtime preflight and remediation when the stored Claude session is missing or API-key auth is still active.
- Built-in `pi`-backed provider support for `openrouter` and `kimi`, including `opencolab setup model`, `ignite` onboarding, runtime env wiring for `OPENROUTER_API_KEY` and `KIMI_API_KEY`, and the upstream `kimi-coding` provider mapping used by `pi`.
- A shared `autoresearch` skill plus a built-in `autoresearch` specialist template for iterative keep/discard experiment loops over one explicitly configured repo, with explicit repo contract requirements, disposable branch/worktree guidance, and default ownership of sustained experiment-loop work by the `autoresearch` agent.
- Project-scoped `opencolab gpu ssh profile ...` and `opencolab gpu ssh session ...` commands for saving user-managed Runpod Pod SSH details, setting per-agent defaults, and running transcript-backed live manual SSH sessions.

### Changed

- OpenAI defaults and onboarding examples now use `gpt-5.4`, and the OpenRouter OpenAI example now uses `openai/gpt-5.4`.
- `ignite` onboarding and `opencolab setup model` now expose native reasoning-effort selection for supported models, currently including OpenAI `gpt-5.4` (`low`, `medium`, `high`, `xhigh`) and Anthropic Claude on the Claude runtime (`low`, `medium`, `high`, `max`).
- Shared workflow and template docs now mention `autoresearch` alongside the other built-in shared skills, and the README inspiration list now includes `karpathy/autoresearch`.
- Professor-facing built-in staffing guidance now explicitly calls out `opencolab agent create --agent-id autoresearch` when a project needs a dedicated owner for sustained experiment-loop work.
- The shared `runpod-job` guidance now defaults to a user-managed Runpod Pod workflow where the human creates the Pod, provides the `pod_id`, and the agent uses direct SSH, while keeping the OpenColab-managed `gpu server` and `gpu job` lifecycle as an explicit opt-in for `run_id`-tracked work.
- Telegram management from paired chats now centers on `/projects`, `/agents`, and `/session_reset`, with picker-based project and agent selection and session reset remaining available while project and agent creation stay CLI-driven.
- Telegram live status now waits for real runtime progress before creating a status surface, keeps private chats compact, and streams a bounded recent tool-activity list through one editable message in groups.
- Telegram live status now marks the newest visible step with `🟢` and older still-visible steps with `⚪` so the active step is easier to spot while a run is streaming.
- Routed Telegram text replies are now prefixed with the active agent id on the first line so one Telegram chat can distinguish which agent answered without polluting conversation memory.
- Routed Codex runs now normalize nested `item.*` lifecycle events and `turn.completed` into user-facing Telegram live status text instead of leaking raw protocol names such as `item.started`.
- Routed Claude Code runs now use the current `claude -p --verbose --output-format stream-json` contract so Telegram live status continues to work with newer Claude Code releases.
- Existing saved Claude-runtime provider configs on recognized older default arg sets now auto-migrate to the current streaming contract when OpenColab loads state, so upgraded installs recover Telegram live status without requiring manual model reconfiguration.
- Anthropic native reasoning flags are now inserted before the Claude CLI `-- <prompt>` separator so reasoning-effort settings do not break current Claude runtime invocation.
- Telegram final text replies are now split into ordered chunks before hitting the Bot API text limit, preserve active group topic routing, and log Telegram API status and descriptions when delivery fails instead of dropping oversized replies silently.

### Removed

- Telegram support for the older `/project ...`, `/agent ...`, and `/session reset` text command families, along with the older slash-menu aliases such as `/project_create`.
- The shared `fast-search`, `pro-search`, and `deep-search` skill docs no longer call out optional `PAPERCLI_SEMANTIC_API_KEY` and `PAPERCLI_SERPAPI_KEY` prerequisites.

## [0.1.6] - 2026-04-02

### Changed

- New/default Runpod execution targets and the `ignite` curated Runpod preset now default to the `keep_warm` auto-stop policy.
- The shared `runpod-job` workflow guidance now defaults to `NVIDIA A100 80GB PCIe`, uses `keep_warm`, and requires agents to ask whether a warm Pod should keep running after a terminal-backed run completes.
- One-link installer-managed installs now persist managed install metadata so `opencolab upgrade` can upgrade both installer-managed package installs and `--hacky` installer-managed clone installs through the same CLI entrypoint.
- Packaged installs now keep using the platform runtime root when `OPENCOLAB_ROOT` is unset instead of letting stray cwd-local `opencolab.json` or `.env.local` files silently hijack the runtime root.
- The shell and PowerShell one-link installers now warn when another `opencolab` command appears earlier on `PATH` than the installer-managed shim.

## [0.1.5] - 2026-03-31

### Changed

- Routed provider runs that hit `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS` now preserve the inbound user request and append a compact recovery note to the active session memory, so the next turn can resume from the last known stage instead of starting cold.
- The shared `runpod-job` workflow guidance now requires detached-only launches with `--wait false` for every Runpod job, returns the `run_id` promptly for later inspection, refreshes local log snapshots with `opencolab gpu job status` before reporting on a run, and reviews `bootstrap`, `stdout`, `stderr`, and `poller` when summarizing outcomes.
- Telegram now exposes `/projects` and `/agents` picker commands that return inline buttons, and the gateway can process callback-query taps to switch the active project or agent without requiring typed ids.

## [0.1.4] - 2026-03-30

### Added

- `opencolab gpu server availability --server-id <id>` now reports a live Runpod datacenter and GPU capacity snapshot for one configured target before launch.
- `opencolab gpu job exec --run-id <id> --command "<command>"` now runs one bounded remote command over the launched Runpod Pod SSH path and returns `runId`, `targetId`, `exitCode`, `stdout`, and `stderr`.

### Changed

- Bare `opencolab` help now shows the installed CLI version immediately, and `opencolab --version` / `opencolab version` print it directly.
- New/default Runpod execution targets and the `ignite` curated Runpod preset now default to the `pytorch-cu12` bootstrap profile instead of `python-ml`.
- The shared `runpod-job` workflow guidance now prefers detached launch with `--wait false` for longer jobs, returns the `run_id` promptly for later inspection, and requires failed or degraded runs to be surfaced with a clear next action.
- Runpod availability checks now surface the best current datacenter and GPU match, preserve configured fallback order, and warn about Pod-API-incompatible datacenters or known storage-provisioning failures.
- Runpod provisioning now falls back cleanly across preferred datacenters when per-location network-volume creation fails, and normalizes shorthand GPU names to the canonical Runpod GPU ids required by Pod creation.
- The shared `runpod-job` skill now teaches agents to run live availability checks before launch when stock matters, treat availability as a snapshot rather than a reservation, and distinguish launch failures from slower remote bootstrap work after SSH is already available.
- The shared `runpod-job` workflow and built-in agent guidance now teach agents to use `gpu job exec` for bounded direct Pod inspection instead of exposing raw SSH details.

## [0.1.3] - 2026-03-29

### Changed

- Packaged installs now default their runtime root to `~/.opencolab` on macOS/Linux or `%LOCALAPPDATA%\OpenColab\root` on Windows when `OPENCOLAB_ROOT` is unset, instead of falling back to the caller's current working directory.

## [0.1.2] - 2026-03-29

### Added

- npm package metadata now links the published package back to the GitHub repository, issue tracker, and changelog.

### Changed

- Provider CLI execution now defaults to a 30 minute timeout instead of 10 minutes and remains configurable via `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS`.

### Removed

- Legacy support for the `OPENCOLAB_CODEX_TIMEOUT_MS` timeout env var.

## [0.1.1] - 2026-03-27

### Added

- Windows PowerShell one-link installer support via `install.ps1`.
- Optional `--hacky` git-clone fallback mode for the one-link installers when the desired npm package version is unavailable.
- Project-scoped `PROJECT-AND-TEAM.md` shared context seeded for new/default projects and loaded into every agent prompt.
- Professor-led specialist creation guidance, including explicit `opencolab agent create --agent-id <id>` and per-agent `opencolab setup model --agent-id <id> ...` workflow references.

### Changed

- `install.sh` now fails fast on Windows and directs users to the PowerShell installer.
- Seeded agent startup guidance now requires reading `BOOTSTRAP.md` before `ALMA.md` while bootstrap still exists, preventing first-contact identity setup from being skipped.
- Seeded agent instructions now treat `PROJECT-AND-TEAM.md` as the canonical shared project context and require agents to follow its maintenance rules before editing it.
- Prompt construction now loads shared project context after `TODO.md` and before agent-local `MEMORY.md`.
- Seeded professor guidance now treats specialist hiring as a normal lead-agent responsibility with human approval, while specialist and beginner agents route staffing recommendations back through professor by default.
- `PROJECT-AND-TEAM.md` now supports recording agent roster status such as proposed, created, configured, active, paused, or archived when it matters to the project.

## [0.1.0] - 2026-03-26

Initial public npm release of OpenColab.

### Added

- Multi-project, multi-agent local research workspace with CLI-first project and agent management.
- Telegram gateway support with pairing, routing, file handling, and bounded progress updates.
- Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- Shared built-in skills for search, paper summarization, grounded QA, figure extraction, block diagrams, and Runpod job workflows.
- Runpod GPU server and job management for bounded remote experiment execution.
- npm-installable `opencolab` CLI package with packaged runtime templates and shared skills.
