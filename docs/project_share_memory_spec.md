# OpenColab Project Shared Context Plan

## 1. Status

This document is a planning note for a narrow first implementation of project-shared context in OpenColab.

It is intentionally smaller than the broader shared-memory ideas discussed elsewhere.
This file is not yet the normative runtime contract until the design is promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Problem

OpenColab already supports multiple agents inside one project, but each agent mainly sees:

- its own startup docs
- its own durable memory
- its own recent session memory

That is not enough for a multi-agent project where every agent should share the same understanding of:

- the project goal
- the humans involved
- the active agents involved
- each participant's role and responsibilities
- current scope and constraints

The missing piece is not a large shared-memory system.
The missing piece is one canonical project-level context file that every agent can read.

## 3. Design Direction

The first implementation should use one shared project file:

- `projects/<project_id>/PROJECT-AND-TEAM.md`

This file should be treated as curated shared project context, not as transcript storage, scratchpad memory, or a second conversation log.

## 4. Goals

This v1 design should:

- give every agent access to the same project goal and team context
- keep the design simple and legible
- avoid prompt bloat
- preserve the existing agent-local memory model
- make ownership of shared context explicit
- support future multi-agent coordination without overbuilding memory infrastructure

## 5. Non-Goals

This v1 design should not attempt to introduce:

- shared daily notes
- shared transcript summaries
- shared scratchpads
- automatic cross-agent memory merging
- free-for-all writes by every agent
- replacement of agent-local `MEMORY.md`

## 6. File Model

### 6.1 Shared Project File

Each project should have:

- `projects/<project_id>/PROJECT-AND-TEAM.md`

This file should be seeded automatically when a project is created or first initialized.

### 6.2 Existing Agent Files Remain

Each agent should continue to keep:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `ALMA.md`
- `TOOLS.md`
- `USER.md`
- `TODO.md`
- `MEMORY.md`
- `memory/Session/`
- `memory/Daily/`

No new shared memory directory is needed in v1.

## 7. Content Responsibilities

`PROJECT-AND-TEAM.md` should hold concise project-level context such as:

- project goal
- scope
- constraints
- current direction
- key decisions
- important shared preferences relevant to the whole project
- humans participating in the project
- agents participating in the project
- each agent's role, specialty, and expected function

`PROJECT-AND-TEAM.md` should not hold:

- secrets
- raw session transcripts
- large reasoning dumps
- temporary scratch notes
- per-agent private facts better stored in `MEMORY.md`

## 8. Ownership Model

The file should stay curated.

Recommended ownership:

- professor is the default curator of `PROJECT-AND-TEAM.md`
- specialist agents may suggest edits or request updates
- the file should not become a free-for-all shared notebook

This keeps the shared project view stable and avoids conflicting edits from several agents.

## 9. Prompt Construction Rules

The shared file should be loaded into prompt assembly for every agent.

The prompt order should be:

1. `AGENTS.md`
2. `IDENTITY.md`
3. `ALMA.md`
4. `TOOLS.md`
5. `USER.md`
6. `TODO.md`
7. `PROJECT-AND-TEAM.md`
8. `MEMORY.md`
9. recent session memory and the current inbound message

Rationale:

- the current agent operating contract should still lead
- project-shared context should be available before private durable memory is applied
- `PROJECT-AND-TEAM.md` is shared context, not memory
- `MEMORY.md` should remain the agent's private durable layer

`BOOTSTRAP.md` should continue to stay out of the normal prompt payload after seeding rules are handled, consistent with current behavior.

## 10. Initialization Plan

The runtime should ensure `PROJECT-AND-TEAM.md` exists when:

- the default project is initialized
- a new project is created

The file should be seeded from a built-in template, similar to how agent files are seeded today.

The template should provide a compact, operator-editable structure instead of long prose.

## 11. Agent Instruction Updates

Seeded agent instructions should be updated so that all agents understand:

- `PROJECT-AND-TEAM.md` exists at project scope
- all agents may read it
- it is the canonical shared project context file
- professor is the default curator
- agent-local `MEMORY.md` remains private durable memory

This should be reflected in the built-in agent templates, not handled as ad hoc prompt text only.

## 12. Runtime and Implementation Scope

The first implementation should cover only:

- seeding `PROJECT-AND-TEAM.md`
- loading it into prompt construction
- documenting ownership and usage rules
- preserving the current agent-local memory model

The first implementation should explicitly avoid:

- new state schema fields unless they are clearly necessary
- a new shared-memory persistence subsystem
- automatic shared-memory summarization jobs

## 13. Testing Scope

Tests should verify:

- project initialization creates `PROJECT-AND-TEAM.md`
- creating a new project creates `PROJECT-AND-TEAM.md`
- prompt assembly includes `PROJECT-AND-TEAM.md`
- prompt assembly preserves the agreed ordering
- agent-local `MEMORY.md` remains distinct from shared project context

## 14. Rollout Sequence

Recommended rollout order:

1. update `docs/spec.md` with the new shared project context contract
2. sync `README.md` and `AGENTS.md`
3. add the built-in template for `PROJECT-AND-TEAM.md`
4. update runtime initialization to seed the file
5. update prompt assembly to inject the file in the agreed order
6. add tests

## 15. Summary

The right first step is not a full shared-memory system.
The right first step is one curated shared project context file:

- `PROJECT-AND-TEAM.md`

That gives every agent a common understanding of the project and team while keeping OpenColab's existing agent-local memory model simple, private, and intact.
