# Experiment Tables

Use LaTeX tables when the user provides experiment results, benchmark metrics,
ablation runs, or training/evaluation logs.

## Inputs

The table helper supports:

- CSV files with a header row
- JSON arrays of objects
- JSON objects with a `rows` array
- markdown pipe tables
- simple metric logs with `key=value` pairs

## Table Types

| Table | Typical columns |
| --- | --- |
| Main results | method, dataset, metric columns, rank |
| Ablation | variant, changed component, metrics, delta |
| Runtime or cost | method, hardware, latency, memory, cost |
| Dataset comparison | dataset, split, size, metric |
| Training curve summary | run, best epoch, final metric, notes |

## Formatting Rules

- Keep method names readable; do not over-abbreviate.
- Round numeric metrics consistently.
- Use `--columns` to control column order for final tables.
- Put long notes in the caption or surrounding text instead of widening the
  table too much.
- Use `\input{tables/<name>}` from `main.tex` so generated tables stay
  reusable.

## Example

```bash
python3 projects/SKILLS/latex-paper-writer/scripts/make_results_table.py \
  --input research/results.csv \
  --output tables/results.tex \
  --columns method,dataset,accuracy,f1,latency_ms \
  --caption "Main benchmark results." \
  --label tab:main-results
```

