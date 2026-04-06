# OpenColab Autoresearch Specialist Plan

## 1. Decision

Integrate `karpathy/autoresearch` as a professor-created specialist, not as a new OpenColab runtime primitive.

V1 should work like this:

- `professor` proposes and creates one dedicated `autoresearch` specialist
- the specialist uses one shared skill stored at `projects/SKILLS/autoresearch/SKILL.md`
- that skill is available to every agent like the other shared skills
- the designated `autoresearch` specialist owns sustained experiment-loop work by default
- the seeded `autoresearch` specialist should be explicitly oriented around this role in its agent files
- the specialist operates against one explicitly configured experiment repo
- the specialist must not assume the editable file is named `train.py`
- the specialist must not assume the experiment command is `uv run train.py`

## 2. Required Repo Config

The professor or human operator must define the repo contract for the specialist.

Required:

- `repo_path`: local path to the experiment repo
- `editable_file_path`: the only file the specialist may modify
- `run_command`: the command that launches one experiment run
- `metric_rule`: how success is measured, including extraction and whether higher or lower is better

Optional:

- `results_file`: path to a repo-local results table or summary log
- `branch_prefix`: disposable experiment branch prefix

Default failure rule:

- a run is failed when the command exits non-zero or the metric cannot be extracted

## 3. Shared Skill And Specialist Ownership

The skill should behave like a normal shared OpenColab skill.

Rule:

- the skill lives under `projects/SKILLS/`
- any agent may use it when it is the right tool
- the `autoresearch` specialist is the default owner for repeated experiment-loop work
- `professor` may still use the skill directly when needed, just as `professor` may use other shared skills directly
- the seeded `autoresearch` specialist should state that iterative experiment execution through the shared `autoresearch` skill is its primary responsibility

This keeps implementation simple while preserving role clarity.

## 4. Runtime Contract

The `autoresearch` specialist should operate under a narrow contract:

- work only inside the configured repo
- edit only the configured editable file
- launch runs only with the configured command
- evaluate runs only through the configured metric rule
- use a dedicated disposable experiment branch or worktree

Git safety boundary:

- keep/discard rewinds are pre-approved only inside the configured experiment branch or worktree
- that exception does not apply outside the configured repo and branch/worktree

Execution boundary:

- v1 should run in bounded batches, not as an indefinite unattended loop
- compute may be local or use the existing Runpod workflow
- experiment artifacts stay in the experiment repo
- OpenColab owns staffing, routing, live status, and summaries back to `professor`
- the `autoresearch` specialist should be the default agent the professor creates when the project needs stable ownership of this workflow

## 5. Deferred Work

These can wait until after the first repo works end to end:

- broader support for multiple target repos or profiles per specialist
- unattended overnight looping as a first-class mode
