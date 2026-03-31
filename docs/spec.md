# OpenColab v1 Multi-Project Specification

## 1. Purpose

OpenColab v1 is a minimal personal research assistant that supports multiple projects, each with its own agents, and exposes control through CLI and Telegram.

## 2. Product Scope

v1 supports:

- multiple local projects
- multiple agents per project
- one active project at a time
- one active agent inside the active project
- one provider runtime per agent: `openai`, `anthropic`, `gemini`, or `minimax`
- optional project-scoped execution targets for bounded remote GPU experiments
- one remote experiment backend in scope first: Runpod Pods on Secure Cloud with attached network volumes and SSH access
- one user channel: Telegram
- one operator channel: OpenColab CLI

No parallel orchestration between agents/projects is included in this version.

## 3. Architecture

The reasoning runtime path is:

`Telegram -> Gateway -> Active Project -> Active Agent -> Provider Runtime`

The bounded remote experiment path is:

`Telegram/CLI -> Active Project -> Active Agent -> Experiment Planner -> Execution Target -> Remote Run`

Definitions:

- `Project`: isolated workspace entry persisted in `opencolab.json`.
- `Agent`: assistant instance under a project, with prompt-definition files.
- `ExecutionTarget`: named remote GPU environment defined at project scope.
- `ExperimentRun`: bounded remote execution attempt launched against an execution target.
- `Human`: defines the initial problem, goals, and constraints, then supports the agent group as an assistant for key decisions and key activities.
- `Gateway`: local service that validates Telegram pairing and routes messages to the active project/agent.

Architecture rule:

- agent provider/runtime and experiment execution target are separate layers; provider configuration must not be overloaded with remote GPU infrastructure state

## 4. Core Capabilities

Required:

- Create/list/select projects from CLI.
- Create/list/select agents from CLI (scoped to selected project).
- Create/list/select projects from Telegram chat commands.
- Create/list/select agents from Telegram chat commands.
- Route Telegram messages to the selected project/agent runtime.
- Route Telegram text and file messages (documents, photos, audio, video, voice, stickers, and related media) to the selected project/agent runtime.
- For inbound Telegram files, resolve the Telegram `file_id` to a local file inside the active project when possible, using collision-safe local filenames, and pass the local path to the agent runtime alongside metadata and caption text.
- Create/list/show/test/remove project-scoped GPU execution targets from CLI.
- Start/status/logs/fetch/cancel/list bounded remote GPU jobs from CLI.
- Persist project/agent/provider settings plus one shared Telegram configuration in `opencolab.json`.
- Persist execution-target settings in `opencolab.json` and experiment run records under the active project tree.

Not required in v1:

- web UI
- multi-user support
- background autonomous jobs
- cross-project concurrent execution
- arbitrary interactive remote shells exposed directly to agents

## 5. Filesystem Layout

Projects must live under:

- `projects/<project_id>/`

Each project must keep experiment bookkeeping under:

- `projects/<project_id>/experiments/targets/`
- `projects/<project_id>/experiments/runs/<run_id>/manifest.json`
- `projects/<project_id>/experiments/runs/<run_id>/status.json`
- `projects/<project_id>/experiments/runs/<run_id>/logs/`
- `projects/<project_id>/experiments/runs/<run_id>/artifacts/`
- `projects/<project_id>/experiments/runs/<run_id>/sync/`

Experiment bookkeeping requirements:

- `manifest.json` is immutable after launch except for implementation-safe metadata enrichment
- `status.json` is mutable and tracks lifecycle transitions and reconciliation notes
- `logs/` stores fetched stdout, stderr, bootstrap output, and OpenColab polling notes
- `artifacts/` stores files copied back from the remote run
- `sync/` stores generated sync lists or packaging metadata, not a default duplicate of the full project

Each project must keep its agents under:

- shared project context: `projects/<project_id>/PROJECT-AND-TEAM.md`
- default lead agent (`professor`): `projects/<project_id>/AGENTS/professor/`
- additional agents: `projects/<project_id>/AGENTS/<agent_id>/`
- shared skill library: `projects/SKILLS/`

Agent naming guidance:

- `professor` is the fixed default lead agent id for each project
- `beginner` is an optional built-in beginner-student agent id
- additional agents are PhD-style specialist agents
- additional agent ids should use memorable, descriptive names that reflect their specialty or work style
- additional agent ids do not need to follow a rigid `phd_*` naming scheme
- built-in agent templates live under `src/agent-templates/`, with shared scaffolds in `src/agent-templates/shared/` and role folders such as `src/agent-templates/professor/`, `src/agent-templates/beginner/`, and `src/agent-templates/specialist/`

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md` for agent-local tooling notes, additions, and overrides
- `USER.md`
- `TODO.md`
- `MEMORY.md`
- `SKILLS/` for agent-local skills

Shared project skills requirements:

- the repository must expose a shared `projects/SKILLS/` directory
- published package installs must also ship the built-in shared `projects/SKILLS/` directory so runtime fallback skill discovery does not require a git checkout
- skills are shared across all agents and all projects and must not be duplicated per agent or per project
- each skill lives under `projects/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from the shared `projects/SKILLS/` directory before using a specialized workflow
- the shared `block-diagram` skill is the deterministic path for autonomous D2 block-diagram generation and defaults to sketch-style rendering unless the user asks for clean output
- the shared `fast-search`, `pro-search`, and `deep-search` skills must use the shared `block-diagram` skill to render a companion literature-map overview that shows how the selected papers connect
- the shared `pageindex-grounded` skill is the canonical path for grounded follow-up QA over already-downloaded local PDFs and must keep retrieval bounded to a selected subset of local papers before answering
- the shared `pdf-figure-extract` skill is the canonical path for extracting and returning figures from already-downloaded local PDFs, optionally reusing PageIndex artifacts to narrow page selection before multimodal verification and delivery
- the shared `runpod-job` skill is the canonical AI-facing path for creating, validating, and reusing Runpod-backed GPU servers and bounded GPU jobs through the `opencolab gpu server` and `opencolab gpu job` CLI commands rather than raw Runpod APIs, and it must launch jobs in detached mode with `--wait false`, return the `run_id` promptly, inspect status or logs later only when the user explicitly asks about the run or asks to monitor it, use `opencolab gpu job exec --run-id <id> --command "<remote command>"` for bounded direct Pod inspection when remote SSH-backed access is needed, and when a run fails or degrades it should notify the user clearly and propose the next useful action

Agent-local skills requirements:

- each agent may keep unique agent-local skills under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- agent-local skills are visible only to that agent by default because they live inside the agent folder
- each agent-local skill lives under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from both the shared `projects/SKILLS/` library and the agent-local `SKILLS/` directory when applicable

Initialization requirements:

- when a project is created, `PROJECT-AND-TEAM.md` must be seeded at the project root from an internal runtime template
- when an agent directory is created, `AGENTS.md` must be seeded from an internal runtime template
- when an agent directory is created, `BOOTSTRAP.md` must be seeded from an internal runtime template for first-run identity discovery
- when an agent directory is created, `IDENTITY.md` must be seeded from an internal runtime template
- when an agent directory is created, `ALMA.md` must be seeded from an internal runtime template
- when an agent directory is created, `TOOLS.md` must be seeded from an internal runtime template for agent-local tooling notes, additions, and overrides
- when an agent directory is created, `USER.md` must be seeded from an internal runtime template
- when an agent directory is created, `TODO.md` must be seeded from an internal runtime template
- when an agent directory is created, `MEMORY.md` must be seeded from an internal runtime template
- the default `professor` agent must seed from the built-in `src/agent-templates/professor/` template folder in the source tree, and packaged installs must ship the equivalent built-in template assets required at runtime
- the built-in `beginner` agent id must seed from the built-in `src/agent-templates/beginner/` template folder in the source tree, and packaged installs must ship the equivalent built-in template assets required at runtime
- additional agents must seed from the built-in `src/agent-templates/specialist/` template folder in the source tree unless future runtime configuration chooses another built-in template
- template-specific files may fall back to `src/agent-templates/shared/` in the source tree when a role folder does not provide an override, and packaged installs must preserve that fallback behavior with shipped runtime assets
- in the current built-in layout, role folders provide `AGENTS.md` overrides and `src/agent-templates/shared/` provides the shared `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, and `MEMORY.md` templates
- when an agent directory is created, an empty `SKILLS/` directory must exist for agent-local skills
- the built-in `fast-search`, `pro-search`, `deep-search`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `nano-banana`, `block-diagram`, and `runpod-job` skills must be available from the shared `projects/SKILLS/` directory
- built-in tool guidance and built-in skill summaries must be repo-managed and injected into prompts at runtime rather than copied into agent-local `TOOLS.md`
- default templates must encode: human defines the initial problem first, then assists agents while they refine and execute
- default templates must encode: before deep investigation, agents must clarify the human's true intention for the topic
- default templates must encode: agents are the expert role and should involve the human for key decisions and support tasks
- default `AGENTS.md` must require agents to read and follow `BOOTSTRAP.md` before `ALMA.md` whenever `BOOTSTRAP.md` still exists, so first-contact identity setup cannot be skipped
- default `AGENTS.md` must explain that `PROJECT-AND-TEAM.md` is the canonical shared project context file, lives at project scope, and should be read after `TODO.md` and before `MEMORY.md`
- default `AGENTS.md` must require agents to read and follow the maintenance rules inside `PROJECT-AND-TEAM.md` before editing it
- default `professor` guidance must treat specialist creation as a normal lead-agent responsibility, require human approval before creation, and teach the exact OpenColab CLI path for creation through `opencolab agent create --agent-id <id>`
- default `professor` guidance must mention follow-up per-agent model setup through `opencolab setup model --agent-id <id> ...` when needed
- default `professor` guidance must require updating `PROJECT-AND-TEAM.md` after a new specialist is created or approved in principle
- default `specialist` and `beginner` guidance must state that they do not create more specialists by default and should route staffing recommendations back through `professor`
- default `AGENTS.md` must present `OPENCOLAB_PROGRESS_FILE` as the default OpenColab progress channel, include a valid JSON example, and explain that agents choose bounded useful progress events rather than milestone-only output
- default `AGENTS.md` must explain that Telegram file return directives must be emitted as raw `@telegram-file <json>` lines, not wrapped in backticks or code fences
- the default templates must keep only essential, role-appropriate instructions
- `TODO.md` must be used for active planning and task tracking based on interactions with the human and other agents

`MEMORY.md` remains reserved for long-term memory only.

`PROJECT-AND-TEAM.md` is project-shared context, not agent-local memory.

OpenColab memory is split into three simple layers:

- working memory: current active session tail from the current UTC day only
- recent episodic memory: previous UTC day summary
- long-term semantic memory: curated stable facts in `MEMORY.md`

Prompt construction must load context in this order:

1. `AGENTS.md`
2. `IDENTITY.md`
3. `ALMA.md`
4. `TOOLS.md`
5. `USER.md`
6. `TODO.md`
7. `PROJECT-AND-TEAM.md`
8. `MEMORY.md`
9. recent session memory and the current inbound message

Requirements for `PROJECT-AND-TEAM.md`:

- it must be concise, curated, and project-scoped
- it must capture shared project facts such as goals, constraints, current direction, key decisions, humans, agents, role ownership, and agent lifecycle state when relevant
- it must not store secrets, raw transcripts, scratch notes, or long reasoning dumps
- it must contain its own short maintenance rules near the top so the file is self-describing when an agent is asked to edit it
- professor is the default curator, while specialists may propose updates without treating it as a free-for-all notebook
- it should be the canonical place where the professor records newly proposed, created, configured, active, paused, or archived specialists when those states matter to the project

Each agent must also persist Telegram conversation history under:

- `projects/<project_id>/AGENTS/<agent_id>/memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`
- `projects/<project_id>/AGENTS/<agent_id>/memory/Daily/<YYYY-MM-DD>.md`

Requirements for session storage:

- session folders are created automatically on first message
- `YYYY-MM-DD.jsonl` uses current UTC date
- `/session reset` starts a new session folder for the active agent
- conversation logs must not be stored in `.opencolab`
- raw session logs are archival and must not be fed wholesale into provider prompts
- routed agent executions must append the inbound user turn before provider execution begins so timeout or failure does not erase the request from session history
- timed-out or failed routed executions must append a compact assistant recovery entry to the active session so the next turn can resume from the last known state without replaying the whole transcript
- working memory should include only the recent turns from the active session and current UTC day
- recent episodic memory should include only the previous UTC day summary
- `MEMORY.md` should contain only durable facts, preferences, and recurring constraints
- `BOOTSTRAP.md` is onboarding scaffolding, must be read first while it still exists, and should not be treated as permanent prompt context after initialization
- inbound Telegram files remain shared project resources and should be stored at project scope (for example under `projects/<project_id>/memory/TelegramInbox/`), not duplicated per agent

## 6. Telegram Pairing Flow

Pairing remains mandatory before regular routing.

Sequence:

1. Operator runs pairing start from CLI.
2. System sends short-lived code to the shared configured Telegram chat.
3. Operator completes pairing from CLI with the code.
4. Gateway enables trusted routing.

Requirements:

- code expiry (recommended 10 minutes)
- single-use code
- failed attempts do not enable routing
- non-paired chats are rejected

## 7. CLI Requirements

Required command groups:

- `opencolab version`
- `opencolab ignite`
- `opencolab upgrade`
- `opencolab setup api-key`
- `opencolab setup model`
- `opencolab setup telegram`
- `opencolab setup telegram pair`
- `opencolab gateway`
- `opencolab project`
- `opencolab agent`
- `opencolab gpu server`
- `opencolab gpu job`

Responsibilities:

- when invoked with no command, `opencolab` must show the installed CLI version in its first help screen
- `opencolab --version`, `opencolab -v`, and `opencolab version` must print the installed CLI version and exit
- initialize state and default project/agent files when `ignite` runs
- when `OPENCOLAB_ROOT` is set, CLI and runtime config resolution must use it as the runtime root
- when `OPENCOLAB_ROOT` is unset and the current execution is a packaged install, CLI and runtime config resolution must default to the platform runtime root (`~/.opencolab` on macOS/Linux, `%LOCALAPPDATA%\OpenColab\root` on Windows) instead of the caller's current working directory
- when `OPENCOLAB_ROOT` is unset and the current execution is a git/source checkout, CLI and runtime config resolution may default to the caller's current working directory
- `opencolab upgrade` must operate on the current OpenColab install root, not on arbitrary unrelated git repositories or on the active workspace directory by mistake
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must update that install to the latest `origin/main`
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must fail when the install git worktree has tracked local changes instead of attempting a merge
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must fetch `origin main`, switch to local branch `main`, fast-forward to `origin/main`, install dependencies, and rebuild
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must run a lightweight post-build smoke check before reporting success
- when the current OpenColab install is a packaged install without the repo git metadata, `opencolab upgrade` must not attempt git operations and should print package-manager upgrade guidance, including an npm global-install example
- when a managed background gateway service is running, git/source `opencolab upgrade` must restart it after a successful rebuild
- gateway restart after git/source upgrade must preserve the configured service port and Telegram polling mode instead of silently reverting to defaults
- when no managed background gateway service is running, git/source `opencolab upgrade` should print that no automatic restart was performed
- configure one provider API key without changing the active agent runtime
- configure provider for the active agent
- provider configuration must ask for provider and model, and must support provider auth mode selection when available
- `ignite` should offer curated concrete model options per provider; Gemini options must include `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, and `gemini-3-flash-preview`; MiniMax options must include `MiniMax-M2.5` and `MiniMax-M2.7`
- OpenAI and Gemini provider auth modes must support `api_key` and `oauth`
- in `api_key` mode, provider API keys must be persisted in `.env.local` using canonical env names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, or `XAI_API_KEY`)
- when `ignite` asks for a provider or Runpod API key value, it should print a direct setup URL for that key first
- when `ignite` asks for `TELEGRAM_BOT_TOKEN`, it should print a BotFather instruction first
- in OpenAI `oauth` mode, setup must not require `OPENAI_API_KEY`
- in Gemini `oauth` mode, setup must not require `GEMINI_API_KEY`
- Gemini-based built-in shared tools must use `GEMINI_API_KEY` even when the active agent runtime uses a different provider or Gemini `oauth`
- the shared `pageindex-grounded` skill must be able to use `GEMINI_API_KEY` for the local PageIndex runner even when the active agent runtime uses another provider or Gemini `oauth`
- in OpenAI `oauth` mode, runtime preflight must verify Codex login state and return remediation guidance if login is missing
- in Gemini `oauth` mode, runtime must return remediation guidance when the CLI reports missing Google login or missing Gemini credentials
- provider CLI command/args must be auto-derived from internal defaults
- provider CLI defaults must support non-interactive execution with write access to the active project workspace
- when the active agent lives under `projects/<project_id>/AGENTS/<agent_id>/`, provider CLI defaults must still allow access to the parent project workspace
- provider defaults must use concrete model names, not floating aliases
- provider CLI execution timeout must default to 30 minutes and remain configurable via `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS`
- configure one shared Telegram setup for all projects
- Telegram token values must be persisted in `.env.local` under `TELEGRAM_BOT_TOKEN`
- create/list/select projects
- create/list/select agents inside active project
- show active project/agent/provider status
- `opencolab gateway start` should start a persistent background service by default and return immediately
- `opencolab gateway start --foreground` should run the gateway in the current terminal process
- `opencolab gateway` should support lifecycle commands: `start`, `stop`, `restart`, `status`, and `logs`
- on macOS, gateway background mode should be managed via user `launchd` agent
- on Linux, gateway background mode should be managed via user `systemd` service
- provide an interactive onboarding flow for first-time setup of project selection, provider/model, built-in shared-tool key setup, Telegram setup, and optional pairing
- `ignite` onboarding should allow skipping the current step with `Esc` and continue to the next step
- `ignite` onboarding should detect existing provider setup and allow keeping or updating it
- `ignite` onboarding should include optional steps to persist `GEMINI_API_KEY` for Gemini-based built-in shared tools and `pageindex-grounded` when the local PageIndex runner needs it
- `opencolab setup api-key` must persist the canonical env var for one specific provider without mutating provider/model/auth settings
- `opencolab gpu server` must support lifecycle commands: `add`, `list`, `show`, `availability`, `test`, and `remove`
- `opencolab gpu job` must support lifecycle commands: `start`, `status`, `logs`, `exec`, `fetch`, `cancel`, and `list`
- `gpu server add` must support `--provider runpod`
- `gpu server add` should allow a simplified server definition where the operator mainly chooses location preference and acceptable GPU types while the implementation keeps curated defaults for the rest
- `gpu server availability` must inspect live Runpod datacenter and GPU stock for one named target without mutating project state
- `gpu server availability` should use the same ordered datacenter and GPU candidate lists that launch uses, report the best currently matching option when one exists, and state clearly that the result is only a live snapshot rather than a reservation
- `gpu server availability` should warn when a datacenter appears in live stock but is not currently accepted by the Runpod Pod create API, and should also surface known prior network-volume provisioning failures for candidate datacenters when that evidence exists locally
- `gpu job exec` must run one bounded remote shell command against the Pod associated with one `run_id`, rather than against a generic server target
- `gpu job exec` should reconcile the run first, fail clearly when the run is not yet SSH-usable or is already terminal, and treat `running_unreachable` as a live-but-not-currently-reachable degraded state
- `gpu job exec` should return a stable machine-readable result including `runId`, `targetId`, `exitCode`, `stdout`, and `stderr`
- the operator-facing CLI should prefer `gpu server` and `gpu job` naming even if internal state uses a provider-neutral `ExecutionTarget` model
- Runpod onboarding must remain optional and must not block local-only setup
- `ignite` onboarding should include an optional Runpod section after the core local setup flow is stable
- `ignite` should detect whether `RUNPOD_API_KEY` is already available and allow the operator to keep the existing setup, update it, or skip Runpod setup
- `ignite` must be able to persist `RUNPOD_API_KEY` in `.env.local`
- `ignite` should be able to create the first named GPU server for the active project using curated defaults rather than raw low-level Runpod choices
- the first curated Runpod preset should use backend `runpod`, cloud type `secure`, storage mode `network_volume`, workspace root `/workspace`, SSH access, and bootstrap profile `pytorch-cu12`
- `ignite` should be able to run a lightweight GPU server validation test when the operator opts in
- installer scripts should default to installing the published `opencolab` npm package into a user-owned prefix, make `opencolab` available as a terminal command by installing a user-level shim, and ensure the user bin directory is on `PATH`
- the repository should provide `install.sh` for macOS/Linux shells and `install.ps1` for Windows PowerShell
- `install.sh` should fail fast on Windows and direct the user to `install.ps1`
- installer scripts should also support an explicit opt-in `--hacky` git-clone mode for one-link installs, intended as a hacky fallback when the desired npm package version is unavailable; clone mode should clone or update a repository checkout, build it locally, and expose the same `opencolab` command shim
- npm package installs should also be supported for the `opencolab` CLI without requiring `dist/` to be tracked in git
- the published npm package must include the built CLI entrypoint, built-in agent templates, and built-in shared skills required for runtime fallback behavior
- the npm package build artifacts may be generated at pack/publish time rather than committed to the repository

## 8. Telegram Management Commands

Gateway must support project/agent management commands from authorized, paired chat.

Minimum supported commands:

- `/project create <project_id>`
- `/project use <project_id>`
- `/project list`
- `/agent create <agent_id>`
- `/agent use <agent_id>`
- `/agent list`
- `/session reset`

Messages that are not management commands are routed to the active agent.

Menu alias compatibility (for Telegram slash command popup):

- `/project_list` -> `/project list`
- `/project_create <project_id>` -> `/project create <project_id>`
- `/project_use <project_id>` -> `/project use <project_id>`
- `/agent_list` -> `/agent list`
- `/agent_create <agent_id>` -> `/agent create <agent_id>`
- `/agent_use <agent_id>` -> `/agent use <agent_id>`
- `/session_reset` -> `/session reset`

## 9. Provider Constraints

Supported provider identifiers:

- `openai`
- `anthropic`
- `gemini`
- `minimax`

Provider/runtime notes:

- provider configuration is stored on each agent, not on the project
- execution-target configuration is stored on each project, not on the agent provider config
- provider config includes auth mode (`api_key` or `oauth` where supported)
- OpenAI and Gemini support `api_key` and `oauth` auth modes
- Anthropic and MiniMax are `api_key` only in v1
- some providers may reuse an existing CLI runtime instead of shipping a dedicated CLI
- `gemini` uses the `gemini` CLI runtime
- Gemini v1 scope is limited to Google login (`oauth`) or `GEMINI_API_KEY`; Vertex AI auth is out of scope
- `minimax` uses the `claude` runtime with MiniMax's Anthropic-compatible gateway

Planned provider-runtime expansion:

- the next provider expansion should separate provider identity from runtime identity so OpenColab can support providers that do not ship their own dedicated CLI
- the first shared fallback runtime should be `pi` from `pi-mono`
- `pi` integration should be modeled as a runtime layer, not as a replacement for explicit provider names
- the first new provider added through `pi` should be `xai`
- future pi-backed providers may include any provider/model combination supported directly by `pi` or by a user-managed pi custom model configuration

Planned runtime architecture:

- provider config should continue to store `name`, `model`, and `authMode`
- provider config should additionally store a runtime selector so OpenColab can distinguish native runtimes from shared runtimes such as `pi`
- native defaults should remain the default for providers with a well-supported dedicated CLI:
  - `openai` -> `codex`
  - `anthropic` -> `claude`
  - `gemini` -> `gemini`
  - `minimax` -> `claude` with Anthropic-compatible gateway env wiring
- providers without a native CLI should default to the `pi` runtime
- OpenColab must keep explicit provider names even when multiple providers share the same runtime so project state, setup UX, and auth handling remain clear

Planned `pi` integration requirements:

- `pi` must run in non-interactive mode for routed Telegram and CLI-triggered agent execution
- `pi` must be invoked from the active agent directory while still allowing access to the active project workspace
- OpenColab should remain the source of truth for project state, Telegram routing, memory files, and conversation logs
- OpenColab should avoid duplicating prompt context that `pi` already loads automatically from local context files
- runtime preflight must verify that the `pi` command is available on `PATH` before attempting execution
- runtime preflight must verify provider credentials required by the selected pi-backed provider before attempting execution
- model configuration for pi-backed providers should prefer runtime discovery when available and fall back to explicit manual model entry when discovery is unavailable or fails
- `xai` setup should use `XAI_API_KEY` as the canonical API key environment variable unless a later pi upstream change requires a different canonical variable
- OpenColab should treat pi sessions, extensions, themes, and other pi-local UX state as out of scope for initial integration unless they are required for non-interactive execution

Planned rollout order:

1. add config and runtime abstraction support for shared runtimes
2. add `xai` as the first pi-backed provider
3. add setup and onboarding support for pi-backed provider selection and model entry/discovery
4. add runtime preflight and operator-facing remediation messages for missing `pi` installation or missing provider credentials
5. evaluate broader support for additional pi-backed providers after `xai` is stable

## 10. Configuration Persistence (`opencolab.json`)

`opencolab.json` is the source of truth and must contain project and agent configuration.
`opencolab.json` and `.env.local` live at the runtime root, while internal runtime/service state lives under `<runtime_root>/.opencolab/`.

Minimum shape:

```json
{
  "version": 1,
  "activeProjectId": "default",
  "projects": {
    "default": {
      "id": "default",
      "path": "projects/default",
      "activeAgentId": "professor",
      "agents": {
        "professor": {
          "id": "professor",
          "path": "projects/default/AGENTS/professor",
          "provider": {
            "name": "anthropic",
            "model": "<concrete-model-id>",
            "authMode": "api_key"
          },
          "files": {
            "agents": "AGENTS.md",
            "bootstrap": "BOOTSTRAP.md",
            "identity": "IDENTITY.md",
            "alma": "ALMA.md",
            "tools": "TOOLS.md",
            "user": "USER.md",
            "todo": "TODO.md",
            "memory": "MEMORY.md"
          }
        }
      },
      "executionTargets": {
        "runpod-a100": {
          "id": "runpod-a100",
          "backend": "runpod",
          "enabled": true,
          "datacenterId": "US-KS-2",
          "preferredDatacenterIds": ["US-KS-2", "CA-MTL-1"],
          "cloudType": "secure",
          "gpuType": "NVIDIA A100 80GB PCIe",
          "preferredGpuTypes": ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"],
          "gpuCount": 1,
          "volume": {
            "mode": "network_volume",
            "name": "default-runpod-a100",
            "sizeGb": 200
          },
          "ssh": {
            "mode": "public_ip"
          },
          "workspaceRoot": "/workspace",
          "bootstrapProfile": "pytorch-cu12",
          "maxRuntimeMinutes": 360,
          "autoStopPolicy": "stop_on_completion"
        }
      }
    }
  },
  "telegram": {
    "chatId": "<telegram-chat-id>",
    "paired": true,
    "pairedAt": "2026-02-27T00:00:00.000Z"
  }
}
```

Notes:

- secret values are stored in `.env.local` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `RUNPOD_API_KEY`, `TELEGRAM_BOT_TOKEN`)
- when OpenAI auth mode is `oauth`, `OPENAI_API_KEY` is optional
- when Gemini auth mode is `oauth`, `GEMINI_API_KEY` is optional
- execution targets belong at project scope, not inside per-agent provider configuration
- SSH private keys must not be embedded in `opencolab.json`
- `opencolab.json` must not store raw secret values or env-var secret references
- extra fields are allowed if they do not break the minimum contract

## 11. Execution Targets and Remote GPU Jobs

OpenColab must treat experiment execution targets as a separate control-plane concept from agent provider runtimes.

### 11.1 Execution Target Model

Requirements:

- an `ExecutionTarget` is a named remote GPU environment available to a project
- execution targets must live at project scope, not inside agent provider config
- the first supported backend must be `runpod`
- the first supported Runpod compute product must be `Pods`
- the first supported cloud class must be `Secure Cloud`
- the first supported storage mode must be an attached Runpod network volume
- the first supported remote access mode must be SSH
- the first supported workspace root on the Pod must be `/workspace`
- the first supported run style must be non-interactive detached batch execution
- agents must not receive unrestricted interactive remote shell authority by default

Suggested target fields:

- `id`
- `backend`
- `enabled`
- `datacenterId`
- `preferredDatacenterIds`
- `cloudType`
- `gpuType`
- `preferredGpuTypes`
- `gpuCount`
- `templateRef` or image/template hint
- `volume.mode`
- `volume.name`
- `volume.sizeGb`
- `workspaceRoot`
- `ssh.mode`
- `bootstrapProfile`
- `maxRuntimeMinutes`
- `idleStopMinutes`
- `autoStopPolicy`
- `maxEstimatedCostUsd`

Runpod MVP constraints:

- `backend` must be `runpod`
- `cloudType` must be `secure`
- `volume.mode` must be `network_volume`
- `ssh.mode` must be the stable SSH path chosen by the implementation
- `datacenterId` and `gpuType` remain the primary or first-choice values for compatibility, but the target may also carry ordered fallback lists for location and GPU selection
- if multiple datacenter candidates are allowed, the implementation must manage network volumes per datacenter rather than assuming one shared volume instance can follow the Pod across locations

### 11.2 Run Manifest and Local State

Requirements:

- an `ExperimentRun` is one bounded remote execution attempt launched against an execution target
- each run must have an immutable local manifest plus mutable status tracking under the project `experiments/runs/` tree
- the manifest is the canonical local record for reproducibility and debugging
- the manifest must include run id, project id, agent id, target id, requested command, working directory, environment variable references, sync include list, expected artifact paths, timestamps, and source revision metadata when available
- status tracking must preserve the last meaningful stage even when provisioning, launch, fetch, or cleanup fails

Suggested run states:

- `draft`
- `validating`
- `provisioning`
- `waiting_for_ssh`
- `syncing`
- `bootstrapping`
- `running`
- `running_unreachable`
- `fetching`
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `cleanup_failed`

### 11.3 Required Run Lifecycle

OpenColab must perform this flow for bounded remote jobs:

1. Create a local run manifest.
2. Validate the selected target and local operator prerequisites.
3. Resolve the first available compatible Runpod location and GPU combination within the target's allowed candidates.
4. Ensure the referenced Runpod network volume exists for the selected datacenter.
5. Create a Pod or reuse a compatible warm Pod only when policy allows it.
6. Wait for the Pod to become reachable through SSH.
7. Sync the selected workspace subset to `/workspace`.
8. Run the selected bootstrap profile and record the output in run logs.
9. Launch the experiment as a detached non-interactive batch job.
10. Poll run status and fetch or tail remote logs.
11. Emit bounded OpenColab progress events for meaningful state changes.
12. Fetch declared artifacts and final logs into the local project run folder.
13. Stop the Pod, or leave it warm only when target policy explicitly allows that behavior.
14. Mark the run with a terminal status.

### 11.4 Sync, Bootstrap, Progress, and Artifacts

Requirements:

- sync must be allowlist-based rather than a blind full-repository copy
- each run must define the local working root, include paths, exclude paths, remote working directory, and artifact return paths
- `.env.local`, `.git/`, `.opencolab/`, `node_modules/`, `dist/`, and `projects/*/AGENTS/*/memory/` must be excluded by default
- large derived artifacts must not be synced unless the run explicitly includes them
- bootstrap must use a bounded set of named profiles in the first release rather than arbitrary free-form setup logic
- the first bootstrap profiles should include `python-ml`, `pytorch-cu12`, and `minimal-shell`
- remote launch must be detached; the experiment process must not depend on a live SSH session remaining open
- remote execution must reuse the existing OpenColab progress-event model instead of inventing a second event system
- each run should declare expected artifact paths before launch
- OpenColab must fetch declared artifacts automatically, store them under the local run folder, and record missing expected artifacts as warnings or failures depending on strictness
- final user-facing summaries for remote jobs must distinguish command success, artifact success, and scientific success, and when a run fails or degrades they should state the failure reason clearly and propose the next useful operator or agent action

### 11.5 Failure, Recovery, Security, and Cost Controls

Requirements:

- `RUNPOD_API_KEY` must live only in `.env.local` or the shell environment
- OpenColab must never sync `.env.local` or auto-forward all local environment variables to the Pod
- explicit per-project execution-target allowlists, bounded sync paths, bounded artifact fetch paths, and max runtime limits are required
- OpenColab must preserve the local run record, logs, and last meaningful status even when the remote job fails
- cleanup failure must be distinguishable from experiment failure
- if SSH is interrupted after detached launch and the Pod still appears alive, the run must not be marked failed only because SSH was lost
- when SSH is lost but the Pod still appears alive, the run should transition to `running_unreachable`, emit a warning progress event, continue checking Pod state through the Runpod control plane, and retry SSH until recovery or timeout
- Pod termination or restart during the job should be treated as run failure unless the workflow explicitly supports resume
- artifact or log fetch interruption must be treated as a retryable transfer problem before it is treated as experiment failure
- if the target defines multiple allowed datacenter or GPU candidates, provisioning should try them in deterministic order and surface the attempted combinations in progress or failure reporting
- operators should be able to inspect the current compatible datacenter and GPU combinations for a named target before launch through a live availability command, and that command must use the same candidate ordering as provisioning while stating that capacity can change before launch
- each target should be able to express max runtime, idle shutdown behavior, approximate budget ceiling, allowed GPU class, and allowed GPU count
- operator-facing surfaces must make active remote cost exposure visible enough for routine use

## 12. Message Handling Rules

- if chat is unpaired, gateway replies with pairing-required guidance
- if paired, gateway processes management commands first
- `/session reset` creates a new active session folder for the active agent
- non-management text and file messages are sent to the active project/agent runtime
- inbound Telegram file messages should preserve caption text and include attachment metadata in the user message passed to the agent
- when Telegram file download succeeds, attachments should be materialized under the active project (for example under `memory/TelegramInbox/`) with collision-safe local filenames and the agent input should include the local file path
- when Telegram file download fails or times out, routing should continue with caption text plus attachment metadata instead of dropping or indefinitely blocking the message
- while generating, gateway sends Telegram `typing` feedback
- for long-running routed tasks, the gateway must support incremental progress updates before the final answer is ready
- responses are sent to the same chat
- when provider/runtime execution fails for a routed message, gateway replies in Telegram with a short failure notice instead of failing silently
- provider auth/runtime remediation guidance (for example missing Gemini OAuth login or missing API key) must be forwarded to the Telegram user when available
- polling mode must not retry the same failed Telegram update indefinitely once the runtime has consumed it
- agent responses may include `@telegram-file <json>` directives to send Telegram files:
  - example: `@telegram-file {"kind":"document","file":"<file_id_or_url>","caption":"optional"}`
  - local file paths may be relative to the active agent working directory or absolute
  - directive lines may be wrapped in a single pair of backticks and should still be accepted
- `setup telegram` should register Telegram bot commands via `setMyCommands` so slash-menu suggestions are available

## 13. Incremental Task Updates

OpenColab must support multi-message Telegram UX for long-running work such as literature search, large codebase analysis, long test runs, multi-step file processing, bulk downloads, or any task where meaningful intermediate milestones exist.

Goals:

- reduce the "silent bot" effect during long runs
- let the user see concrete stage changes before completion
- keep updates useful and bounded, especially in group chats
- preserve a high-quality final answer instead of replacing it with fragmented chatter

Progress updates are a first-class runtime capability, not a prompt-only convention.

### 13.1 Progress Event Contract

Provider runtimes and agent-facing wrappers must be able to emit structured progress events while the task is still running.

Minimum event shape:

```json
{
  "kind": "started | milestone | progress | warning | needs_input | completed",
  "message": "<short user-facing text>",
  "stage": "<machine-readable stage id>",
  "current": 8,
  "total": 20,
  "slot": "search",
  "ephemeral": true
}
```

Requirements:

- provider runtimes must create and inject `OPENCOLAB_PROGRESS_FILE` by default for routed agent executions, even when no extra progress configuration is requested by the operator
- `kind` is required
- `message` is required and must be concise, concrete, and user-facing
- `stage` is recommended for routing and de-duplication
- `current` and `total` are optional and should be used for countable work
- `slot` is optional and allows the gateway to update or replace an earlier progress message for the same workstream
- `ephemeral` defaults to `true`; operational progress updates must not be treated as normal assistant conversation turns

Notes:

- progress events are transport-level metadata and must be stripped from the final assistant prose shown as the completed answer
- progress events must not be appended to the agent's normal session conversation log as if they were substantive assistant replies
- if run telemetry is persisted later, it should live in a separate operational log, not in the conversational memory stream

### 13.2 Gateway Behavior

For routed tasks with meaningful duration, the gateway should expose progress in this order:

1. immediate acknowledgment
2. bounded progress updates during execution
3. final consolidated answer

Requirements:

- if a task is expected to take more than a few seconds, the user should receive an acknowledgment quickly instead of waiting only on `typing`
- the gateway may send a new Telegram message or edit a previous progress message when successive events share the same `slot`
- the gateway should throttle repetitive progress so users see stage changes, not a token-by-token transcript
- group chats must use a stricter throttle than one-to-one chats
- `warning` and `needs_input` events may bypass normal throttling when they materially affect the run
- the final completion message must remain a distinct final response
- if no progress events are emitted, current `typing` behavior remains the fallback

Recommended UX policy:

- send first acknowledgment within 1-2 seconds for long tasks
- let the agent choose whether an event should be `started`, `progress`, `milestone`, `warning`, `needs_input`, or `completed`
- send updates only on meaningful stage changes, count deltas, blockers, or transitions that help the user
- prefer editing one progress message for dense counters
- prefer new messages for major phase changes, warnings, and completion
- avoid more than a small handful of progress messages per run in group chats

### 13.3 Skill and Agent Authoring Rules

Built-in skills and default agent guidance must explicitly support bounded intermediate updates for long tasks.

Requirements:

- agents should not stay silent for the full duration of a long multi-step task when useful progress can be reported
- agents should avoid low-signal "thinking aloud" updates
- updates must report real work completed, real blockers, meaningful counters, or the transition into a new major phase
- final answers should remain synthesized and complete, not a loose concatenation of earlier progress notes
- default agent guidance must stop treating "one thoughtful response" as a blanket rule for long-running operational tasks
- default agent guidance must describe progress updates as a normal OpenColab feature, not an optional add-on the agent has to rediscover
- default agent guidance must make the JSON progress-event contract explicit enough for weaker agents to copy correctly

Recommended rule of thumb:

- let the agent decide which events matter, then use `started` for acknowledgment, `progress` for dense counters, `milestone` for stage transitions, `warning` for degraded runs, `needs_input` for blockers, and `completed` for explicit completion when helpful
- send progress for stage changes, corpus-size changes, downloads, summarization waves, synthesis start, long test phases, bulk edits, or blocking failures
- do not send progress for every minor shell command or every internal reasoning step

### 13.4 Search Skill UX Requirements

The shared `fast-search`, `pro-search`, and `deep-search` skills must support agent-chosen bounded progress updates tied to their actual workflow stages.

For paper-search workflows, expected update categories include:

- retrieval started
- candidate corpus size known
- deep-read or selected-paper set chosen
- PDF download progress
- paper summarization progress
- synthesis/report-writing started
- final report delivered

The shared `fast-search`, `pro-search`, and `deep-search` skills must also generate a companion literature-map block diagram through the shared `block-diagram` skill.

That companion diagram should:

- show the selected papers or compact paper-family clusters as nodes,
- show only evidence-backed relations such as method lineage, direct comparison, shared benchmark or dataset, critique, or common problem framing,
- avoid invented influence or citation edges that are not supported by the corpus,
- stay compact and readable, clustering papers when a flat per-paper graph would be noisy,
- produce companion `.d2` plus rendered diagram artifacts alongside the report,
- and prefer `.png` as the primary user-facing literature-map artifact, falling back to `.svg` when PNG rendering is unavailable.

The shared `fast-search`, `pro-search`, and `deep-search` skills must also keep their skill-specific `findings.md` format stable while returning a friendlier final chat reply for user-facing interactive runs. That final reply should:

- stay concise instead of dumping the whole report into chat,
- include a direct answer, corpus coverage stats, and the most important cited takeaways,
- include one short literature-map line explaining how the main papers or paper families connect,
- surface major limitations or uncertainty when they materially affect confidence,
- allow light emoji use when it improves scanability,
- and attach or otherwise return `findings.md` plus the PNG literature-map diagram when the active channel supports file delivery, falling back to the SVG artifact when PNG rendering is unavailable.

### 13.5 PageIndex Grounded Skill Requirements

The shared `pageindex-grounded` skill must complement the paper search and summary workflows rather than replace them.

Requirements:

- it must operate on already-downloaded local PDFs, not on paper discovery
- it must treat `fast-search`, `pro-search`, and `deep-search` as the retrieval path for finding papers and `paper-summary` as the canonical per-paper summary path
- it must keep paper selection bounded before retrieval, normally searching 1 paper for a single-paper question and 2-5 papers for a cross-paper question unless the user explicitly asks for broader coverage
- it must persist PageIndex artifacts under `research/pageindex/`, including `trees/` for cached per-paper tree JSON and `answers/` for optional grounded answer notes
- it must maintain a machine-readable `research/pageindex/manifest.json` that records selected local papers, PDF paths, tree paths, and freshness or indexing status
- it must prefer reusing an existing cached tree when the source PDF has not changed
- it must return answers with exact paper and page references for non-trivial claims whenever the evidence supports that level of grounding
- if the answer relies only on paper summaries, metadata, or partial local evidence instead of a verified PageIndex tree plus PDF check, it must label that limitation explicitly instead of implying full grounding
- it must default to the local open-source PageIndex tree-generation workflow and should not require hosted MCP or hosted Chat API integration unless the user explicitly asks for that external-service path
- it must use `GEMINI_API_KEY` for the local PageIndex runner rather than depending on `OPENAI_API_KEY` or `CHATGPT_API_KEY`

The final user-facing reply from `pageindex-grounded` should:

- start with a direct answer instead of a long process dump
- state how many local papers were searched and which subset was selected when that matters to confidence
- include exact paper and page citations inline or immediately after the supported claim
- surface material uncertainty, stale indexes, or missing local PDFs when those limitations affect confidence
- point the user to any persisted grounded answer note under `research/pageindex/answers/` when a longer artifact was written

### 13.6 PDF Figure Extract Skill Requirements

The shared `pdf-figure-extract` skill must complement grounded QA and diagram workflows by locating and returning figures from already-downloaded local PDFs.

Requirements:

- it must operate only on already-downloaded local PDFs, not on paper discovery
- it must use PyMuPDF as the local extraction and rendering engine
- it must support both direct hints such as paper id, page number, or figure number and ambiguous requests such as "send me the architecture figure"
- it must reuse cached PageIndex artifacts under `research/pageindex/` when they are available and relevant, but PageIndex must remain optional and missing PageIndex must not block extraction
- it must persist figure artifacts under `research/figures/`, including exported image files plus machine-readable manifest data that records paper id, PDF path, page, bounding box or region metadata, source mode, and confidence-relevant notes
- it must keep page inspection bounded, preferring grounded or heuristically shortlisted candidate pages instead of exhaustively rasterizing every page when a narrower search is available
- it must export a user-deliverable image even when the source figure is vector-heavy or mixed-content, using clipped page rendering when a direct embedded-image extraction is not available
- it must inspect the shortlisted candidate images with the agent's multimodal capability before choosing what to return when the active provider runtime supports local image inspection
- if the active provider runtime cannot inspect local images or if confidence remains low after inspection, it must say so explicitly and should prefer returning the best candidates with limitations instead of overstating certainty
- when the active channel supports file delivery, it must return the chosen figure through the `@telegram-file` mechanism

The final user-facing reply from `pdf-figure-extract` should:

- start with a direct answer and the selected figure instead of a long process dump
- identify the paper and page, and include figure number or nearby caption text when available
- state whether the result came from `pageindex-assisted` or `standalone` search
- mention when the returned artifact is a clipped page render rather than a direct embedded-image extraction if that distinction materially affects what the user received
- surface low-confidence matching, missing multimodal verification, stale PageIndex artifacts, or other material limitations when they affect confidence

### 13.7 Diagram Skill Requirements

The shared `block-diagram` skill must:

- normalize a text architecture brief into components, containers, and directed edges,
- produce a canonical `.d2` source file,
- support optional formula blocks with embedded LaTeX when a mathematically important stage, loss, or objective is clearer as an explicit equation,
- render sketch-style `.svg` output by default and optional `.png` output,
- support a clean non-sketch override when the user explicitly asks for it,
- default to unlabeled arrows and only add edge labels when they carry concrete meaning such as a protocol, artifact, or payload,
- avoid generic edge labels such as `input`, `output`, `data`, or similar filler text,
- prefer compact readable layouts with short connections and reduced whitespace when that does not hurt clarity,
- prefer deterministic D2 rendering over free-form image generation for architecture block diagrams,
- split large architectures into overview and detail diagrams when one dense diagram would reduce readability.

Examples of acceptable progress text:

- "Searching for candidate papers across 4 query waves."
- "Found 47 candidate papers. Selecting 14 for deep read."
- "Downloaded 12 of 14 PDFs. Two failed and will be noted."
- "Summarized 8 of 12 papers. Starting cross-paper synthesis."

The same pattern should extend to other important long-running tasks, including:

- repository exploration
- dependency installation
- long test or benchmark runs
- dataset preparation
- batch file conversion
- report generation

### 13.8 Failure and Recovery UX

Progress support must improve failure handling as well as success handling.

Requirements:

- if a long task fails after partial work, the user should receive a short failure message that includes the last meaningful completed stage when available
- warnings that reduce coverage or confidence should be surfaced before the final answer when they materially change the result
- if the runtime needs human intervention, the user should receive a `needs_input` style message instead of waiting for timeout or generic failure

### 13.9 Provider Timeout Recovery

Provider CLI timeout is a normal failure mode, not an edge case. OpenColab must preserve enough context for the next turn to resume cleanly when `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS` is reached.

Requirements:

- when a routed provider execution reaches `OPENCOLAB_PROVIDER_CLI_TIMEOUT_MS`, the runtime must preserve resumable context instead of failing as a stateless dead end
- the active session transcript must already contain the inbound user request before the timeout occurs
- timeout handling must append a compact assistant recovery entry to the active session transcript
- the recovery entry must be concise and should include: timeout occurred, provider, model, timeout limit, last meaningful progress message when available, and a short next-action hint
- the next routed prompt may include the compact timeout recovery entry as working memory, but must not inject raw progress streams or large CLI logs into normal prompt memory
- progress events remain operational metadata and must not be copied verbatim into the normal conversation transcript just because a timeout occurred
- bounded runtime telemetry for timed-out executions may be persisted separately from conversation memory, but if persisted it must live in a separate operational log rather than in `memory/Session/` as synthetic assistant chatter
- timeout handling should attempt a short final progress flush before forceful termination when the provider runtime supports it, but the recovery record must not depend on that flush succeeding

## 14. Acceptance Criteria

v1 is complete when all are true:

- CLI can create/select projects and agents.
- Telegram can create/select projects and agents.
- Active project routes to its active agent and provider runtime.
- Provider runtimes can edit the active project workspace without interactive permission prompts.
- `opencolab.json` persists active project, all project/agent configs, and one shared Telegram config.
- The default `professor` agent is created under `projects/<project_id>/AGENTS/professor/`.
- The optional built-in `beginner` agent is created under `projects/<project_id>/AGENTS/beginner/` when used.
- Additional agents are created under `projects/<project_id>/AGENTS/<agent_id>/`.
- The default `professor` agent seeds from the built-in professor template assets, sourced from `src/agent-templates/professor/` in the repository and shipped in packaged installs; the built-in `beginner` agent id and additional agents follow the same built-in template rules with fallback to shared template assets.
- Agent conversation logs are saved in per-agent `memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`.
- Long-running routed tasks can emit bounded intermediate Telegram updates before the final answer.
- Progress updates are treated as operational events rather than normal assistant conversation turns.
- Shared search skills support agent-chosen progress events for retrieval, selection, download, summarization, and synthesis phases.

The Runpod-first remote execution milestone is complete when all are true:

- A project can define at least one named execution target in `opencolab.json`.
- `opencolab gpu server` can add, list, show, inspect availability for, test, and remove Runpod-backed targets.
- Runpod-backed targets can express ordered location and GPU candidates while keeping a primary compatibility value for each.
- `opencolab gpu job` can start, inspect, exec into, fetch, cancel, and list bounded remote jobs.
- OpenColab can provision or reuse a compatible Runpod Pod with a Pod-attached network volume mounted at `/workspace`.
- OpenColab can sync an allowlisted subset of the local project to the Pod without syncing `.env.local`, `.git/`, or agent memory by default.
- OpenColab can bootstrap the remote environment through a named profile and record bootstrap output in run logs.
- OpenColab can launch a detached non-interactive remote command and preserve a local manifest and status record for the run.
- OpenColab can survive temporary SSH interruption after launch without immediately marking the job failed.
- OpenColab can emit bounded progress updates during validation, provisioning, sync, bootstrap, execution, and artifact fetch.
- OpenColab can fetch declared artifacts and logs back into the local project tree.
- OpenColab can stop the Pod on completion or surface cleanup failure explicitly when teardown does not finish cleanly.
