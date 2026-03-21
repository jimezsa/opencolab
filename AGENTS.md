# Repository Guidelines

## Project Structure & Module Organization
OpenColab is a TypeScript/Node.js ESM CLI and local gateway for a multi-project, multi-agent research workflow.
Keep repository guidance aligned with the actual runtime, not aspirational structure.

Top-level sources of truth:

- `docs/spec.md`: source of truth for requirements and architecture.
- `docs/VISION.md`: product direction and long-term intent.
- `README.md`: quickstart and high-level overview.
- `install.sh`: user installer and command shim setup.
- `projects/SKILLS/`: shared built-in skill library copied into agent prompts, not per-project duplicates, including search, summarization, image, and architecture-diagram workflows.
- `src/`: TypeScript implementation.
- `src/agent-templates/`: built-in agent markdown scaffolds loaded by the runtime when seeding agent files and prompt context, with shared files in `shared/` and role-specific folders such as `professor/`, `beginner/`, and `specialist/`.
- `tests/`: Node `node:test` suite.

Core implementation areas:

- `src/cli.ts`: CLI entrypoint, interactive prompts, setup flows including standalone provider-key writes, and gateway lifecycle commands.
- `src/ignite.ts`: first-run onboarding for project selection, curated provider model/auth setup, built-in Gemini key setup, Telegram setup, and pairing.
- `src/runtime.ts`: stateful orchestration across config, project state, gateway routing, memory, and provider execution.
- `src/http.ts`: local HTTP server, health/state endpoints, Telegram webhook ingestion, and optional long polling startup.
- `src/gateway.ts`: Telegram authorization, pairing, command routing, typing updates, and message/file handling.
- `src/gateway-service.ts`: persistent background gateway service management for macOS `launchd` and Linux `systemd`.
- `src/telegram-poller.ts`: Telegram long-polling loop and update ingestion.
- `src/provider.ts`: provider defaults, runtime selection, auth-mode support, CLI args, and env wiring.
- `src/provider-agent.ts`: provider-backed execution, runtime preflight/error handling, and provider-to-gateway progress-event forwarding.
- `src/agent.ts`: agent file seeding, shared/agent-local skill discovery, and prompt assembly.
- `src/agent-templates.ts`: built-in agent template loading and default-doc resolution.
- `src/conversation.ts`: per-agent session logs, previous-day summaries, and prompt-memory loading.
- `src/project-config.ts`: `opencolab.json` defaults, normalization, migration, and project/agent path helpers.
- `src/config.ts`: root config and local env loading.
- `src/secrets.ts`: `.env.local` secret read/write helpers.
- `src/types.ts`: shared persisted-state and runtime interfaces.

Agent contract details that matter for implementation:

- Agent directories live under `projects/<project_id>/AGENTS/<agent_id>/`.
- Required agent files are `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, plus agent-local `SKILLS/`.
- Shared skills live only under `projects/SKILLS/`; do not duplicate them into each project or agent.
- The shared `block-diagram` skill defaults to compact layouts with unlabeled arrows; only use edge labels when they carry concrete meaning such as a protocol or payload, not generic `input` or `output` text.
- Conversation history belongs under agent-local `memory/Session/` and `memory/Daily/`, not under `.opencolab`.
- `TOOLS.md` is the user-owned local tooling layer; repo-managed built-in tool guidance must be injected at prompt-build time rather than copied into `TOOLS.md`.
- The seeded `AGENTS.md` contract must include the `OPENCOLAB_PROGRESS_FILE` helper, a valid JSON example, and guidance that agents choose bounded useful progress events instead of milestone-only updates.
- The seeded agent docs must explain that Telegram file return directives must be emitted as raw `@telegram-file <json>` lines rather than markdown-wrapped snippets.

For behavior changes, update `docs/spec.md` first, then sync `README.md`, `AGENTS.md`, and code in the same change.

## Build, Test, and Development Commands
Use these commands for normal development:

- `pnpm install`
- `pnpm run check` (TypeScript typecheck)
- `pnpm run build`
- `pnpm test`
- `node dist/src/cli.js ignite`
- `node dist/src/cli.js gateway start --foreground true --port 4646`
- `node dist/src/cli.js gateway status`
- `node dist/src/cli.js project show`

Useful repository checks:

- `rg --files docs src tests projects/SKILLS`
- `rg -n "pattern" docs/spec.md docs/VISION.md README.md src tests`
- `git diff -- docs/spec.md docs/VISION.md README.md AGENTS.md`
- `git status --short`

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
  - agent file seeding and prompt assembly (`AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, `MEMORY.md`, `SKILLS/`)
  - shared skills vs agent-local skills behavior
  - provider defaults, auth modes, CLI args, runtime env wiring, and preflight/remediation behavior
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
- Use environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `TELEGRAM_BOT_TOKEN`).
- Keep local runtime artifacts out of git:
  - `opencolab.json`
  - `.env.local`
  - `.opencolab/`
  - `projects/*/AGENTS/*/memory/`
  - `projects/*/memory/TelegramInbox/`
- Redact personal or host-identifying information when sharing logs/docs externally.
- Provider CLIs run with workspace access; keep added directories and permission changes narrowly scoped.
