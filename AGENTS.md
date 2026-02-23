# Repository Guidelines

## Project Structure & Module Organization
This repository is currently specification-first.

- `spec.md`: source of truth for system requirements and architecture.
- `README.md`: high-level project overview and implementation direction.
- `LICENSE`: MIT license.
- `AGENTS.md`: contributor workflow and standards.

When code is introduced, use this layout:

- `src/` for application code (agents, orchestration, runtime adapters).
- `tests/` for automated tests.
- `docs/` for supporting design notes and diagrams.

Keep product behavior changes in `spec.md` first, then sync `README.md`.

## Build, Test, and Development Commands
There is no formal build pipeline yet. Use these commands for contributor checks:

- `rg --files` to list repository files quickly.
- `rg -n "pattern" spec.md README.md` to validate cross-document consistency.
- `git diff -- spec.md README.md AGENTS.md` to review documentation edits.
- `git status` to confirm intended changes only.

When Python code is added, standardize on:

- `python -m pytest` for tests.
- `python -m ruff check .` for linting.
- `python -m ruff format .` for formatting.

## Coding Style & Naming Conventions
- Prefer clear, direct Markdown with short paragraphs and actionable bullets.
- Keep headings descriptive and stable; avoid unnecessary renumbering churn.
- Use ASCII by default unless domain content requires Unicode.
- For future Python, follow PEP 8 and use type hints in public interfaces.
- Naming: `snake_case` for files/functions, `PascalCase` for classes.

## Testing Guidelines
- For documentation changes, test by consistency: requirements, workflow steps, and acceptance criteria must agree across files.
- For future code, place tests in `tests/` and name them `test_<feature>.py`.
- Prioritize deterministic tests for orchestration logic, approval gates, and reproducibility checks.

## Commit & Pull Request Guidelines
No commit history exists yet; adopt Conventional Commits:

- `docs: update AGENTS contributor guide`
- `feat: add ssh runtime adapter`
- `fix: correct checkpoint retry policy`

PRs should include:

- concise summary of what changed and why,
- affected files,
- verification steps performed,
- follow-up tasks or known limitations.

## Security & Configuration Tips
- Never commit secrets (API keys, SSH private keys, access tokens).
- Use environment variables and keep examples in a non-secret `.env.example`.
- Redact hostnames/usernames from logs and docs when sharing externally.
