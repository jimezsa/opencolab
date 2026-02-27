# Repository Guidelines

## Project Structure & Module Organization
This repository now includes an implemented v1 baseline.

- `docs/spec.md`: source of truth for requirements and architecture.
- `docs/VISION.md`: product direction and long-term intent.
- `README.md`: quickstart and high-level overview.
- `src/`: TypeScript implementation.
- `tests/`: Node test suite.
- `SKILLS/`: installable skill definitions used by agents.

Core implementation areas:

- `src/orchestration/`: run lifecycle and scheduling.
- `src/adapters/`: provider adapter layer (`codex`, `claude_code`, `gemini`).
- `src/collaboration/`: chats and meetings.
- `src/web/` + `src/http.ts`: local web UI and API.
- `src/cli.ts`: command-line control surface.

For behavior changes, update `docs/spec.md` first, then sync `README.md` and code.

## Build, Test, and Development Commands
Use these commands for normal development:

- `pnpm install`
- `pnpm run check` (TypeScript typecheck)
- `pnpm run build`
- `pnpm test`
- `node dist/src/cli.js init`
- `node dist/src/cli.js web start --port 4646`

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
- Use deterministic tests for orchestration, approvals, and persistence behavior.
- Prefer end-to-end lifecycle coverage for run creation, task execution, checkpoint flow, and artifacts.
- Run `pnpm run check && pnpm run build && pnpm test` before pushing.

## Commit & Pull Request Guidelines
Use Conventional Commits:

- `feat: add ssh runtime adapter`
- `fix: handle missing provider CLI command`
- `docs: update architecture diagram`
- `test: cover approval state transitions`

PRs should include:

- concise summary of what changed and why,
- affected files/modules,
- verification steps run,
- follow-up work or limitations.

## Security & Configuration Tips
- Never commit secrets (API keys, tokens, private keys).
- Use environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, etc.).
- Keep local SQLite and runtime artifacts out of git:
  - `opencolab.json`
  - `opencolab.db`
  - `opencolab.db-wal`
  - `opencolab.db-shm`
  - `projects/`
- Redact personal or host-identifying information when sharing logs/docs externally.
