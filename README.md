# OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab banner" />
</p>

OpenColab is a personal multi-agent AI research lab designed to help researchers and accelerate scientific discoveries.

It follows an academic collaboration model:

- a **Professor agent** guides strategy and synthesis
- multiple **Student agents** execute experiments in parallel
- Student agents can challenge the Professor with evidence-based disagreement
- the **Human researcher** supervises and approves key decisions

## What OpenColab Enables

- Parallel research execution across multiple agents.
- Structured collaboration: group chat, private chats, and regular meetings.
- Human access to the team over Telegram.
- Practical runtimes for agent work: local machine, SSH compute, and Google Colab workflows.
- Flexible code collaboration: per-agent GitHub repositories and shared team repositories.
- Scientific writing pipeline: agents generate LaTeX papers and the human coauthors directly.
- Human-visible logs, artifacts, discussions, and decisions.

## v1 Focus

- Keep architecture simple and local-first.
- Prioritize reliability, auditability, and human control checkpoints.
- Deliver a practical power tool before advanced autonomy.

## Getting Started

```bash
npm install
npm run build
node dist/src/cli.js init
node dist/src/cli.js project create demo-lab
node dist/src/cli.js run start --project demo-lab --goal "Evaluate a new research idea"
node dist/src/cli.js run status <run_id>
```

Run local web control UI:

```bash
node dist/src/cli.js web start --port 4646
```

By default, v1 runs agent tasks in deterministic mock mode so the workflow works without installed CLIs.
Set `OPENCOLAB_FORCE_MOCK_CLI=0` to execute real CLI commands.

## Project Status

v1 baseline implementation is now included in `src/` with:

- local SQLite persistence
- parallel multi-agent orchestration
- CLI control surface
- local web control surface
- SKILLS directory support

Primary docs:

- [Product Spec](docs/spec.md)
- [Vision](docs/VISION.md)

## License

MIT. See [LICENSE](LICENSE).
