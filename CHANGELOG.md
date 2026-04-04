# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Built-in `pi`-backed provider support for `openrouter` and `kimi`, including `opencolab setup model`, `ignite` onboarding, runtime env wiring for `OPENROUTER_API_KEY` and `KIMI_API_KEY`, and the upstream `kimi-coding` provider mapping used by `pi`.

### Changed

- The shared `runpod-job` guidance now defaults to a user-managed Runpod Pod workflow where the human creates the Pod, provides the `pod_id`, and the agent uses direct SSH, while keeping the OpenColab-managed `gpu server` and `gpu job` lifecycle as an explicit opt-in for `run_id`-tracked work.
- Telegram management from paired chats now centers on `/projects`, `/agents`, and `/session_reset`, with picker-based project and agent selection and session reset remaining available while project and agent creation stay CLI-driven.

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
