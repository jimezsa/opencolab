# OpenColab Autoresearch Specialist Plan

## 1. Status

This document is a planning note for integrating [karpathy/autoresearch](https://github.com/karpathy/autoresearch) into OpenColab.

It is intentionally non-normative for now.
It captures the minimal integration shape before any spec, README, template, or runtime updates are made.

## 2. Goal

Integrate `autoresearch` as a professor-created experiment specialist that can run iterative training experiments on a narrow, repo-specific contract.

This integration should:

- reuse OpenColab's existing professor-to-specialist workflow
- avoid turning `autoresearch` into a new core OpenColab backend
- keep the experiment logic narrow and reviewable
- avoid overwhelming unrelated agents with `autoresearch` instructions

## 3. Core Recommendation

The right v1 is:

- `professor` proposes and creates an `autoresearch` specialist
- the specialist uses one dedicated shared skill stored under `projects/SKILLS/`
- that shared skill is restricted so only the intended `autoresearch` specialist sees or uses it by default
- the specialist runs inside one configured experiment repo with one configured editable file and one configured launch command

This should not be implemented as a new OpenColab runtime primitive in v1.

## 4. Constraints For This Integration

The integration must satisfy these constraints:

- the skill must live under `projects/SKILLS/`
- the skill must be specialist-only in normal use, not something every agent sees or gets nudged toward
- the professor must define how the training entrypoint is called
- the edited file must be configurable and must not assume the file is literally named `train.py`
- the repo path must be configurable and explicit

In other words, the workflow should preserve the spirit of upstream `autoresearch`, but should not hardcode upstream file names or commands.

## 5. Why This Fits OpenColab

This maps cleanly onto the current OpenColab operating model:

- `professor` already owns durable specialist creation after human approval
- OpenColab already supports shared skills and agent-local specialization
- OpenColab already separates reasoning from remote GPU execution

The main mismatch is visibility and scope:

- today, skills under `projects/SKILLS/` are effectively shared
- this workflow should live in that folder for maintainability
- but it should not be advertised to unrelated agents

Therefore the minimal integration needs a small visibility model for shared skills.

## 6. Proposed Specialist Shape

Recommended agent shape:

- agent id: `autoresearch`
- role: experiment specialist for iterative model-training runs
- ownership: one experiment repo, one configured experiment loop, and experiment summaries back to `professor`
- persistence: persistent while the project expects repeated training experiments

The professor should remain responsible for deciding when this specialist is justified and for recording the role in `PROJECT-AND-TEAM.md`.

## 7. Shared Skill With Restricted Visibility

The skill should live here:

- `projects/SKILLS/autoresearch/SKILL.md`

But the skill should not be treated like a normal globally-advertised shared skill.

### Proposed rule

Shared skills should support optional visibility metadata such as:

- `scope: restricted`
- `allowed_agent_ids: autoresearch`

The runtime should use that metadata to:

- omit the skill from the default shared-skill list shown to unrelated agents
- keep the skill available to the allowed specialist
- allow human or professor override later if another agent is explicitly opted in

This is the minimal way to satisfy both requirements:

- storage location stays in `projects/SKILLS/`
- normal agent prompts do not get cluttered with `autoresearch`

## 8. Professor Responsibilities

The professor should do more than just create the specialist.
The professor should also define the experiment contract for the target repo.

At minimum, the professor or human operator should provide:

- `repo_path`: local path to the experiment repo
- `editable_file_path`: the only file the specialist is allowed to modify
- `run_command`: the command that launches one experiment run
- `metric_name`: the primary metric to optimize
- `metric_direction`: lower-is-better or higher-is-better
- `results_file`: path to the results table or log index
- `branch_prefix`: disposable experiment branch prefix
- `crash_detection_rule`: how a failed run is recognized
- `metric_extraction_rule`: how the main metric is read from logs

Important:

- do not assume the file is named `train.py`
- do not assume the run command is `uv run train.py`

Those are upstream defaults, not OpenColab requirements.

## 9. Specialist Operating Contract

Once configured, the `autoresearch` specialist should follow a narrow contract:

1. work only inside the configured repo
2. edit only the configured editable file
3. launch runs only with the configured experiment command
4. evaluate success only through the configured metric rule
5. log outcomes to the configured results file
6. use a dedicated disposable experiment branch or worktree
7. summarize progress back to `professor` in compact form

The skill should explicitly preserve upstream-style discipline:

- one narrow editable surface
- one bounded experiment at a time
- keep/discard logic based on metric change
- simple, reviewable diffs

## 10. Git Safety Boundary

Upstream `autoresearch` assumes that discarded experiments can be rewound on a dedicated branch.

OpenColab normally tells specialists to ask before destructive actions.
To make this integration workable, the skill should define a narrow exception:

- branch rewinds and discard operations are pre-approved only inside the dedicated `autoresearch` experiment branch or worktree
- this exception does not apply outside the configured experiment repo and branch/worktree

This keeps the destructive boundary explicit and local.

## 11. Execution Model

This integration should reuse existing execution paths:

- local GPU when the experiment repo runs locally
- the existing Runpod workflow when remote GPU execution is needed

This plan does not require a new experiment runner backend.

The specialist should treat remote GPU work as an execution detail, not as a new research-runtime model.

## 12. Timeout And Autonomy Boundary

Upstream `autoresearch` is designed for a long autonomous loop.
OpenColab provider executions are time-bounded.

Therefore v1 should be batch-oriented:

- run a bounded experiment window
- return a summary
- resume cleanly on the next turn if needed

Only after that works well should OpenColab consider a more persistent unattended mode for this specialist.

## 13. Artifact Ownership

The experiment repo should keep its own native artifacts, such as:

- run logs
- result tables
- branch history
- experiment notes tied to that repo

OpenColab should mainly own:

- specialist staffing
- routing
- live status
- summaries back to `professor`
- shared project coordination through `PROJECT-AND-TEAM.md`

## 14. Non-Goals

This plan does not try to support:

- a new generic OpenColab experiment backend
- a new agent type beyond the existing specialist model
- a globally advertised `autoresearch` skill for every agent
- automatic support for arbitrary external repo paths with no explicit configuration
- hardcoded assumptions that every target repo uses `train.py`
- hardcoded assumptions that every target repo uses `uv run train.py`
- indefinite unattended overnight execution in v1

## 15. Minimal Rollout Plan

1. Add this as a professor-created specialist, not as a core runtime feature.
2. Add one restricted shared skill under `projects/SKILLS/autoresearch/`.
3. Add optional shared-skill visibility metadata so unrelated agents do not see this skill by default.
4. Define the specialist's repo-specific contract through explicit parameters:
   - repo path
   - editable file path
   - run command
   - metric extraction and crash detection rules
5. Require a dedicated experiment branch or worktree for keep/discard iteration.
6. Reuse local GPU or the existing Runpod path for compute.
7. Start with bounded batches, not an unbounded autonomous overnight loop.
8. Validate on one repo first before considering broader generalization.

## 16. Expected Outcome

If this plan works, OpenColab gains a clean way for `professor` to staff an experiment-running specialist that uses `autoresearch`-style iteration without polluting the rest of the lab with a highly specialized workflow.
