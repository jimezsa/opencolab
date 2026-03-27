# OpenColab Professor-Led Agent Creation Plan

## 1. Status

This document is a planning note for professor-led specialist creation in OpenColab.

It is intentionally focused on the creation workflow, approval boundary, and shared project coordination model.
It is not yet normative runtime contract until promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Purpose

OpenColab already supports multiple agents per project, but it needs a clearer operating model for how new specialists are created during real project work.

The intended model is:

- `professor` is the lead coordinator
- `professor` can detect when a new specialist is justified
- `professor` knows how to create a new agent through the OpenColab CLI
- the human remains in the loop for approval and operator-only setup

This keeps the lab coherent while still letting the lead agent expand the team when the project truly needs it.

## 3. Core Principle

The system should behave like a real lab:

- `professor` leads hiring decisions
- specialists own scoped workstreams once hired
- the human approves staffing and helps with setup when needed

Important distinction:

- `professor` may decide that a new specialist is needed
- `professor` must not silently spawn specialists without human approval

## 4. Goals

This design should:

- make `professor` the canonical agent-creation authority inside a project
- let `professor` hire specialists for durable workstreams such as research, coding, experiments, or writing
- make the OpenColab CLI the explicit creation mechanism
- keep the human in control of approval, runtime choice, and secret-bound setup
- keep the project roster synchronized through `PROJECT-AND-TEAM.md`

## 5. Non-Goals

This design should not attempt to support:

- unrestricted autonomous agent spawning
- specialist-created specialist chains by default
- secret entry through conversational messages
- BotFather automation
- creation of a new long-lived PhD agent for every one-off task

## 6. When Professor Should Create A Specialist

`professor` should consider a new specialist when:

- the human explicitly asks for one
- a durable expertise gap appears repeatedly
- the project benefits from stable ownership of one workstream
- the work is substantial enough that keeping the role persistent is useful across sessions

Examples:

- literature review or source verification specialist
- coding or debugging specialist
- experiments or GPU-run specialist
- writing or synthesis specialist

`professor` should not create a specialist when:

- the task is short-lived and can be handled directly
- the work does not justify persistent ownership
- the request is really just a one-time delegation, not a stable role

## 7. Authority Model

Recommended default policy:

- only `professor` may initiate specialist creation by default
- specialist agents should not create other specialists unless a future policy explicitly allows it
- the human must approve creation before the CLI action is executed

This prevents recursive delegation trees and keeps ownership clear.

## 8. Required Professor Capability

`professor` should explicitly know that OpenColab agent creation happens through the CLI.

At minimum, `professor` should know and be able to reference:

- `opencolab agent create --agent-id <id>`
- `opencolab agent use --agent-id <id>`

When relevant, `professor` should also know the follow-up setup path:

- `opencolab setup model --agent-id <id> ...`

If the runtime allows `professor` to execute local CLI commands, then after human approval it may run the command itself.
If the runtime does not allow that directly, `professor` should still instruct the human with the exact command and the intended agent id.

## 9. Human-In-The-Loop Policy

The human should remain responsible for:

- approving the creation
- adjusting the proposed specialty or scope if needed
- confirming provider/runtime/model choices when needed
- handling any operator-only secrets or token setup
- deciding whether the new agent should also receive a Telegram bot identity later

The human should not need to design the agent from scratch if `professor` already has a strong recommendation.

## 10. Professor Proposal Format

Before creation, `professor` should produce a concise proposal that includes:

- proposed agent id
- specialty or role
- why the new agent is justified
- expected outputs or ownership area
- whether the role is temporary or persistent
- suggested provider/runtime/model if relevant

Example shape:

- agent id: `research-phd`
- role: literature and source verification specialist
- why: sustained need for source triage and claim checking
- outputs: paper selection, source summaries, citation checks
- persistence: persistent for this project

## 11. Creation Workflow

The recommended workflow is:

1. `professor` detects a durable specialization gap.
2. `professor` proposes the new agent to the human.
3. The human approves, rejects, or edits the proposal.
4. After approval, `professor` creates the agent through the OpenColab CLI or instructs the human to do so with the exact command.
5. The human helps complete any provider/runtime/auth setup that cannot be inferred safely.
6. `professor` integrates the new specialist into the project plan.
7. `professor` updates `PROJECT-AND-TEAM.md`.

## 12. Project Context Update Requirement

After a specialist is created, `professor` should update `PROJECT-AND-TEAM.md` so the project roster stays canonical.

At minimum, the update should capture:

- the new agent id
- the new agent's role
- the new agent's main contribution area
- any important ownership boundary with other agents
- the current status of the agent, if not fully configured yet

This keeps every agent aligned on who exists and what each agent is supposed to do.

## 13. Agent Lifecycle States

The design should treat specialist creation as a small lifecycle, not a one-shot event.

Suggested states:

- proposed
- approved
- created
- configured
- active
- paused
- archived

This can remain conceptual in v1, but `professor` should reason as if these states exist.

## 14. Coding vs Research Specialists

Two especially important creation cases are:

- research specialists
- coding specialists

Research specialist expectations:

- source search
- source filtering
- evidence extraction
- grounded follow-up analysis

Coding specialist expectations:

- implementation ownership
- bug fixing
- test updates
- integration support

`professor` should be able to justify which type is needed and what workstream it will own.

## 15. Telegram Boundary

Agent creation and Telegram bot creation must remain separate concepts.

Allowed:

- create a new OpenColab agent identity
- configure the agent for internal project use

Not automatic:

- create a Telegram bot through BotFather
- bind a bot token through ordinary chat

If a Telegram bot identity is desired later, that should remain a human/operator-managed step.

## 16. Safety Rules

The design should enforce these rules:

- no silent specialist creation without approval
- no secret handling through normal conversation
- no uncontrolled specialist spawning chains
- no creation of persistent agents for trivial one-off tasks
- no automatic rewriting of project roster without updating `PROJECT-AND-TEAM.md`

## 17. Template And Prompt Implications

The `professor` contract should eventually state explicitly that:

- specialist creation is part of the professor role
- the OpenColab CLI is the canonical creation path
- the human must approve creation first
- `PROJECT-AND-TEAM.md` must be updated after creation

Specialist templates should eventually state that:

- they do not create more specialists by default
- they operate under the project roster maintained by `professor`

## 18. Summary

The right model is not unrestricted autonomous spawning.
The right model is professor-led hiring with human approval.

In practice that means:

- `professor` knows how to create agents through the OpenColab CLI
- `professor` proposes new specialists when a durable gap appears
- the human approves and helps with setup
- `professor` updates `PROJECT-AND-TEAM.md`

That gives OpenColab a believable multi-agent lab workflow without losing operator control.
