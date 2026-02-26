# 🐙 OpenColab - personal multi-agent AI research lab

<p align="center">
  <img src="header.png" alt="OpenColab banner" />
</p>

OpenColab is a personal multi-agent AI research lab for running parallel research and coding workstreams with multiple local AI CLIs.

The project keeps the original lab spirit:

- one coordinator/research-lead role for planning and critique
- multiple worker agents for parallel execution
- optional reviewer role for quality checks
- iterative cycles with human approval checkpoints

At the same time, v1 stays intentionally simple:

- many instances of `claude`, `codex`, and `gemini`
- one small local control process
- local persistence (SQLite + files)
- local CLI + local web interface for control
- optional Docker isolation per agent

## Why OpenColab

- Increase research throughput with parallel agents.
- Keep quality with review and manual checkpoints.
- Build reusable project memory and artifact history.

## v1 Architecture

- One Node.js TypeScript process for orchestration, API, CLI, and web UI.
- Provider adapters normalize execution across `claude`, `codex`, and `gemini`.
- Template + instance model supports many agent instances per provider.
- SQLite stores projects, agents, runs, tasks, events, and approvals.
- Filesystem stores prompts, outputs, artifacts, and logs.

## v1 Workflow

1. Create a project and register agent templates/instances.
2. Start a run from a research or coding goal.
3. Coordinator decomposes the goal into subtasks.
4. Worker agents execute subtasks in parallel.
5. Reviewer (optional) summarizes findings and conflicts.
6. You approve, rerun, pause, or stop from CLI or web UI.

## v1 Scope

Includes:

- multi-provider support for `claude`, `codex`, `gemini`
- many instances per provider
- local web interface for managing agents and runs
- manual checkpoints and reruns
- optional Docker isolation per instance

Does not include:

- multi-tenant user accounts
- heavy distributed infrastructure
- autonomous long-running swarms without checkpoints
- cloud autoscaling infrastructure

## Control Surfaces

### CLI

Planned core commands:

- `opencolab init`
- `opencolab project create <name>`
- `opencolab agent template add`
- `opencolab agent instance add`
- `opencolab agent list`
- `opencolab run start --project <name> --goal "<text>"`
- `opencolab run status <run_id>`
- `opencolab run logs <run_id>`
- `opencolab run approve <run_id>`
- `opencolab run pause <run_id>`
- `opencolab run stop <run_id>`
- `opencolab task rerun <task_id> --agent <agent_id>`

### Local Web Interface

The local web UI is for:

- managing agent instances (create/edit/enable/disable)
- monitoring active/completed runs
- approving/pausing/stopping runs
- inspecting task logs and outputs
- rerunning failed tasks with another instance

## Status

Specification-first project.

Current source of truth:

- [spec.md](spec.md)

## License

MIT. See [LICENSE](LICENSE).
