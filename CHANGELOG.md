# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Windows PowerShell one-link installer support via `install.ps1`.
- Optional `--hacky` git-clone fallback mode for the one-link installers when the desired npm package version is unavailable.
- Project-scoped `PROJECT-AND-TEAM.md` shared context seeded for new/default projects and loaded into every agent prompt.

### Changed

- `install.sh` now fails fast on Windows and directs users to the PowerShell installer.
- Seeded agent startup guidance now requires reading `BOOTSTRAP.md` before `ALMA.md` while bootstrap still exists, preventing first-contact identity setup from being skipped.
- Seeded agent instructions now treat `PROJECT-AND-TEAM.md` as the canonical shared project context and require agents to follow its maintenance rules before editing it.
- Prompt construction now loads shared project context after `TODO.md` and before agent-local `MEMORY.md`.

## [0.1.0] - 2026-03-26

Initial public npm release of OpenColab.

### Added

- Multi-project, multi-agent local research workspace with CLI-first project and agent management.
- Telegram gateway support with pairing, routing, file handling, and bounded progress updates.
- Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- Shared built-in skills for search, paper summarization, grounded QA, figure extraction, block diagrams, and Runpod job workflows.
- Runpod GPU server and job management for bounded remote experiment execution.
- npm-installable `opencolab` CLI package with packaged runtime templates and shared skills.
