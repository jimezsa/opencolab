# OpenColab Autoresearch Specialist Plan

## 1. Decision

Integrate `karpathy/autoresearch` as a professor-created specialist, not as a new OpenColab runtime primitive.

V1 should work like this:

- `professor` proposes and creates one dedicated `autoresearch` specialist
- the specialist uses one shared skill stored at `projects/SKILLS/autoresearch/SKILL.md`
- that skill is restricted so only the designated `autoresearch` specialist sees or uses it by default
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

## 3. Restricted Skill Visibility

The skill must live under `projects/SKILLS/` for maintainability, but it should not behave like a normal globally advertised shared skill.

Minimal rule:

- the skill declares `allowed_agent_ids`
- the runtime shows the skill only to the listed specialist by default
- another agent may use it only if the human or professor explicitly opts that agent in later

This keeps the storage shared while keeping normal agent prompts clean.

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

## 5. Deferred Work

These can wait until after the first repo works end to end:

- a generic shared-skill visibility system beyond this one restricted skill
- broader support for multiple target repos or profiles per specialist
- unattended overnight looping as a first-class mode
- promotion from specialist-only workflow to a generally advertised built-in capability
