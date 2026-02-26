# OpenColab v1 Specification (Personal, Minimal, Multi-CLI)

**Status:** Draft v3  
**Date:** February 26, 2026  
**Audience:** Solo maintainer

## 1. Purpose

OpenColab is a personal multi-agent orchestrator for running many local AI CLI agents on the same goal.

v1 focuses on:

- many instances of `claude`, `codex`, and `gemini`
- simple local operations
- low implementation complexity
- clear human control checkpoints

## 2. Product Goals

- Run multiple agents in parallel across different CLI providers.
- Support many instances per provider (for example `claude_worker_1`, `claude_worker_2`, `codex_worker_1`).
- Keep one small control-plane process with minimal moving parts.
- Provide CLI and local web management for agents and runs.
- Persist state and artifacts locally with straightforward recovery.

## 3. Non-Goals (v1)

- Multi-tenant accounts, team permissions, or cloud SaaS features.
- Heavy distributed systems (Kubernetes, Temporal, Redis/NATS).
- Autonomous end-to-end paper pipeline.
- Full GUI computer-use/desktop automation.
- Mandatory Docker isolation for all agents.

## 4. Design Principles

- Small enough to understand in one sitting.
- Provider-agnostic orchestration via adapter contracts.
- Instance isolation first; stronger isolation optional.
- Human-in-the-loop for run progression.
- Reliability before sophistication.
- Code-first customization, minimal config sprawl.

## 5. Primary Use Case

You submit one goal (research or coding), and OpenColab:

1. Creates a run.
2. Uses a coordinator agent to decompose the goal.
3. Dispatches subtasks to worker instances across `claude`/`codex`/`gemini`.
4. Collects outputs into a single run record.
5. Runs a reviewer step.
6. Waits for your approve/rerun/stop decision.

## 6. v1 Scope

### In Scope

- 3 to 12 agent instances.
- Adapter support for `claude`, `codex`, `gemini`.
- Multiple instances per provider.
- Local SQLite state.
- Filesystem artifact and log storage.
- Manual checkpoint controls.
- Local web interface for managing agents and runs.
- CLI parity for core operations.

### Out of Scope

- Auto-scaling cloud workers.
- Long-running autonomous swarms without checkpoints.
- Full literature indexing pipelines.
- Advanced model capability benchmarking automation.

## 7. Architecture Overview

### 7.1 Single Process Control Plane

One Node.js TypeScript process handles:

- orchestration loop
- adapter execution
- persistence
- local HTTP API
- local web UI
- CLI command entrypoints

### 7.2 Core Modules

| File | Purpose |
|------|---------|
| `src/index.ts` | Process bootstrap |
| `src/orchestrator.ts` | Run lifecycle and scheduling |
| `src/config.ts` | Config loading and validation |
| `src/db.ts` | SQLite access |
| `src/agent-registry.ts` | Agent template and instance management |
| `src/router.ts` | Task assignment |
| `src/agent-runner.ts` | CLI subprocess execution, timeout, retry |
| `src/adapters/*.ts` | Provider CLI adapters |
| `src/checkpoints.ts` | Approve/pause/resume/stop logic |
| `src/http.ts` | Local HTTP API |
| `src/web.ts` | Local web interface routes/assets |
| `src/cli.ts` | `opencolab` CLI |

### 7.3 Data and Files

- **SQLite**: `projects`, `agent_templates`, `agent_instances`, `runs`, `tasks`, `events`, `approvals`
- **Filesystem**: prompts, outputs, artifacts, logs
- **Project memory**: markdown context per project

### 7.4 Suggested Repository Layout

```txt
opencolab/
  src/
    adapters/
    web/
  projects/
    <project_name>/
      memory.md
      agents/
        <agent_id>/
      runs/
        <run_id>/
          prompts/
          outputs/
          artifacts/
          logs/
  opencolab.db
```

## 8. Agent Model

### 8.1 Roles

- **Coordinator**: decomposes goals and decides next iteration plan.
- **Worker**: executes assigned subtasks.
- **Reviewer** (optional): compares outputs, flags conflicts and risk.

### 8.2 Template and Instance Model

To support many agents cleanly:

- **Template** defines provider CLI behavior.
- **Instance** is a runnable agent with its own workspace and limits.

Template fields:

- `template_id`
- `provider` (`anthropic` | `openai` | `google`)
- `cli_command` (`claude` | `codex` | `gemini`)
- `default_args`
- `default_env`

Instance fields:

- `agent_id`
- `template_id`
- `role`
- `workspace_path`
- `max_runtime_sec`
- `retry_limit`
- `isolation_mode` (`host` | `docker`)
- `enabled`

## 9. Provider Adapter Contract

All adapters implement the same interface:

```ts
type AgentInput = {
  runId: string;
  taskId: string;
  prompt: string;
  workspacePath: string;
  contextFiles: string[];
};

type AgentOutput = {
  status: "ok" | "error" | "timeout";
  stdout: string;
  stderr: string;
  outputFiles: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
};
```

Adapter responsibilities:

- build provider-specific command and args
- run subprocess with controlled environment
- normalize results into `AgentOutput`
- return consistent structured errors

## 10. Orchestration Lifecycle

1. **Run created** with goal and constraints.
2. **Planning** by coordinator (2 to 12 subtasks).
3. **Dispatch** to worker instances based on availability and limits.
4. **Execution** in parallel up to global concurrency.
5. **Review** by reviewer or coordinator fallback.
6. **Checkpoint** requiring user action.
7. **Close** with final summary and artifact index.

## 11. Scheduling and Concurrency

- Global concurrency default: `4`
- Per-agent max concurrent tasks default: `1`
- Queue policy: FIFO within a run
- Retry policy default: `1` retry for failures
- Timeout policy: per instance `max_runtime_sec`

## 12. Control Surfaces

### 12.1 CLI (Required)

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

### 12.2 Web Interface (Required, Local-Only)

The web UI must support:

- create/edit/enable/disable agent instances
- view active and completed runs
- approve/pause/stop runs
- inspect task outputs and logs
- rerun failed tasks with another agent instance

## 13. Isolation and Security

- Each instance writes only inside its workspace.
- Shared write path allowed only for run-level artifacts.
- Secrets come from local environment variables, never from source files.
- Subprocess env is explicit and minimal.
- Docker isolation is optional and configured per instance.

## 14. Reliability Requirements

- durable run and task state in SQLite
- atomic writes for task logs and outputs
- recoverable process restart (resume from persisted run state)
- deterministic timestamps and event records
- pause/resume without dropping task history

## 15. Observability

- per-run `events.jsonl`
- per-task stdout/stderr logs
- final run report with:
  - task results
  - retries/timeouts
  - artifact paths
  - reviewer summary

## 16. Implementation Plan

### Milestone 1: Core Skeleton

- initialize SQLite schema
- implement one adapter end-to-end
- implement coordinator + one worker run
- ship CLI: `init`, `run start`, `run status`

### Milestone 2: Multi-Instance Multi-Provider

- implement `claude`, `codex`, `gemini` adapters
- add template/instance registry
- implement parallel dispatch and checkpoint flow
- add CLI run controls: approve/pause/stop/rerun

### Milestone 3: Local Web Management

- implement local HTTP API
- implement web pages for agent and run management
- ensure CLI and web use same service layer
- harden timeout/retry/recovery behavior

## 17. Acceptance Criteria (v1)

- at least 6 configured agent instances on one machine
- at least 2 instances per CLI type where installed
- at least 6 subtasks can run in one run with parallel execution
- task-level prompt/output/timestamps/status persisted
- run controls work from both CLI and web UI
- failed task rerun works with alternate agent instance
- no required infrastructure beyond local Node.js, SQLite, and installed CLIs

## 18. Locked v1 Defaults

- Provider CLIs: `claude`, `codex`, `gemini`
- Isolation default: `host` (`docker` opt-in)
- Global max concurrency default: `4`
- Adapter output contract: raw text plus normalized metadata

## 19. Deferred to v2+

- team access control
- cloud worker pools and GPU scheduling
- automatic capability benchmarking and auto-routing
- advanced research memory ingestion and retrieval
- nested swarm orchestration

---

This spec defines a practical, personal-use baseline: many local agent instances, multiple CLI providers, simple orchestration, and manageable operations through CLI plus local web interface.
