# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-03-26

Initial public npm release of OpenColab.

### Added

- Multi-project, multi-agent local research workspace with CLI-first project and agent management.
- Telegram gateway support with pairing, routing, file handling, and bounded progress updates.
- Provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- Shared built-in skills for search, paper summarization, grounded QA, figure extraction, block diagrams, and Runpod job workflows.
- Runpod GPU server and job management for bounded remote experiment execution.
- npm-installable `opencolab` CLI package with packaged runtime templates and shared skills.

### Changed

- Upgrade behavior now distinguishes between git/source installs and packaged installs so package users receive package-manager upgrade guidance instead of git-specific maintenance flow.
- npm packaging now ships the built CLI entrypoint and runtime-required shared skills without tracking `dist/` in git.

### Fixed

- OpenAI runtime logo visibility in dark mode in the README runtime table.
- README runtime install guidance now links directly to the upstream provider CLI installation pages.
