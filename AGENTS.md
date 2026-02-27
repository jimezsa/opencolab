# Repository Guidelines

## Project Structure & Module Organization
This repository implements a minimal v1:

- `docs/spec.md`: source of truth for requirements and architecture.
- `docs/VISION.md`: product direction and long-term intent.
- `README.md`: quickstart and high-level overview.
- `src/`: TypeScript implementation.
- `tests/`: Node test suite.

Core implementation areas:

- `src/cli.ts`: command-line setup and operations.
- `src/http.ts`: local gateway/API server.
- `src/telegram-poller.ts`: Telegram long-polling ingest.
- `src/gateway.ts`: Telegram routing, pairing, typing feedback.
- `src/codex-agent.ts`: Codex-backed agent execution.
- `src/agent.ts`: agent context loading and prompt assembly.
- `src/project-config.ts`: `opencolab.json` persistence.
- `src/runtime.ts`: runtime wiring.

For behavior changes, update `docs/spec.md` first, then sync `README.md` and code.

## Build, Test, and Development Commands
Use these commands for normal development:

- `pnpm install`
- `pnpm run check` (TypeScript typecheck)
- `pnpm run build`
- `pnpm test`
- `node dist/src/cli.js init`
- `node dist/src/cli.js gateway start --port 4646`

Useful repository checks:

- `rg --files`
- `rg -n "pattern" docs/spec.md docs/VISION.md README.md`
- `git diff -- docs/spec.md docs/VISION.md README.md AGENTS.md`
- `git status`

## Coding Style & Naming Conventions
- Language: TypeScript (Node.js ESM).
- Keep code ASCII unless non-ASCII is required.
- Prefer small, focused modules and explicit types on public interfaces.
- Naming: `kebab-case` filenames, `camelCase` functions/variables, `PascalCase` classes.
- Keep comments concise and only where logic is non-obvious.

## Testing Guidelines
- Place tests in `tests/`.
- Use deterministic tests for pairing, gateway routing, and persistence behavior.
- Keep coverage focused on:
  - `opencolab.json` defaults/migrations
  - Telegram authorization and pairing flow
  - agent context file loading (`AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, `MEMORY.md`)
- Run `pnpm run check && pnpm run build && pnpm test` before pushing.

## Commit & Pull Request Guidelines
Use Conventional Commits:

- `feat: add telegram typing feedback`
- `fix: handle missing codex api key`
- `docs: align spec and readme`
- `test: cover pairing flow`

PRs should include:

- concise summary of what changed and why,
- affected files/modules,
- verification steps run,
- follow-up work or limitations.

## Security & Configuration Tips
- Never commit secrets (API keys, tokens, private keys).
- Use environment variables (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.).
- Keep local runtime artifacts out of git:
  - `opencolab.json`
  - `.env.local`
  - `.opencolab/`
  - `agents/`
- Redact personal or host-identifying information when sharing logs/docs externally.
