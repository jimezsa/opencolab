---
name: autoresearch
description: Iterative keep/discard experiment workflow over one explicitly configured repo, editable file, run command, and metric rule. Any agent may use it, but the `autoresearch` specialist is the default owner for sustained experiment-loop work.
metadata:
  {
    "opencolab":
      {
        "emoji": "🧪",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# Autoresearch Skill

Use this skill for iterative experiment loops over one explicitly configured repo.

This is a normal shared OpenColab skill. Any agent may use it when it is the right tool, but the built-in `autoresearch` specialist is the default owner for sustained experiment-loop work.

## Required Repo Contract

Do not start the loop until these are explicit:

- `repo_path`: local path to the experiment repo
- `editable_file_path`: the only file you may modify
- `run_command`: the command that launches one experiment run
- `metric_rule`: how to extract the metric and whether higher or lower is better

Optional:

- `results_file`: repo-local results table or summary log
- `branch_prefix`: disposable experiment branch prefix

Default failure rule:

- a run fails when the command exits non-zero or the metric cannot be extracted

Do not assume:

- the editable file is `train.py`
- the run command is `uv run train.py`

Those are upstream examples, not OpenColab requirements.

## Core Rules

- Work only inside the configured repo.
- Edit only the configured editable file unless the human explicitly changes the repo contract.
- Treat the configured metric rule as the source of truth for keep/discard decisions.
- Keep changes narrow and reviewable.
- Run one bounded experiment at a time.
- Keep artifacts in the experiment repo unless the user asks for a different handoff.
- If remote GPU execution is needed, combine this workflow with `projects/SKILLS/runpod-job/SKILL.md`.

## Git Safety Boundary

Use a dedicated disposable branch or worktree for this loop.

Inside that dedicated experiment branch or worktree:

- keep or discard decisions may use branch rewinds
- discard operations are pre-approved for this workflow

Outside that dedicated experiment branch or worktree:

- normal OpenColab safety rules still apply
- do not perform destructive git actions without approval

## Minimal Loop

1. Confirm the repo contract.
2. Enter the configured repo and inspect the current baseline.
3. Ensure you are working in the dedicated disposable experiment branch or worktree.
4. Make one narrow change in the configured editable file.
5. Run the configured experiment command.
6. Extract the metric using the configured metric rule.
7. Decide keep or discard.
8. Record the outcome in the configured results file when one exists.
9. Summarize the result and next useful step.

## Keep Or Discard Rules

Prefer simple decision logic:

- keep the change when the metric improves under the configured direction rule
- discard the change when the run fails or the metric regresses
- if the result is ambiguous, say so plainly and propose the smallest useful next experiment

Do not overfit the loop with hidden heuristics.

## Bounded Execution

Default to bounded batches, not indefinite unattended looping.

If the user wants longer-running work:

- say clearly how many iterations or how much time you intend to spend
- keep summaries concise
- resume in another turn when needed instead of pretending the loop is unbounded

## Suggested Repo Contract Shape

Use a compact shape like this in planning notes, `PROJECT-AND-TEAM.md`, or the specialist's local files:

```yaml
repo_path: research/autoresearch-demo
editable_file_path: train_gpt2.py
run_command: uv run python train_gpt2.py --eval-only
metric_rule:
  source: stdout
  pattern: "val_bpb=([0-9.]+)"
  direction: lower_is_better
results_file: results.tsv
branch_prefix: autoresearch
```

## Reporting Back

When you report results, include:

- repo and editable file used
- command run
- extracted metric or failure condition
- keep or discard decision
- short rationale
- recommended next action

If this is sustained experiment-loop work, route ownership back to the `autoresearch` specialist when available.

## Progress Graph

When the repo contract includes a `results_file`, you may generate a progress plot with the bundled helper:

```bash
python3 projects/SKILLS/autoresearch/scripts/plot_progress.py \
  --results results.tsv \
  --metric-column val_bpb \
  --direction lower \
  --metric-label "Validation BPB" \
  --output progress.png
```

Use the metric named by the repo's `metric_rule`. Set `--direction lower` or `--direction higher` to match the keep/discard rule. The input must be a delimited table with a header; the default columns are `status` and `description`, and the default output is `progress.png`.

The plot shows experiment number on the x-axis, the key metric on the y-axis, green kept experiments with shortened descriptions, gray discarded or otherwise non-kept experiments, and a running-best line. It focuses the y-axis from the baseline to the best kept metric by default; pass `--include-all-y` when outliers or regressions should remain visible. The helper requires `matplotlib`; install it in the experiment environment with `python3 -m pip install matplotlib` if needed.
