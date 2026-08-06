# OpenColab v1 Multi-Project Specification

## 1. Purpose

OpenColab v1 is a minimal personal research assistant that supports multiple projects, each with its own agents, and exposes control through CLI and Telegram.

## 2. Product Scope

v1 supports:

- multiple local projects
- multiple agents per project
- one active project at a time
- one active agent inside the active project
- one provider runtime per agent: `openai`, `anthropic`, `gemini`, `minimax`, `xai`, `openrouter`, or `kimi`
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
- List/select projects from Telegram picker commands.
- List/select agents from Telegram picker commands.
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
- unrestricted or implicit interactive remote shells exposed directly to agents

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
- `autoresearch` is an optional built-in experiment specialist id for sustained iterative experiment-loop work through the shared `autoresearch` skill
- additional agents are PhD-style specialist agents
- additional agent ids should use memorable, descriptive names that reflect their specialty or work style
- additional agent ids do not need to follow a rigid `phd_*` naming scheme
- built-in agent templates live under `src/agent-templates/`, with shared scaffolds in `src/agent-templates/shared/` and role folders such as `src/agent-templates/professor/`, `src/agent-templates/beginner/`, `src/agent-templates/autoresearch/`, and `src/agent-templates/specialist/`

Each agent directory must include:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md` for agent-local tooling notes, additions, and overrides
- `USER.md`
- `TODO.md`
- `MEMORY.md`
- `HEARTBEAT.md`
- `SKILLS/` for agent-local skills

Shared project skills requirements:

- the repository must expose a shared `projects/SKILLS/` directory
- published package installs must also ship the built-in shared `projects/SKILLS/` directory so runtime fallback skill discovery does not require a git checkout
- skills are shared across all agents and all projects and must not be duplicated per agent or per project
- each skill lives under `projects/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from the shared `projects/SKILLS/` directory before using a specialized workflow
- the shared `block-diagram` skill is the deterministic path for autonomous D2 block-diagram generation and defaults to sketch-style rendering unless the user asks for clean output
- the shared `fast-research`, `pro-research`, and `deep-research` skills must use the shared `block-diagram` skill to render a companion literature-map overview that shows how the selected papers connect
- the shared `fast-research`, `pro-research`, and `deep-research` skills must store each distinct research topic in its own dated, topic-slugged run folder under `research/`, must keep detailed deliverables inside that run folder, and must maintain a root `research/INDEX.md` catalog plus a per-run `RUN.md` metadata file so later agents can identify prior research without opening every artifact
- the shared `pageindex-grounded` skill is the canonical path for grounded follow-up QA over already-downloaded local PDFs and must keep retrieval bounded to a selected subset of local papers before answering
- the shared `pdf-figure-extract` skill is the canonical path for extracting and returning figures from already-downloaded local PDFs, optionally reusing PageIndex artifacts to narrow page selection before multimodal verification and delivery
- the shared `latex-paper-writer` skill is the canonical path for creating, editing, versioning, compiling, and returning scientific LaTeX papers, reports, and research-derived PDF summaries; it must choose venue-aware templates when requested, keep each paper workspace under Git version control, use existing research and grounding artifacts for evidence, use `pdf-figure-extract` and `block-diagram` for figures or architecture visuals when appropriate, generate experiment-result tables, compile through `latexmk` when available with clear install remediation when missing, and return final PDFs through the active channel's file-delivery mechanism when requested
- the shared `autoresearch` skill is the canonical path for iterative keep/discard experiment loops over one explicitly configured repo; any agent may use it when needed, but sustained ownership belongs by default to the built-in `autoresearch` specialist when present; it must require an explicit `repo_path`, `editable_file_path`, `run_command`, and `metric_rule`, must treat a non-zero exit code or missing metric as failure by default, must use a dedicated disposable branch or worktree for keep/discard iteration, must not assume the editable file is `train.py` or the run command is `uv run train.py`, and must ship a progress-graph helper that can render a results table as a key-metric-over-experiment plot with green kept experiments, gray discarded or non-kept experiments, short kept-experiment labels, and a running-best line for either lower-is-better or higher-is-better metrics
- the shared `runpod-job` skill is the canonical AI-facing path for Runpod work and by default it must ask the human to manually create a Runpod Pod with the desired GPU type, wait for the user to provide the `pod_id`, save or reuse a project-scoped manual SSH profile through `opencolab gpu ssh profile ...`, and then use `opencolab gpu ssh session start|read|write|stop` as the default control path for that user-managed Pod rather than parking in raw direct SSH; this default is capacity-driven even though the OpenColab Runpod CLI remains supported; the skill must describe that manual path as outside the normal OpenColab `run_id` lifecycle, must not invent a `run_id`, and must not claim that `opencolab gpu job exec` works directly against a raw `pod_id`; it should prefer `opencolab gpu ssh profile test` before starting a session so host and port can be refreshed from Runpod Pod metadata when available, should set an active-agent default when appropriate, may use bounded `scp`, `rsync`, or one-shot `ssh` helpers only when file transfer or an explicit user request requires them, and should stop live sessions explicitly instead of leaving them open; when the user explicitly wants the OpenColab-managed lifecycle, the skill may instead use the `opencolab gpu server` and `opencolab gpu job` CLI commands, and in that managed path it must launch jobs in detached mode with `--wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <run_id>` before reporting on it so the latest remote logs are downloaded locally, review the `bootstrap`, `stdout`, `stderr`, and `poller` log streams when summarizing a run, use `opencolab gpu job exec --run-id <id> --command "<remote command>"` for bounded direct Pod inspection when remote SSH-backed access is needed, prefer a single `NVIDIA A100 80GB PCIe` GPU candidate with `keep_warm` for curated target creation, ask the user whether to keep a finished warm Pod running or cancel it, and surface failed or degraded runs clearly with a proposed next useful action

Agent-local skills requirements:

- each agent may keep unique agent-local skills under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/`
- agent-local skills are visible only to that agent by default because they live inside the agent folder
- each agent-local skill lives under `projects/<project_id>/AGENTS/<agent_id>/SKILLS/<skill_id>/SKILL.md`
- agent instructions must tell agents to read relevant `SKILL.md` files from both the shared `projects/SKILLS/` library and the agent-local `SKILLS/` directory when applicable

Initialization requirements:

- when a project is created, `PROJECT-AND-TEAM.md` must be seeded at the project root from an internal runtime template with YAML front matter for short `project_name`, short `project_description`, and single `project_emoji`
- when an agent directory is created, `AGENTS.md` must be seeded from an internal runtime template
- when an agent directory is created, `BOOTSTRAP.md` must be seeded from an internal runtime template for first-run identity discovery
- when an agent directory is created, `IDENTITY.md` must be seeded from an internal runtime template
- when an agent directory is created, `ALMA.md` must be seeded from an internal runtime template
- when an agent directory is created, `TOOLS.md` must be seeded from an internal runtime template for agent-local tooling notes, additions, and overrides
- when an agent directory is created, `USER.md` must be seeded from an internal runtime template
- when an agent directory is created, `TODO.md` must be seeded from an internal runtime template
- when an agent directory is created, `MEMORY.md` must be seeded from an internal runtime template
- when an agent directory is created, `HEARTBEAT.md` must be seeded as an empty file
- seeded `HEARTBEAT.md` must keep heartbeat disabled by default until the user explicitly adds a valid `after: <duration>` line
- `HEARTBEAT.md` may also include an optional `notify: digest` line to enable one compact paired-chat Telegram follow-up after a background heartbeat turn finishes, or `notify: live` to reuse the Telegram live-status surface while the heartbeat turn is running
- `HEARTBEAT.md` may include an optional single-line `message: <plain text>` value to replace the default heartbeat prompt `continue`; `message:` alone must not enable heartbeat without a valid `after:` line
- agent-facing instructions must require explicit user approval before an agent modifies `HEARTBEAT.md`
- the default `professor` agent must seed from the built-in `src/agent-templates/professor/` template folder in the source tree, and packaged installs must ship the equivalent built-in template assets required at runtime
- the built-in `beginner` agent id must seed from the built-in `src/agent-templates/beginner/` template folder in the source tree, and packaged installs must ship the equivalent built-in template assets required at runtime
- the built-in `autoresearch` agent id must seed from the built-in `src/agent-templates/autoresearch/` template folder in the source tree, and packaged installs must ship the equivalent built-in template assets required at runtime
- additional agents must seed from the built-in `src/agent-templates/specialist/` template folder in the source tree unless future runtime configuration chooses another built-in template
- template-specific files may fall back to `src/agent-templates/shared/` in the source tree when a role folder does not provide an override, and packaged installs must preserve that fallback behavior with shipped runtime assets
- in the current built-in layout, role folders provide concise `AGENTS.md` overrides that keep role-specific contracts in the role file while deferring reusable maintenance, tool, memory, and evidence rules to the shared template files and injected built-in guidance; some roles may also override `IDENTITY.md` or `ALMA.md`, and `src/agent-templates/shared/` provides the shared fallback `BOOTSTRAP.md`, `IDENTITY.md`, `ALMA.md`, `TOOLS.md`, `USER.md`, `TODO.md`, and `MEMORY.md` templates
- when an agent directory is created, an empty `SKILLS/` directory must exist for agent-local skills
- the built-in `fast-research`, `pro-research`, `deep-research`, `paper-summary`, `pageindex-grounded`, `pdf-figure-extract`, `latex-paper-writer`, `nano-banana`, `block-diagram`, `autoresearch`, and `runpod-job` skills must be available from the shared `projects/SKILLS/` directory
- built-in tool guidance and built-in skill summaries must be repo-managed and injected into prompts at runtime rather than copied into agent-local `TOOLS.md`
- default templates must encode: human defines the initial problem first, then assists agents while they refine and execute
- default templates must encode: before deep investigation, agents must clarify the human's true intention for the topic
- default templates must encode: agents are the expert role and should involve the human for key decisions and support tasks
- default `ALMA.md` must encode a completeness-first execution standard: prefer the permanent fix over nearby workarounds, search before building, test before shipping, and finish the whole task when the real solution is within reach
- default `AGENTS.md` must require agents to read and follow `BOOTSTRAP.md` before `ALMA.md` whenever `BOOTSTRAP.md` still exists, so first-contact identity setup cannot be skipped
- default `AGENTS.md` must explain that `PROJECT-AND-TEAM.md` is the canonical shared project context file, lives at project scope, and should be read after `TODO.md` and before `MEMORY.md`
- default `AGENTS.md` must require agents to read and follow the maintenance rules inside `PROJECT-AND-TEAM.md` before editing it
- default `professor` guidance must require filling the `PROJECT-AND-TEAM.md` front matter with a short project name, short project description, and single project emoji when the project identity is known
- default `professor` guidance must treat specialist creation as a normal lead-agent responsibility, require human approval before creation, and teach the exact OpenColab CLI path for creation through `opencolab agent create --agent-id <id>`
- default `professor` guidance must mention follow-up per-agent model setup through `opencolab setup model --agent-id <id> ...` when needed
- default `professor` guidance must require updating `PROJECT-AND-TEAM.md` after a new specialist is created or approved in principle
- the built-in `autoresearch` agent guidance must orient the seeded agent around iterative experiment execution through the shared `autoresearch` skill, default ownership of sustained experiment-loop work, and explicit carry-forward of repo contract details, user corrections, rejected paths, and lessons from failed runs so the human does not need to repeat them
- default `specialist` and `beginner` guidance must state that they do not create more specialists by default and should route staffing recommendations back through `professor`
- default `AGENTS.md` must explain that OpenColab owns Telegram live status for routed runs, derives it from native runtime events instead of an agent-written progress file, keeps it as a persistent Telegram message after the final answer, and expects agents to avoid low-signal step-by-step chatter
- default `AGENTS.md` must explain that Telegram file return directives must be emitted as raw `@telegram-file <json>` lines, not wrapped in backticks or code fences, and may reference relative paths, absolute paths including Windows drive-letter or UNC paths, or `file://` URLs
- the default templates must keep only essential, role-appropriate instructions and must avoid restating detailed rules already owned by shared files such as `ALMA.md`, `TODO.md`, `PROJECT-AND-TEAM.md`, `TOOLS.md`, or injected built-in tool guidance
- `TODO.md` must be used as a lean current working list for active planning and task tracking based on interactions with the human and other agents

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

Requirements for `TODO.md`:

- it must stay lean, current, and easy to scan in seconds
- it must capture only the current focus, the top near-term priorities, and any live blocker or waiting item that matters right now
- by default it should keep at most three open priority items unless the human explicitly asks for a broader plan
- it must not become a backlog, transcript, scratchpad, or done-history log
- completed, stale, or low-priority items must be removed or rewritten promptly instead of accumulated
- durable user preferences belong in `USER.md`, shared project facts belong in `PROJECT-AND-TEAM.md`, and long-term facts belong in `MEMORY.md`
- agents should rewrite it whenever priorities, ownership, or blockers change instead of treating it as append-only

Requirements for `PROJECT-AND-TEAM.md`:

- it must be concise, curated, and project-scoped
- it must begin with YAML front matter containing `project_name`, `project_description`, and `project_emoji` fields for concise display identity
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
- `/session_reset` must start a new session folder for the active agent
- conversation logs must not be stored in `.opencolab`
- raw session logs are archival and must not be fed wholesale into provider prompts
- routed agent executions must append the inbound user turn before provider execution begins so timeout or failure does not erase the request from session history
- timed-out, stopped, or failed routed executions must append a compact assistant recovery entry to the active session so the next turn can resume from the last known state without replaying the whole transcript
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
- packaged installs must not let stray `opencolab.json` or `.env.local` files in the caller's current working directory silently override the platform runtime root unless the operator explicitly sets `OPENCOLAB_ROOT`
- when `OPENCOLAB_ROOT` is unset and the current execution is a git/source checkout, CLI and runtime config resolution may default to the caller's current working directory
- `opencolab upgrade` must operate on the current OpenColab install root, not on arbitrary unrelated git repositories or on the active workspace directory by mistake
- one-link installer-managed installs must persist a managed install manifest under the runtime root that records the install mode plus the managed paths needed for future upgrade and repair
- when the runtime root contains a managed install manifest, `opencolab upgrade` must upgrade that managed install even if the currently executing `opencolab` binary came from another package install earlier on `PATH`
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must update that install to the latest `origin/main`
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must fail when the install git worktree has tracked local changes instead of attempting a merge
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must fetch `origin main`, switch to local branch `main`, fast-forward to `origin/main`, install dependencies, and rebuild
- when the current OpenColab install is a git/source checkout, `opencolab upgrade` must run a lightweight post-build smoke check before reporting success
- when the runtime root contains an installer-managed package manifest, `opencolab upgrade` must rerun the managed package install into the installer-owned prefix, verify the managed CLI entrypoint, and run a lightweight smoke check against the managed runtime root before reporting success
- when the runtime root contains an installer-managed clone manifest, `opencolab upgrade` must update that managed checkout to the latest `origin/main`, install dependencies, rebuild, and run a lightweight smoke check against the managed runtime root before reporting success
- when the current OpenColab install is a packaged install without the repo git metadata, `opencolab upgrade` must not attempt git operations and should print package-manager upgrade guidance, including an npm global-install example
- when a managed background gateway service is running, installer-managed package, installer-managed clone, and git/source `opencolab upgrade` must restart it after a successful upgrade
- gateway restart after upgrade must preserve the configured service port and Telegram polling mode instead of silently reverting to defaults
- when no managed background gateway service is running, successful `opencolab upgrade` should print that no automatic restart was performed
- configure one provider API key without changing the active agent runtime
- configure provider for the active agent
- provider configuration must ask for provider and model, must support provider auth mode selection when available, and must ask for native reasoning effort when the selected provider/model exposes it
- `ignite` should offer curated concrete model options per provider ordered from smarter to less smart; Gemini options must include `gemini-3.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, and `gemini-3-flash-preview`; Gemini provider defaults must use `gemini-3.5-flash`; MiniMax options must include `MiniMax-M2.5` and `MiniMax-M2.7`; OpenRouter options must include `~deepseek/deepseek-v4-flash-latest` and `deepseek/deepseek-v4-pro`
- OpenAI, Anthropic, and Gemini provider auth modes must support `api_key` and `oauth`
- `opencolab setup model` must accept a native `--reasoning-effort <value>` flag for provider/model pairs that support configurable reasoning
- OpenAI `gpt-5.5` must support native reasoning effort values `low`, `medium`, `high`, and `xhigh`, defaulting to `high`
- Anthropic Claude models on the Claude runtime must support native reasoning effort values `low`, `medium`, `high`, `xhigh`, and `max`, defaulting to `high`
- OpenRouter `deepseek/deepseek-v4-pro` on the `pi` runtime must support native reasoning effort values `high` and `xhigh`, defaulting to `high`; pi clamps unsupported levels silently, so only levels the model distinguishes may be offered
- native reasoning effort for pi-backed providers must be delivered as `pi --thinking <level>`, inserted ahead of the trailing positional user-message argument so that argument stays last
- in `api_key` mode, provider API keys must be persisted in `.env.local` using canonical env names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, or `XAI_API_KEY`)
- when `ignite` asks for a provider or Runpod API key value, it should print a direct setup URL for that key first
- when `ignite` asks for `TELEGRAM_BOT_TOKEN`, it should print a BotFather instruction first
- in OpenAI `oauth` mode, setup must not require `OPENAI_API_KEY`
- in Anthropic `oauth` mode, setup must not require `ANTHROPIC_API_KEY`
- in Gemini `oauth` mode, setup must not require `GEMINI_API_KEY`
- Gemini-based built-in shared tools must use `GEMINI_API_KEY` even when the active agent runtime uses a different provider or Gemini `oauth`
- the shared `pageindex-grounded` skill must be able to use `GEMINI_API_KEY` for the local PageIndex runner even when the active agent runtime uses another provider or Gemini `oauth`
- in OpenAI `oauth` mode, runtime preflight must verify Codex login state and return remediation guidance if login is missing
- in Anthropic `oauth` mode, runtime preflight must verify Claude Code login state and return remediation guidance if login is missing or only `ANTHROPIC_API_KEY` auth is active
- in Gemini `oauth` mode, runtime must return remediation guidance when the CLI reports missing Google login or missing Gemini credentials
- provider CLI command/args must be auto-derived from internal defaults
- provider CLI defaults must support non-interactive execution with write access to the active project workspace
- when the active agent lives under `projects/<project_id>/AGENTS/<agent_id>/`, provider CLI defaults must still allow access to the parent project workspace
- recognized previously-shipped Claude-runtime CLI arg sets stored in `opencolab.json` must auto-migrate to the current Claude Code streaming defaults on load so existing installs keep Telegram live status after runtime contract changes
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
- on Windows, gateway background mode should be managed through a user Task Scheduler XML task that launches a hidden noninteractive PowerShell supervisor script under the runtime root, restarts the foreground gateway after any exit with a short delay, also configures Task Scheduler restart-on-failure as an outer safety net, avoids a finite execution time limit, and requires no administrator service installation or closeable console window
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
- `gpu ssh profile save|list|show|test|remove|set-default` must manage project-scoped saved manual SSH profiles for user-managed Pods, with optional per-agent default pointers
- `gpu ssh session start|list|read|write|stop` must manage explicit opt-in live manual SSH sessions against saved profiles rather than generic raw shell authority
- `gpu ssh session read` should return a stable machine-readable transcript slice including the requested offset, the next offset, and the current session state
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
- installer scripts must write a managed install manifest under the runtime root so future `opencolab upgrade` runs can upgrade the installer-managed package or clone without guessing from the active `PATH`
- installer-managed shims must continue to pin `OPENCOLAB_ROOT` to the installer-managed runtime root in both package and clone modes
- installer scripts should also support an explicit opt-in `--hacky` git-clone mode for one-link installs, intended as a hacky fallback when the desired npm package version is unavailable; clone mode should clone or update a repository checkout, build it locally, and expose the same `opencolab` command shim
- one-link installer-managed package installs and one-link installer-managed clone installs must both be upgradeable through `opencolab upgrade`
- npm package installs should also be supported for the `opencolab` CLI without requiring `dist/` to be tracked in git
- source checkouts must model the web client as a root pnpm workspace package so `pnpm install --frozen-lockfile` installs the Vite/Tailwind client dependencies required by `pnpm run build`
- the published npm package must include the built CLI entrypoint, built web assets, built-in agent templates, and built-in shared skills required for runtime fallback behavior
- the npm package build artifacts may be generated at pack/publish time rather than committed to the repository

## 8. Telegram Commands

Gateway must support project/agent picker commands plus direct session reset and stop commands from authorized, paired chat.

Minimum supported commands:

- `/projects`
- `/agents`
- `/session_reset`
- `/stop`

Messages that are not management commands are routed to the active agent.

Interactive selection requirements:

- `/projects` must return a project picker with inline Telegram buttons for every known project plus a cancel button
- tapping a project button must switch the active project and persist the selection
- `/agents` must return an agent picker with inline Telegram buttons for every agent in the active project plus a cancel button
- tapping an agent button must switch the active agent and persist the selection
- `/stop` must cancel the active routed run for the same Telegram conversation lane, append a compact assistant recovery entry, and prevent the stopped run from sending a late final reply
- gateway must accept Telegram `callback_query` updates for these button taps, answer the callback query, and send a clear selection confirmation

Slash-menu registration:

- `/projects` -> interactive project picker
- `/agents` -> interactive agent picker
- `/session_reset` -> reset the active session and start a new session folder
- `/stop` -> stop the active routed run and save a compact recovery summary

## 9. Provider Constraints

Supported provider identifiers:

- `openai`
- `anthropic`
- `gemini`
- `minimax`
- `xai`
- `openrouter`
- `kimi`

Provider/runtime notes:

- provider configuration is stored on each agent, not on the project
- execution-target configuration is stored on each project, not on the agent provider config
- provider config includes auth mode (`api_key` or `oauth` where supported)
- OpenAI, Anthropic, and Gemini support `api_key` and `oauth` auth modes
- MiniMax, xAI, OpenRouter, and Kimi are `api_key` only in v1
- some providers may reuse an existing CLI runtime instead of shipping a dedicated CLI
- `gemini` uses the `gemini` CLI runtime
- Gemini v1 scope is limited to Google login (`oauth`) or `GEMINI_API_KEY`; Vertex AI auth is out of scope
- `minimax` uses the `claude` runtime with MiniMax's Anthropic-compatible gateway
- `xai`, `openrouter`, and `kimi` use the shared `pi` runtime from `pi-mono`
- `kimi` is stored as an explicit OpenColab provider name while mapping to the upstream `pi` provider id `kimi-coding`

Runtime architecture:

- provider config should continue to store `name`, `model`, and `authMode`
- provider config should additionally store a runtime selector so OpenColab can distinguish native runtimes from shared runtimes such as `pi`
- native defaults should remain the default for providers with a well-supported dedicated CLI:
  - `openai` -> `codex`
  - `anthropic` -> `claude`
  - `gemini` -> `gemini`
  - `minimax` -> `claude` with Anthropic-compatible gateway env wiring
- repo-managed Codex defaults must launch `codex` with `-a never`, `exec --skip-git-repo-check --json`, and `--sandbox danger-full-access` so routed Codex runs can edit, clone, and push within the active project workspace without interactive approval prompts, the default workspace-write sandbox blocking git operations, or Codex rejecting non-git workspaces
- repo-managed OpenAI defaults and onboarding examples should use `gpt-5.5`
- repo-managed OpenRouter examples that point at an OpenAI model should use `openai/gpt-5.5`
- pi-backed defaults should be:
  - `xai` -> `pi`
  - `openrouter` -> `pi`
  - `kimi` -> `pi` using the upstream `kimi-coding` runtime provider id
- providers without a native CLI should default to the `pi` runtime
- OpenColab must keep explicit provider names even when multiple providers share the same runtime so project state, setup UX, and auth handling remain clear

`pi` integration requirements:

- `pi` must run in non-interactive mode for routed Telegram and CLI-triggered agent execution
- `pi` must be invoked from the active agent directory while still allowing access to the active project workspace
- OpenColab should remain the source of truth for project state, Telegram routing, memory files, and conversation logs
- OpenColab should avoid duplicating prompt context that `pi` already loads automatically from local context files
- runtime preflight must verify that the `pi` command is available on `PATH` before attempting execution
- runtime preflight must verify provider credentials required by the selected pi-backed provider before attempting execution
- model configuration for pi-backed providers should prefer runtime discovery when available and fall back to explicit manual model entry when discovery is unavailable or fails
- `xai` setup should use `XAI_API_KEY` as the canonical API key environment variable unless a later pi upstream change requires a different canonical variable
- `openrouter` setup should use `OPENROUTER_API_KEY` as the canonical API key environment variable
- `kimi` setup should use `KIMI_API_KEY` as the canonical API key environment variable while invoking `pi` with provider id `kimi-coding`
- OpenColab should treat pi sessions, extensions, themes, and other pi-local UX state as out of scope for initial integration unless they are required for non-interactive execution

Future provider expansion may continue through `pi` for any provider or model family that `pi` supports directly or through user-managed custom model configuration.

## 10. Configuration Persistence (`opencolab.json`)

`opencolab.json` is the source of truth and must contain project and agent configuration.
`opencolab.json` and `.env.local` live at the runtime root, while internal runtime/service state lives under `<runtime_root>/.opencolab/`.
Long-running runtimes such as the gateway must preserve valid `opencolab.json` changes made by other CLI processes while they are running. State writes must merge the runtime's actual in-memory mutations onto the latest disk state before writing, so externally-created projects, agents, provider settings, Telegram config, and similar persisted changes are not clobbered by stale snapshots.

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
      "heartbeat": {
        "pending": null
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
          "preferredGpuTypes": ["NVIDIA A100 80GB PCIe"],
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
          "autoStopPolicy": "keep_warm"
        }
      }
    }
  },
  "telegram": {
    "chatId": "<telegram-chat-id>",
    "paired": true,
    "pairedAt": "2026-02-27T00:00:00.000Z",
    "lastChatType": "private",
    "lastMessageThreadId": null,
    "lastInteractionAt": "2026-02-27T00:05:00.000Z"
  }
}
```

Heartbeat persistence requirements:

- pending heartbeat state must live in the owning project entry inside `opencolab.json`
- the minimal persisted shape is `projects.<project_id>.heartbeat.pending`
- `pending` must be either `null` or `{ "agentId": "<agent_id>", "wakeAt": "<iso8601>" }`
- heartbeat must not create a separate runtime-owned persistence file for scheduling state

Notes:

- secret values are stored in `.env.local` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MINIMAX_API_KEY`, `XAI_API_KEY`, `RUNPOD_API_KEY`, `TELEGRAM_BOT_TOKEN`)
- when OpenAI auth mode is `oauth`, `OPENAI_API_KEY` is optional
- when Anthropic auth mode is `oauth`, `ANTHROPIC_API_KEY` is optional
- when Gemini auth mode is `oauth`, `GEMINI_API_KEY` is optional
- execution targets belong at project scope, not inside per-agent provider configuration
- saved manual SSH profiles for user-managed Pods also belong at project scope, not inside per-agent provider configuration
- SSH private keys must not be embedded in `opencolab.json`
- `opencolab.json` must not store raw secret values or env-var secret references
- extra fields are allowed if they do not break the minimum contract

## 11. Execution Targets and Remote GPU Jobs

OpenColab must treat experiment execution targets as a separate control-plane concept from agent provider runtimes.

### 11.1 Execution Target Model

Requirements:

- an `ExecutionTarget` is a named remote GPU environment available to a project
- execution targets must live at project scope, not inside agent provider config
- saved manual SSH profiles for user-managed Pods must also live at project scope, with optional per-agent default pointers
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

Saved manual Pod SSH requirements:

- a saved manual SSH profile must store structured connection fields rather than a raw secret-bearing shell string
- a saved manual SSH profile may store `pod_id`, host, port, user, key-path reference, SSH config host alias, workspace root, and an interactive-access policy
- saved manual SSH profiles are distinct from OpenColab-managed `ExecutionTarget` runs and remain outside the normal `run_id` lifecycle
- live manual SSH sessions must be explicit opt-in, transcript-backed, and line-oriented in the first version
- transcript output from live manual SSH sessions must not be copied verbatim into normal conversation memory

### 11.2 Run Manifest and Local State

Requirements:

- an `ExperimentRun` is one bounded remote execution attempt launched against an execution target
- each run must have an immutable local manifest plus mutable status tracking under the project `experiments/runs/` tree
- the manifest is the canonical local record for reproducibility and debugging
- the manifest must include run id, project id, agent id, target id, requested command, working directory, environment variable references, sync include list, expected artifact paths, timestamps, and source revision metadata when available
- status tracking must preserve the last meaningful stage even when provisioning, launch, fetch, or cleanup fails
- live manual SSH sessions must keep mutable session metadata plus a transcript under the project `experiments/ssh-sessions/` tree

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
  - local file references may be relative to the active agent working directory, absolute including Windows drive-letter or UNC paths, or `file://` URLs
  - directive lines may be wrapped in a single pair of backticks and should still be accepted
- `setup telegram` should register the supported Telegram commands via `setMyCommands` so `/projects`, `/agents`, `/session_reset`, and `/stop` appear in slash-menu suggestions

## 13. Incremental Task Updates

OpenColab must support multi-message Telegram UX for long-running work such as literature search, large codebase analysis, long test runs, multi-step file processing, bulk downloads, or any task where meaningful intermediate milestones exist.

Goals:

- reduce the "silent bot" effect during long runs
- let the user see concrete stage changes before completion
- keep updates useful and bounded, especially in group chats
- preserve a high-quality final answer instead of replacing it with fragmented chatter

Live status is a first-class runtime capability, not a prompt-only convention.

### 13.1 Native Runtime Status Contract

Provider adapters and OpenColab-owned long-running workflows must be able to emit structured status events while the task is still running.

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

- provider adapters must prefer native machine-readable runtime streams over prompt-level progress protocols
- the default provider integrations must use native event modes for routed Telegram runs:
  - Codex: `codex -a never exec --skip-git-repo-check --json` with `--sandbox danger-full-access`
  - Claude Code: `claude -p --verbose --output-format stream-json`
  - Gemini CLI: `gemini --output-format stream-json`
  - Pi: `pi --mode json`
- `kind` is required
- `message` is required and must be concise, concrete, and user-facing
- `stage` is recommended for routing and de-duplication
- `current` and `total` are optional and should be used for countable work
- `slot` is optional and allows the gateway to update or replace an earlier progress message for the same workstream
- `ephemeral` defaults to `true`; operational progress updates must not be treated as normal assistant conversation turns
- raw provider events must be normalized into this internal event model before Telegram rendering
- Codex lifecycle events such as `item.started`, `item.completed`, and `turn.completed` must be normalized from their nested payloads or completion fields; those raw protocol names must never be rendered as user-facing progress text

Notes:

- status events are transport-level metadata and must be stripped from the final assistant prose shown as the completed answer
- status events must not be appended to the agent's normal session conversation log as if they were substantive assistant replies
- if run telemetry is persisted later, it should live in a separate operational log, not in the conversational memory stream

### 13.2 Gateway Behavior

For routed tasks with meaningful duration, the gateway should expose status in this order:

1. startup feedback while work begins
2. one bounded live status surface during execution after real progress exists
3. final consolidated answer

Requirements:

- the gateway must not send a generic placeholder status message before meaningful runtime progress exists
- the gateway must keep the final completion message distinct from the live status surface
- when platform text limits would reject the final completion message, the gateway must split the final answer into multiple ordered messages instead of dropping it
- paired private chats, group chats, supergroups, and channels must use one persistent editable status message via `sendMessage` plus `editMessageText`
- the live status message must remain in the Telegram conversation after the final answer is sent so users can see what the agent did
- all live status surfaces should render the same bounded recent tool-activity list derived from runtime events so users can see what the agent is actively doing
- the gateway should throttle repetitive editable status updates so users see stage changes, not a token-by-token transcript
- `warning` and `needs_input` events may bypass normal throttling when they materially affect the run
- `sendChatAction` should only be used as short startup fallback feedback before the live status surface exists
- if no status events are emitted, current `typing` behavior remains the fallback
- Telegram API failures must retain the API status and description in gateway logs so delivery errors such as oversized messages are diagnosable
- routed Telegram text replies should be prefixed with the active agent id on its own first line so operators managing multiple agents in one chat can see who answered, while conversation memory keeps the underlying assistant text without that transport-only header
- live status lines should mark the newest visible current step with `🟢` and older still-visible steps with `⚪` so the active line is obvious at a glance

Recommended UX policy:

- create the live status surface only after the first meaningful runtime event
- render one short heading plus a few current lines instead of a transcript
- when multiple live status lines are visible, highlight only the newest line as active and keep earlier visible lines visually subdued
- across private chats, groups, supergroups, and channels, prefer recent user-facing tool actions such as read, search, edit, run, or fetch
- send updates only on meaningful stage changes, count deltas, blockers, or transitions that help the user
- avoid raw tool names, raw JSON, token-by-token prose, internal reasoning, and exhaustive command transcripts
- avoid more than a small handful of status rewrites per run in group chats
- keep split final-answer chunks in original order and preserve the active Telegram topic or thread when one is present

### 13.3 Skill and Agent Authoring Rules

Built-in skills and default agent guidance must explicitly support OpenColab-owned live status for long tasks.

Requirements:

- agents should not stay silent about real blockers or required user input during a long multi-step task
- agents should avoid low-signal "thinking aloud" updates
- final answers should remain synthesized and complete, not a loose concatenation of earlier progress notes
- default agent guidance must stop treating "one thoughtful response" as a blanket rule for long-running operational tasks
- default agent guidance must describe Telegram live status as an OpenColab runtime feature, not an agent-authored JSON protocol
- default agent guidance must explicitly tell agents not to narrate every minor command because OpenColab derives bounded status from runtime events

Recommended rule of thumb:

- let the runtime surface stage changes, dense counters, warnings, and blockers
- let the agent focus on doing the work and producing a good final answer
- do not ask the agent to print a Telegram-specific progress protocol during normal routed runs

### 13.4 Research Skill UX Requirements

The shared `fast-research`, `pro-research`, and `deep-research` skills must support bounded runtime status updates tied to their actual workflow stages.

For paper research workflows, expected update categories include:

- retrieval started
- candidate corpus size known
- deep-read or selected-paper set chosen
- PDF download progress
- paper summarization progress
- synthesis/report-writing started
- final report delivered

The shared `fast-research`, `pro-research`, and `deep-research` skills must also generate a companion literature-map block diagram through the shared `block-diagram` skill.

Each research run must use a topic-scoped workspace:

- create or reuse an active run folder at `research/<YYYY-MM-DD>-<topic-slug>/`, where the slug is lowercase, ASCII, hyphenated, and specific enough to distinguish the topic from other work,
- treat that run folder as the base for `findings.md`, `search/`, `meta/`, `pdf/`, `tables/`, `diagrams/`, and any downstream grounding or figure artifacts,
- avoid writing new topic artifacts into the flat `research/` root except for shared indexes,
- keep `research/INDEX.md` as the agent-readable catalog of research folders, with folder path, skill, topic, status, created/updated dates, corpus counts, main deliverables, and one-line notes,
- create and update `<run-folder>/RUN.md` with the run-local metadata, scope, status, corpus counts, generated artifacts, and follow-up notes,
- initialize or update the index when a run starts, and update both `research/INDEX.md` and `<run-folder>/RUN.md` after the research is complete, partial, or blocked.

That companion diagram should:

- show the selected papers or compact paper-family clusters as nodes,
- show only evidence-backed relations such as method lineage, direct comparison, shared benchmark or dataset, critique, or common problem framing,
- avoid invented influence or citation edges that are not supported by the corpus,
- stay compact and readable, clustering papers when a flat per-paper graph would be noisy,
- produce companion `.d2` plus rendered diagram artifacts alongside the report,
- and prefer `.png` as the primary user-facing literature-map artifact, falling back to `.svg` when PNG rendering is unavailable.

The shared `fast-research`, `pro-research`, and `deep-research` skills must also keep their skill-specific `findings.md` format stable while returning a friendlier final chat reply for user-facing interactive runs. That final reply should:

- stay concise instead of dumping the whole report into chat,
- include a direct answer, corpus coverage stats, and the most important cited takeaways,
- include one short literature-map line explaining how the main papers or paper families connect,
- surface major limitations or uncertainty when they materially affect confidence,
- allow light emoji use when it improves scanability,
- and attach or otherwise return `findings.md` plus the PNG literature-map diagram when the active channel supports file delivery, falling back to the SVG artifact when PNG rendering is unavailable.

### 13.5 PageIndex Grounded Skill Requirements

The shared `pageindex-grounded` skill must complement the paper research and summary workflows rather than replace them.

Requirements:

- it must operate on already-downloaded local PDFs, not on paper discovery
- it must treat `fast-research`, `pro-research`, and `deep-research` as the retrieval path for finding papers and `paper-summary` as the canonical per-paper summary path
- it must keep paper selection bounded before retrieval, normally searching 1 paper for a single-paper question and 2-5 papers for a cross-paper question unless the user explicitly asks for broader coverage
- it must prefer the active research run folder selected from `research/INDEX.md` when prior research used the topic-scoped layout, while still supporting older flat `research/pdf/` projects
- it must persist PageIndex artifacts under the active run folder, normally `<run-folder>/pageindex/`, including `trees/` for cached per-paper tree JSON and `answers/` for optional grounded answer notes
- it must maintain a machine-readable `<run-folder>/pageindex/manifest.json` that records selected local papers, PDF paths, tree paths, and freshness or indexing status
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
- point the user to any persisted grounded answer note under `<run-folder>/pageindex/answers/` when a longer artifact was written

### 13.6 PDF Figure Extract Skill Requirements

The shared `pdf-figure-extract` skill must complement grounded QA and diagram workflows by locating and returning figures from already-downloaded local PDFs.

Requirements:

- it must operate only on already-downloaded local PDFs, not on paper discovery
- it must use PyMuPDF as the local extraction and rendering engine
- it must support both direct hints such as paper id, page number, or figure number and ambiguous requests such as "send me the architecture figure"
- it must prefer the active research run folder selected from `research/INDEX.md` when prior research used the topic-scoped layout, while still supporting older flat `research/pdf/` projects
- it must reuse cached PageIndex artifacts under the active run folder, normally `<run-folder>/pageindex/`, when they are available and relevant, but PageIndex must remain optional and missing PageIndex must not block extraction
- it must persist figure artifacts under the active run folder, normally `<run-folder>/figures/`, including exported image files plus machine-readable manifest data that records paper id, PDF path, page, bounding box or region metadata, source mode, and confidence-relevant notes
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

### 13.7 LaTeX Paper Writer Skill Requirements

The shared `latex-paper-writer` skill must support scientific paper and report production as a first-class OpenColab workflow.

Requirements:

- it must create and edit LaTeX paper workspaces without overwriting user-owned source, macros, bibliography files, figures, or tables
- it must support venue-aware template selection for common ML, deep learning, computer vision, NLP, robotics, systems, AI, multimedia, medical AI, audio, HCI, graphics, and security venues
- it must treat ICLR as the canonical venue name and may infer it from near misses such as ICRL when context is clear
- it must avoid claiming official conference-template compliance unless the exact official template is bundled, provided by the user, or otherwise verified
- it must keep generated or managed paper folders under Git version control, prefer an existing Git worktree when the paper already lives inside one, initialize a dedicated repository when needed or explicitly requested, and never stage or commit unrelated files outside the paper workspace
- it must provide helper scripts for paper workspace initialization, scoped Git checkpoints, PDF compilation, LaTeX validation, and experiment-result table generation
- it must compile PDFs with `latexmk` when available, fall back to a bounded `pdflatex`/bibliography flow when possible, and provide platform-specific `latexmk` installation guidance when the compiler is missing
- it must use `fast-research`, `pro-research`, and `deep-research` outputs as research inputs for research-derived reports, `pageindex-grounded` for exact local evidence checks, `pdf-figure-extract` for figures from already-downloaded papers, and `block-diagram` for synthesized architecture or literature-map diagrams
- it must cite non-trivial technical claims in research-derived summaries and must not fabricate paper metadata, citations, architecture details, benchmark values, or unsupported claims
- it must generate reusable LaTeX table fragments for experiment results from CSV, JSON, markdown tables, or simple metric logs
- when the active channel supports file delivery, it must return the final PDF through the channel's file-delivery mechanism, using raw `@telegram-file` directives for Telegram-routed runs

### 13.8 Diagram Skill Requirements

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
- expose an optional ML/LLM architecture template under `projects/SKILLS/block-diagram/` for neural-network, transformer, training, and quantization diagrams without turning that template into a separate shared skill,
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

### 13.9 Failure and Recovery UX

Progress support must improve failure handling as well as success handling.

Requirements:

- if a long task fails after partial work, the user should receive a short failure message that includes the last meaningful completed stage when available
- warnings that reduce coverage or confidence should be surfaced before the final answer when they materially change the result
- if the runtime needs human intervention, the user should receive a `needs_input` style message instead of waiting for timeout or generic failure

### 13.10 Provider Timeout Recovery

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

### 13.11 Heartbeat Wake-Up

Heartbeat is a delayed follow-up for the active agent, not a general scheduler.

Requirements:

- every agent directory must include a seeded empty `HEARTBEAT.md`
- heartbeat must stay disabled until the user explicitly edits `HEARTBEAT.md` and adds a valid `after: <duration>` line
- heartbeat may optionally honor `notify: digest` or `notify: live` in `HEARTBEAT.md`; if omitted, heartbeat remains fully silent in Telegram
- heartbeat may optionally honor a bounded single-line `message: <plain text>` in `HEARTBEAT.md`; missing, empty, or oversized messages must fall back to `continue`
- after an active-agent run completes, is stopped by `/stop`, or times out, the runtime may arm one pending wake-up for that same agent
- the pending wake-up must be stored in the owning project state in `opencolab.json`
- if the active agent changes before the wake-up fires, the pending wake-up must be cleared
- if the same agent starts another turn before the wake-up fires, the pending wake-up must be cleared
- when the wake-up is due and that same agent is idle, the background gateway process must run one internal turn with the resolved heartbeat message, defaulting to `continue`
- heartbeat must stay quiet by default and must not emit routine Telegram chatter just because a wake-up was scheduled or fired
- `notify: digest` must send at most one compact final text message after the heartbeat turn finishes; it must not create live status or progress streaming for the background run
- `notify: live` must reuse the existing Telegram live-status renderer for provider progress during the heartbeat turn, must not create a generic placeholder before meaningful provider progress exists, and may send the same compact final digest after the live status closes when the result is meaningful or needs attention
- `notify: digest` must always notify on heartbeat `failed` and `timed_out` outcomes, should notify on clear human-input blockers, and should notify on `completed` only when the final assistant output is meaningful and non-trivial
- heartbeat Telegram delivery must target the configured paired chat only; the runtime may preserve the most recent authorized Telegram chat type and topic/thread id for live status and digest delivery, but must not guess a different chat or per-agent destination

## 14. Acceptance Criteria

v1 is complete when all are true:

- CLI can create/select projects and agents.
- Telegram can create/select projects and agents.
- Active project routes to its active agent and provider runtime.
- Provider runtimes can edit the active project workspace without interactive permission prompts.
- `opencolab.json` persists active project, all project/agent configs, and one shared Telegram config.
- A running gateway must preserve valid project and agent changes made by separate CLI processes instead of overwriting them from a stale in-memory state snapshot.
- The default `professor` agent is created under `projects/<project_id>/AGENTS/professor/`.
- The optional built-in `beginner` agent is created under `projects/<project_id>/AGENTS/beginner/` when used.
- The optional built-in `autoresearch` agent is created under `projects/<project_id>/AGENTS/autoresearch/` when used.
- Additional agents are created under `projects/<project_id>/AGENTS/<agent_id>/`.
- New agents seed an empty `HEARTBEAT.md`, and heartbeat stays disabled until the user adds a valid `after:` value.
- Optional `notify: digest` can send one compact paired-chat Telegram follow-up after a meaningful heartbeat completion, timeout, failure, or clear blocker; `notify: live` can also show the existing Telegram live-status surface while the heartbeat turn runs.
- Optional `message: <plain text>` can replace the default heartbeat prompt `continue` while still requiring a valid `after:` line.
- The default `professor` agent seeds from the built-in professor template assets, sourced from `src/agent-templates/professor/` in the repository and shipped in packaged installs; the built-in `beginner` and `autoresearch` agent ids and additional agents follow the same built-in template rules with fallback to shared template assets.
- Agent conversation logs are saved in per-agent `memory/Session/<session_id>/<YYYY-MM-DD>.jsonl`.
- Long-running routed tasks can emit bounded intermediate Telegram updates before the final answer.
- Progress updates are treated as operational events rather than normal assistant conversation turns.
- Shared research skills support agent-chosen progress events for retrieval, selection, download, summarization, and synthesis phases.
- The background gateway process can schedule one pending heartbeat wake-up per project and fire an internal turn for the same active agent when due, using `continue` unless `HEARTBEAT.md` configures a valid `message:`.

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
