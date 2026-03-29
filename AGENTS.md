# Repository Guidelines

## Project Structure & Module Organization
OpenColab is a TypeScript/Node.js ESM CLI and local gateway for a multi-project, multi-agent research workflow.
Keep repository guidance aligned with the actual runtime, not aspirational structure.

Top-level sources of truth:

- `docs/spec.md`: source of truth for requirements and architecture.
- `docs/VISION.md`: product direction and long-term intent.
- `README.md`: quickstart, high-level overview, and condensed runtime/reference guide.
- `package.json`: npm package metadata, published CLI surface, and pack/publish lifecycle hooks.
- `install.sh`: package-first macOS/Linux installer and command shim setup, with optional `--hacky` git-clone fallback.
- `install.ps1`: package-first Windows PowerShell installer and command shim setup, with optional `--hacky` git-clone fallback.
- `projects/SKILLS/`: shared built-in skill library copied into agent prompts, not per-project duplicates, including search, summarization, grounded paper QA, image, and architecture-diagram workflows. Packaged installs must ship this directory too.
- `src/`: TypeScript implementation.
- `src/agent-templates/`: built-in agent markdown scaffolds loaded by the runtime when seeding agent files and prompt context, with shared files in `shared/` and role-specific folders such as `professor/`, `beginner/`, and `specialist/`. Packaged installs must ship the runtime-accessible equivalents.
- `tests/`: Node `node:test` suite.

Core implementation areas:

- `src/cli.ts`: CLI entrypoint, top-level help/version output, interactive prompts, setup flows including standalone provider-key writes, and gateway lifecycle commands.
- `src/ignite.ts`: first-run onboarding for project selection, curated provider model/auth setup, direct API-key setup links, BotFather token guidance, built-in shared-tool key setup including `GEMINI_API_KEY` prerequisites for Gemini shared tools and `pageindex-grounded`, Telegram setup, and pairing.
- `src/runtime.ts`: stateful orchestration across config, project state, gateway routing, memory, and provider execution.
- `src/experiments.ts`: local experiment bookkeeping helpers for target snapshots, run manifests, status files, logs, artifacts, and sync metadata.
- `src/gpu-providers/runpod/index.ts`: Runpod-backed execution-target validation, availability-aware location/GPU selection, Pod lifecycle, SSH sync/bootstrap/launch, and run reconciliation.
- `src/http.ts`: local HTTP server, health/state endpoints, Telegram webhook ingestion, and optional long polling startup.
- `src/gateway.ts`: Telegram authorization, pairing, command routing, typing updates, and message/file handling.
- `src/gateway-service.ts`: persistent background gateway service management for macOS `launchd` and Linux `systemd`.
- `src/telegram-poller.ts`: Telegram long-polling loop and update ingestion.
- `src/upgrade.ts`: install-aware OpenColab upgrade flow for git/source checkouts plus operator-facing guidance for packaged installs.
- `src/provider.ts`: provider defaults, runtime selection, auth-mode support, CLI args, and env wiring.
- `src/provider-agent.ts`: provider-backed execution, runtime preflight/error handling, and provider-to-gateway progress-event forwarding.
- `src/agent.ts`: agent file seeding, shared/agent-local skill discovery, and prompt assembly.
- `src/agent-templates.ts`: built-in agent template loading and default-doc resolution.
- `src/conversation.ts`: per-agent session logs, previous-day summaries, and prompt-memory loading.
- `src/install.ts`: install-root detection, package-vs-git install mode behavior, and runtime-root resolution across `OPENCOLAB_ROOT`, packaged-install defaults, and cwd fallback for source checkouts.
- `src/project-config.ts`: `opencolab.json` defaults, normalization, migration, and project/agent path helpers.
- `src/config.ts`: root config, runtime-root-aware path resolution, and local env loading.
- `src/secrets.ts`: `.env.local` secret read/write helpers.
- `src/types.ts`: shared persisted-state and runtime interfaces.

Agent contract details that matter for implementation:

- Each project must seed `projects/<project_id>/PROJECT-AND-TEAM.md` as the canonical shared project context file visible to all agents.
- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`.
- Required agent files are `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, plus agent-local `SKILLS/`.
- Shared skills live only under `projects/SKILLS/`; do not duplicate them into each project or agent. Source and packaged installs must both provide the built-in shared skill library.
- The shared `block-diagram` skill defaults to compact layouts with unlabeled arrows, supports optional LaTeX equation blocks when they materially clarify a model or pipeline, and only uses edge labels when they carry concrete meaning such as a protocol or payload, not generic `input` or `output` text.
- The shared `fast-search`, `pro-search`, and `deep-search` skills must keep their `findings.md` formats stable while also producing a companion literature-map block diagram through `block-diagram`, returning concise, friendly channel-agnostic summaries, and, when appropriate, returning `findings.md` plus a PNG-first diagram through the active channel's file-delivery mechanism, with SVG fallback if PNG rendering is unavailable.
- The shared `pageindex-grounded` skill is the canonical local-first path for grounded follow-up QA over already-downloaded papers. It must keep selection bounded, cache PageIndex trees under `research/pageindex/`, use `GEMINI_API_KEY` for the local PageIndex runner, and answer with exact paper or page references plus explicit limitations when coverage is partial.
- The shared `pdf-figure-extract` skill is the canonical local-first path for extracting and returning figures from already-downloaded papers. It must use PyMuPDF, work even when PageIndex artifacts are missing, optionally reuse `research/pageindex/` to narrow candidate pages, and require multimodal verification of shortlisted figure candidates when the active provider supports local image inspection.
- The shared `runpod-job` skill is the canonical AI-facing path for operating Runpod-backed GPU servers and bounded remote GPU jobs through the OpenColab CLI rather than raw Runpod APIs.
- Conversation history belongs under agent-local `memory/Session/` and `memory/Daily/`, not under `.opencolab`.
- `TOOLS.md` is the user-owned local tooling layer; repo-managed built-in tool guidance must be injected at prompt-build time rather than copied into `TOOLS.md`.
- The seeded `AGENTS.md` contract must require agents to read `BOOTSTRAP.md` before `ALMA.md` whenever bootstrap still exists, so first-contact identity setup cannot be skipped.
- The seeded `AGENTS.md` contract must explain that `PROJECT-AND-TEAM.md` is the project-scoped shared context file, is read after `TODO.md` and before `MEMORY.md`, and must be consulted before agents edit it.
- The seeded `professor` contract must teach professor-led specialist creation through the OpenColab CLI, require human approval before creation, and require roster updates in `PROJECT-AND-TEAM.md`.
- The seeded `specialist` and `beginner` contracts must state that they do not create more specialists by default and should route staffing recommendations back through `professor`.
- The seeded `AGENTS.md` contract must describe `OPENCOLAB_PROGRESS_FILE` as the default OpenColab progress channel, include a valid JSON example, and guide agents to choose bounded useful progress events instead of milestone-only updates.
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
- `node dist/src/cli.js gpu job list`

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
  - project and agent file seeding plus prompt assembly (`PROJECT-AND-TEAM.md`, `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, `SKILLS/`)
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

- `feat: add xai provider onboarding`
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
