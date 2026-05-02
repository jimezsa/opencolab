# OpenColab Next Feature Direction

## Purpose

This document defines the next product direction after the first OpenColab release.

The first release establishes the local runtime foundation:

- multi-project workspaces
- durable agents
- CLI and Telegram control
- provider runtime integration
- shared research skills
- Runpod-backed remote experiment execution
- conversation memory
- research, figure, diagram, and LaTeX paper workflows

The next phase should make this lab visible, controllable, and customizable through a clean local web interface and a workflow layer for coordinated multi-agent work.

## Product Direction

OpenColab should evolve from a CLI and Telegram-controlled agent router into a local research-lab operating system.

The web interface should not replace the CLI or Telegram. It should sit above the existing runtime and expose the same project, agent, memory, artifact, provider, gateway, and execution-target state in a clearer form.

The guiding product idea:

> OpenColab Studio is the local control room for an always-on AI research lab.

The human should be able to open the web interface and immediately answer:

- What projects exist?
- Which project is active?
- Which agents exist and what are they doing?
- What conversations happened recently?
- What documents, papers, figures, reports, and artifacts were produced?
- Which workflows are running or waiting for approval?
- Which experiments are running, failed, or completed?
- What needs human judgment next?

## Design Principles

### 1. Build on the Current Runtime

The web interface should expose existing OpenColab state first instead of inventing a separate product model.

Primary sources of truth should remain:

- `opencolab.json`
- project directories under `projects/<project_id>/`
- agent directories under `projects/<project_id>/AGENTS/<agent_id>/`
- agent memory under `memory/Session/` and `memory/Daily/`
- research outputs and documents in project-local folders
- experiment records under `projects/<project_id>/experiments/`
- shared skills under `projects/SKILLS/`

### 2. Make the Lab Observable Before Making It Fully Controllable

The first web milestone should be read-heavy:

- show projects
- show agents
- show conversations
- show documents
- show runs
- show status
- show artifacts

After the observability layer is stable, add controls:

- switch project
- switch agent
- message agent
- stop active work
- reset session
- edit curated memory/context files
- configure workflows

### 3. Treat Artifacts as First-Class Research Objects

OpenColab should not feel like a chat app with file attachments. It should feel like a research workspace.

Important objects include:

- downloaded PDFs
- paper metadata
- extracted figures
- PageIndex trees
- `findings.md`
- diagrams
- LaTeX workspaces
- compiled PDFs
- experiment logs
- metrics files
- Runpod artifacts
- HuggingFace models
- HuggingFace datasets
- dataset cards and model cards
- decision summaries

### 4. Keep Human Approval Explicit

OpenColab should become more autonomous, but not careless.

Workflows should support approval gates for:

- research framing
- specialist creation
- Runpod spending
- experiment commands
- long-running jobs
- paper outlines
- final claims
- external publishing or sharing

### 5. Workflows Should Coordinate Agents, Not Hide Them

The workflow layer should make agent collaboration clearer.

A workflow should show:

- participating agents
- step ownership
- current step
- expected output
- required skill
- handoff target
- approval status
- produced artifacts

## Feature Group 1: Web Control Room

Add a local web interface served by the OpenColab gateway.

The initial web interface should provide a clean, utilitarian control room for the local lab.

Core screens:

- Projects dashboard
- Active project overview
- Agent roster
- Agent detail page
- Conversation browser
- Documents and artifacts library
- Workflow dashboard
- GPU runs and SSH sessions monitor
- Provider and gateway health page
- Settings page

The UI should be optimized for scanning and repeated daily use, not for marketing presentation.

## Feature Group 2: Project Dashboard

Each project should have a dashboard that summarizes the state of the project.

Recommended fields:

- project id
- active/inactive status
- current project goal
- current focus
- active agent
- agent roster
- recent sessions
- recent outputs
- current TODO priorities
- live blockers
- downloaded documents
- generated research artifacts
- active and recent experiment runs
- generated papers and reports
- next suggested actions

The project dashboard should draw from:

- `PROJECT-AND-TEAM.md`
- agent `TODO.md` files
- session memory
- document/artifact indexes
- experiment status files
- workflow state files once workflows exist

## Feature Group 3: Agent Workspace

Each agent should have a dedicated workspace page.

Recommended fields:

- agent id
- role/template type
- provider
- model
- auth mode
- reasoning effort when applicable
- current TODO
- heartbeat configuration
- long-term memory summary
- active session
- recent sessions
- recent outputs
- assigned workflows
- current or recent runtime status

Recommended controls:

- message this agent
- set as active agent
- stop active run
- start new session
- edit `TODO.md`
- edit `MEMORY.md`
- edit `HEARTBEAT.md`
- view raw agent files

Editing controls should be careful because these files are part of the prompt contract. The UI should preserve markdown and avoid silently rewriting user-owned context.

## Feature Group 4: Conversation Browser

Add a searchable browser for agent conversations.

Core capabilities:

- list sessions by project
- filter by agent
- filter by date
- inspect active session
- inspect previous sessions
- inspect previous-day summaries
- distinguish user, assistant, Telegram, web, and recovery entries
- hide raw provider protocol events
- link messages to produced files when possible
- export a session summary
- start a new session

The browser should make clear that conversation history belongs under agent-local memory, not under `.opencolab`.

## Feature Group 5: Documents and Artifacts Library

Add a project-level library for research materials and outputs.

The library should organize:

- papers and PDFs
- downloaded Telegram files
- extracted figures
- PageIndex caches
- research findings
- block diagrams
- LaTeX workspaces
- generated PDFs
- downloaded HuggingFace models
- downloaded HuggingFace datasets
- model cards and dataset cards
- experiment manifests
- experiment logs
- experiment artifacts
- metrics and plots

Useful views:

- by type
- by agent
- by workflow
- by date
- by source
- by paper/citation
- by experiment run

Each artifact should show:

- local path
- project
- producing agent if known
- producing workflow step if known
- creation/update time
- related conversation if known
- related input documents if known
- source repository, revision, and license when known

## Feature Group 6: Live Work Monitor

Add one web surface for currently running work.

The monitor should unify:

- provider runtime events
- Telegram live-status events
- active workflow steps
- active Runpod jobs
- active manual SSH sessions
- recent logs
- cancellation state
- failure/recovery summaries

This should reuse the same normalized event model used for Telegram live status.

The monitor should never expose raw provider lifecycle names such as protocol-specific event ids directly to users.

## Feature Group 7: Workflow Layer

Add a workflow model for coordinated multi-agent work.

A workflow should define:

- workflow id
- project id
- title
- goal
- participating agents
- ordered steps
- optional parallel steps
- required skills
- step inputs
- expected step outputs
- artifact requirements
- human approval gates
- stop conditions
- handoff rules
- current status
- execution history

Example conceptual workflow:

```text
Human gives topic
-> Professor clarifies goal
-> Literature agent runs deep-research
-> Peer reviewer critiques findings
-> Professor selects experiment plan
-> Autoresearch agent runs experiment loop
-> Writing agent drafts report
-> Human approves final PDF
```

Workflow state should be persisted locally and should be inspectable from CLI, Telegram, and web over time.

## Feature Group 8: Workflow Templates

Ship useful predefined workflow templates before building a fully custom visual workflow builder.

Recommended initial templates:

- `deep-literature-review`
- `paper-to-report`
- `reproduce-and-test`
- `experiment-loop`
- `research-to-latex-paper`
- `grant-idea-evaluation`
- `agent-peer-review`
- `idea-to-prototype`
- `model-and-dataset-preparation`
- `benchmark-with-huggingface-assets`

Each template should specify:

- required agents
- optional agents
- default lead agent
- required skills
- step sequence
- expected artifacts
- approval gates
- failure handling

Templates should be editable later, but the first version can be configuration-driven rather than visually designed.

## Feature Group 9: Custom Workflow Builder

After template execution works, add a visual or structured workflow builder.

The builder should allow users to define:

- agent participants
- step order
- parallel branches
- skills per step
- input and output contracts
- approval gates
- retry rules
- stop conditions
- artifact delivery rules

The first custom builder can be form-based. A graph editor can come later.

Important workflow rule:

Agents should remain visible as responsible owners. The workflow should not become an opaque automation where the user cannot tell who decided what.

## Feature Group 10: Human Approval Gates

Human approvals should become first-class workflow objects.

Approval gates should support:

- prompt/question text
- approving user/channel
- approve/reject buttons in web
- optional Telegram approval
- optional CLI approval
- timeout behavior
- rejection notes
- resumed workflow state after approval

Common approval gates:

- approve research question
- approve agent roster
- approve specialist creation
- approve GPU spend
- approve experiment command
- approve using a manual Runpod Pod
- approve paper outline
- approve final report
- approve external publication step

## Feature Group 11: Knowledge Map

Add a project-level knowledge map after the document and workflow layers are stable.

Initial knowledge objects:

- papers
- authors
- methods
- datasets
- claims
- figures
- experiments
- metrics
- decisions
- open questions
- citations

The first version can be an indexed, searchable map rather than a full graph database.

The long-term direction is a reusable project memory layer where agents can build on prior evidence instead of restarting from conversation history.

## Feature Group 12: HuggingFace Integration Skill

Add a shared HuggingFace skill so agents can safely discover, download, inspect, and prepare models and datasets for experiments.

This should probably ship as a new shared skill:

- `projects/SKILLS/huggingface/SKILL.md`

The skill should be the canonical AI-facing path for HuggingFace work, similar to how `runpod-job` owns Runpod work and `pageindex-grounded` owns grounded local paper QA.

Core use cases:

- search for relevant models
- search for relevant datasets
- inspect model cards
- inspect dataset cards
- download a model snapshot
- download a dataset snapshot or selected split
- pin model or dataset revisions for reproducibility
- prepare local paths for experiment commands
- record provenance for downloaded assets
- warn before large downloads
- handle gated or private repositories through explicit human setup

The skill should not treat model and dataset downloads as invisible side effects. Every downloaded asset should leave a local manifest.

Recommended manifest fields:

- source: `huggingface`
- repo id
- asset type: `model`, `dataset`, or `space`
- revision or commit hash
- selected files or patterns
- local path
- download time
- size when known
- license when known
- gated/private status when known
- requiring workflow or agent
- related experiment run if known

Recommended behavior:

- prefer explicit revision pinning over floating latest downloads
- ask for human confirmation before very large downloads
- ask for human confirmation before using gated or license-sensitive assets
- avoid duplicating the same model or dataset across projects when a shared cache is configured
- still allow project-local copies when reproducibility or isolation matters
- surface missing authentication clearly instead of failing silently
- record enough metadata for later experiment reproduction

The web interface should expose HuggingFace assets in the documents and artifacts library.

Useful web views:

- models
- datasets
- repo cards
- local cache status
- project-linked assets
- assets used by an experiment
- assets used by a workflow
- license or access warnings

Potential CLI shape can be decided later, but likely commands include:

- `opencolab hf search`
- `opencolab hf model download`
- `opencolab hf dataset download`
- `opencolab hf list`
- `opencolab hf show`
- `opencolab hf remove`

These CLI commands are optional for the first version if the skill can operate safely through existing shell tools and manifests. Long term, a first-class CLI is better for reproducibility, UI integration, and approval gates.

## Suggested Release Plan

### v1.1: Web Read-Only Studio

Goal: make the existing lab visible.

Features:

- local web app served by gateway
- projects dashboard
- active project overview
- agent roster
- agent detail read view
- conversation browser
- document/artifact browser
- GPU run viewer
- provider/gateway health page

Non-goals:

- custom workflows
- visual workflow builder
- multi-user web accounts
- replacing Telegram

### v1.2: Web Control

Goal: let the user control the existing runtime from the browser.

Features:

- switch project
- switch agent
- message active agent
- message specific agent
- stop active run
- reset session
- edit curated context files
- configure heartbeat
- inspect provider setup and remediation hints
- inspect Telegram pairing state

### v1.3: Workflow Templates

Goal: introduce repeatable multi-agent execution.

Features:

- local workflow state model
- workflow template definitions
- run predefined workflows
- inspect workflow status
- human approval gates
- connect workflow steps to artifacts
- CLI and web workflow visibility
- first HuggingFace asset visibility in the artifact library, if manifests already exist

### v1.4: Custom Workflow Builder

Goal: let users create their own collaboration patterns.

Features:

- workflow creation UI
- step editor
- agent assignment
- skill assignment
- input/output contracts
- approval gate editor
- workflow history
- reusable custom templates

### v1.5: HuggingFace Model and Dataset Workflows

Goal: let agents prepare external models and datasets for reproducible local or remote experiments.

Features:

- shared `huggingface` skill
- model search and inspection
- dataset search and inspection
- model and dataset download manifests
- revision pinning
- gated/private asset handling
- large-download approval gates
- artifact-library views for models and datasets
- workflow templates that prepare models and datasets before experiments

### v2.0: Autonomous Research Lab

Goal: make OpenColab a complete research execution system.

Features:

- scheduled workflows
- stronger cross-agent orchestration
- project knowledge map
- experiment comparison dashboard
- paper/report publication pipeline
- reusable project memory across related research threads
- richer artifact provenance
- reusable model and dataset asset management

## Open Product Decisions

Questions to resolve before implementation:

- Should the web UI be local-only by default, or should remote access be supported later?
- Should workflow files live under each project or under a shared workflow library?
- Should workflow state be stored in `opencolab.json`, project files, or a dedicated local database?
- What is the minimal artifact index format?
- Should the first web UI allow editing agent files, or only viewing them?
- How should approvals be synchronized between web and Telegram?
- Should the first workflow runner support parallel branches, or only ordered steps?
- Which workflow template should be the flagship demo?
- Should document indexing be automatic, explicit, or both?
- How much provenance is required before an artifact appears in the library?
- Should HuggingFace downloads use a project-local cache, a shared OpenColab cache, or the user's normal HuggingFace cache?
- What download-size threshold should require human approval?
- How should gated HuggingFace repositories and license confirmations be represented in workflow approvals?
- Should OpenColab provide first-class `opencolab hf ...` commands in the same release as the shared skill?
- Should model and dataset cleanup be manual only, or should OpenColab track unused assets and suggest cleanup?
- How should revision pinning be enforced when an agent asks for "latest"?

## Success Criteria

The next phase succeeds when a user can:

- open a browser and understand the state of the whole lab in under one minute
- inspect any project, agent, conversation, document, or experiment without searching the filesystem manually
- start and stop agent work from the web interface
- see what each agent is responsible for
- track research outputs and evidence over time
- run a predefined multi-agent workflow with clear human approval gates
- customize the way agents collaborate without editing prompt files manually
- download and reuse HuggingFace models or datasets with clear provenance and reproducible revision metadata
