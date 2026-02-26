# OpenColab v1 Specification

**Status:** Draft v4
**Date:** February 26, 2026
**Audience:** Researchers

## 1. Purpose

OpenColab is a personal multi-agent AI research lab designed to help researchers and accelerate scientific discoveries.

The operating metaphor is academic:

- one **Professor agent** guides strategy and quality
- multiple **Student agents** execute experiments and analysis
- a **Human researcher** supervises critical decisions and can intervene at any time

## 2. Product Vision in Practice

OpenColab should feel like running a small research group on one machine:

- Professor and Students discuss goals, plans, and results
- Students can work in parallel and specialize by task
- regular check-ins keep work synchronized
- human oversight remains first-class, not an afterthought

## 3. v1 Goals

- Accelerate research throughput with parallel AI agents.
- Support Professor-led decomposition and Student execution.
- Enable structured communication: group chat, private chat, and meeting logs.
- Provide human access to team communication over Telegram.
- Support GitHub repository topologies for research execution:
  - per-agent repositories for independent exploration
  - shared repositories where multiple agents collaborate
- Keep human-in-the-loop checkpoints for approvals and redirections.
- Provide practical execution access for Students:
  - local compute
  - SSH-accessible remote compute
  - Google Colab sessions (adapter-based)
- Enable scientific paper authoring in LaTeX with agent and human coauthoring.
- Preserve all runs, discussions, artifacts, and decisions locally.

## 4. Non-Goals (v1)

- Full autonomous operation without human checkpoints.
- Large-scale distributed infrastructure (Kubernetes, queues, worker fleets).
- Multi-tenant SaaS accounts and team permission models.
- Automatic end-to-end literature map generation (deferred).
- Fully general desktop automation beyond bounded task tools.

## 5. Core Roles

### 5.1 Human Researcher

- Defines project goals and constraints.
- Approves major plan revisions and run conclusions.
- Can join discussions, answer questions, and redirect work.
- Can inspect all chat channels and run artifacts.
- Can interact with the team through Telegram.

### 5.2 Professor Agent

- Translates goal into research plan and milestones.
- Assigns and reassigns Student tasks.
- Runs regular progress meetings.
- Synthesizes conflicting results and proposes next steps.
- Escalates key questions to the Human researcher.
- Cannot suppress evidence-based disagreement from Students.

### 5.3 Student Agents

- Execute assigned subtasks (experiments, coding, reading, synthesis).
- Report progress, blockers, and evidence.
- Participate in group discussion and private peer discussions.
- Can disagree with the Professor when evidence supports an alternative view.
- Ask Human researcher or Professor for clarification when needed.

## 6. Collaboration Model

### 6.1 Communication Channels

OpenColab must support:

- **Project Group Chat**: all agents + human visibility
- **Private Agent Chats**: one-to-one or small group channels
- **Meeting Threads**: recurring structured check-ins led by Professor
- **Telegram Bridge**: human-accessible team channel with message sync to run logs

All channels are logged with timestamps, participants, and linked artifacts.

Disagreement protocol:

- Students may file a formal challenge to Professor direction with evidence.
- Professor must respond with accept/reject reasoning in the run log.
- Human researcher can arbitrate unresolved disagreements.

### 6.2 Meeting Cadence (v1)

Each run includes three required meeting checkpoints:

1. **Kickoff Meeting**: align on plan and assignments.
2. **Mid-run Review**: inspect early findings, replan if needed.
3. **Final Synthesis Meeting**: summarize results and unresolved risks.

## 7. Capability Scope

### 7.1 Required in v1

- Task planning and delegation.
- Parallel subtask execution.
- Research discussion and meeting orchestration.
- Human approval checkpoints.
- Per-agent and shared GitHub repository workflows.
- LaTeX paper generation and iterative coauthoring with the human researcher.
- Local persistence of prompts, outputs, logs, and chat history.

### 7.2 Execution Environments in v1

Student agents can run tasks using adapters for:

- local machine execution
- SSH remote hosts (for GPU or specialized environments)
- Google Colab session workflows

### 7.3 Tool Access in v1

Student agents may use bounded tools to act like practical researchers:

- browser navigation and web research
- page reading and summarization
- screenshot capture for evidence trails
- code execution in assigned environments
- Git operations on assigned repositories
- LaTeX editing and build tooling for paper drafts

## 8. AI Research Workflow

### 8.1 Standard Run Lifecycle

1. Human submits goal and constraints.
2. Professor creates plan and Student assignments.
3. Kickoff Meeting confirms scope and timeline.
4. Students execute in parallel with periodic updates.
5. Mid-run Review adjusts priorities and methods.
6. Students deliver artifacts and summaries.
7. Final Synthesis Meeting produces final report.
8. Human approves closure or requests another iteration.

### 8.2 Paper Workflows (v1)

Agents must be able to:

- search for AI research papers
- read and extract key claims, methods, and results
- compare papers and identify agreement/conflict
- produce concise summaries linked to source evidence
- draft and revise scientific papers in LaTeX
- support human coauthor edits and feedback cycles

### 8.3 Repository Collaboration Workflows (v1)

Agents must be able to:

- operate in their own dedicated repositories
- contribute to one or more shared repositories used by multiple agents
- open and update branches/commits for transparent collaboration history
- surface repository activity to the human researcher for review

## 9. Deferred Capabilities (v2+)

- automatic mental-map generation from paper corpora
- citation graph mining and interactive concept maps
- fully autonomous long-horizon project loops
- benchmark-driven automatic agent specialization

## 10. System Architecture (v1)

### 10.1 Control Plane

One local Node.js TypeScript process handles:

- orchestration
- agent runtime adapters
- persistence
- local API
- local web interface
- CLI

### 10.2 Data Model

SQLite stores:

- projects
- agent templates
- agent instances
- runs
- tasks
- chats (group/private)
- meetings
- events
- approvals
- telegram_threads
- repositories
- paper_drafts

Filesystem stores:

- prompts
- outputs
- logs
- artifacts
- screenshots
- meeting summaries
- repository snapshots and patches
- LaTeX manuscript sources and build outputs

### 10.3 Suggested Repository Layout

```txt
opencolab/
  src/
    adapters/
    orchestration/
    collaboration/
    web/
  docs/
    spec.md
    VISION.md
  projects/
    <project_name>/
      memory.md
      repos/
        shared/
          <repo_name>/
        agents/
          <agent_id>/
            <repo_name>/
      papers/
        <paper_id>/
          latex/
          builds/
      runs/
        <run_id>/
          prompts/
          outputs/
          logs/
          artifacts/
          screenshots/
          chats/
          meetings/
  opencolab.db
```

## 11. Reliability and Safety Requirements

- Human approval required at run checkpoints.
- Every task execution has timeout and retry limits.
- Restart-safe run state from SQLite.
- Immutable event and chat logs for auditability.
- Secrets only through environment variables.
- Explicit workspace boundaries per agent instance.

## 12. Control Surfaces

### 12.1 CLI (Required)

- `opencolab init`
- `opencolab project create <name>`
- `opencolab agent template add`
- `opencolab agent instance add`
- `opencolab run start --project <name> --goal "<text>"`
- `opencolab run status <run_id>`
- `opencolab run approve <run_id>`
- `opencolab run pause <run_id>`
- `opencolab run stop <run_id>`
- `opencolab chat list <run_id>`
- `opencolab chat view <chat_id>`
- `opencolab meeting list <run_id>`

### 12.2 Local Web Interface (Required)

- manage agents and runtimes
- monitor runs/tasks
- inspect chats and meetings
- review screenshots and artifacts
- approve/pause/stop runs

### 12.3 Telegram Interface (Required for Human Access)

- human can read team updates and agent discussions
- human can send instructions/questions to Professor and Students
- messages are linked to run and meeting records for traceability

## 13. Acceptance Criteria for v1

- At least 1 Professor and 3 Student agents can collaborate in one run.
- Group chat and private chat both function with persisted logs.
- Three meeting checkpoints are created and recorded per run.
- Student tasks can run across local and at least one remote runtime (SSH or Colab adapter).
- Each Student can use at least one dedicated GitHub repository.
- Multiple agents can collaborate in at least one shared repository.
- Human can view all run artifacts, chats, and decisions in CLI and web UI.
- Human can access and communicate with the team through Telegram.
- AI paper search/read/summarize workflow completes with source-linked output.
- Agents can generate a LaTeX paper draft that the human can edit and continue iterating.

## 14. Summary

OpenColab v1 is a practical personal research power tool: a Professor-guided, Student-executed multi-agent lab with structured discussion, real execution environments, and strong human oversight.
