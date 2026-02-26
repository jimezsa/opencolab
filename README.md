# 🐙 OpenColab - personal multi-agent CLI orchestrator

<p align="center">
  <img src="header.png" alt="OpenColab banner" />
</p>

OpenColab is a personal project to orchestrate many local AI CLI agents on one goal.

It is built for simplicity:

- many instances of `claude`, `codex`, and `gemini`
- one small control process
- local persistence
- human checkpoints
- CLI + local web management

## What v1 Includes

- Multi-provider CLI adapters (`claude`, `codex`, `gemini`)
- Multiple instances per provider
- Coordinator, worker, and optional reviewer roles
- Local SQLite state
- Filesystem logs and artifacts
- Local web interface for agent and run management
- Optional Docker isolation per agent instance

## What v1 Does Not Include

- Multi-tenant user accounts
- Heavy distributed infrastructure
- Autonomous long-running swarms without checkpoints
- Full desktop computer-use automation
- Cloud worker autoscaling

## Architecture (v1)

- One Node.js TypeScript process for orchestration, API, CLI, and web UI
- Provider adapters normalize CLI execution results
- Template + instance model for scalable agent definitions
- SQLite for run/task/event/approval state
- Filesystem for prompts, outputs, artifacts, and logs

## Typical Flow

1. Create project.
2. Register agent templates and instances.
3. Start run with one goal.
4. Coordinator creates subtasks.
5. Workers execute in parallel.
6. Reviewer summarizes results.
7. You approve, rerun, pause, or stop.

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
