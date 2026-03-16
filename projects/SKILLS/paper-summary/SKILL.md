---
name: paper-summary
description: Deterministic PDF-to-markdown paper summarization for papercli workflows. Given one paper PDF or a directory of paper PDFs, produce schema-conformant markdown summaries and optionally update summarized_ids.txt.
homepage: https://github.com/jimezsa/papercli
metadata:
  {
    "openclaw":
      {
        "emoji": "📄",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# Paper Summary Skill

Use this skill when PDFs have already been downloaded and the next step is to create deterministic `research/pdf/<safe_id>.md` summaries from those PDFs.

This skill is the canonical summary step for:
- `SKILLS/fast-search/SKILL.md`
- `SKILLS/pro-search/SKILL.md`
- `SKILLS/deep-search/SKILL.md`

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/paper-summary/SKILL.md \
  -o SKILLS/paper-summary/SKILL.md
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/paper-summary/references/summary_schema.md \
  -o SKILLS/paper-summary/references/summary_schema.md
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  -o SKILLS/paper-summary/scripts/gemini_parallel_summary.py
```

## Mission

Given one paper PDF or a directory of paper PDFs:
1. Read the PDFs directly with Gemini.
2. Produce one markdown summary per paper that follows the canonical schema in `references/summary_schema.md`.
3. Write each summary as `<safe_id>.md`, next to `<safe_id>.pdf`, unless an explicit output directory is provided.
4. Optionally append original paper IDs to `research/meta/summarized_ids.txt`.

## Prerequisites

- `python3` is installed and available in `PATH`.
- `google-genai` is installed: `python3 -m pip install google-genai`
- `GEMINI_API_KEY` is set in the environment.
- Network access is available when running the Gemini script.
- The PDFs already exist locally.
- Optional metadata JSON files exist in `research/meta/<safe_id>.json`.

## Required Inputs

- A single PDF via `--pdf`, or a directory of PDFs via `--pdf-dir`.
- Optional `--metadata-dir` so the script can recover original paper IDs and metadata fallbacks.
- Optional `--summarized-ids` file to append successful original paper IDs.
- Optional `--failures-tsv` file to record summary failures in the same ledger used by the search skills.

## Hard Requirements

- Use the canonical schema from `references/summary_schema.md` unchanged.
- Output markdown only. Do not wrap the summary in code fences.
- Keep figures, tables, equations, captions, and page anchors as first-class evidence.
- Use metadata only as fallback and label it clearly.
- If evidence is missing, preserve the required missing-evidence labels instead of guessing.
- Do not silently skip failures. Either rerun the paper or record the failure upstream.

## Workflow

### 1. Confirm local inputs

- Verify the target PDF exists.
- When possible, keep PDF names aligned with the `safe_id` convention already used by the search skills.
- If metadata exists, keep the matching JSON at `research/meta/<safe_id>.json`.

### 2. Run the Gemini batch summarizer

Single paper:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf research/pdf/<safe_id>.pdf \
  --metadata-dir research/meta \
  --summarized-ids research/meta/summarized_ids.txt \
  --failures-tsv research/meta/failures.tsv
```

Batch mode:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf-dir research/pdf \
  --metadata-dir research/meta \
  --summarized-ids research/meta/summarized_ids.txt \
  --failures-tsv research/meta/failures.tsv \
  --concurrency 4
```

Useful flags:
- `--model <name>`: override the default Gemini model.
- `--output-dir <dir>`: write summaries somewhere other than next to the PDFs.
- `--overwrite`: regenerate existing `.md` summaries.
- `--concurrency <n>`: lower this if the API starts rate limiting.

### 3. Review outputs

- Each successful run should create `research/pdf/<safe_id>.md`.
- Check that the output preserves the canonical headings and evidence anchors.
- If a paper failed, inspect stderr, then rerun just that paper or keep the failure recorded in `research/meta/failures.tsv`.

## Output Contract

- One markdown summary per processed PDF.
- Each summary follows the canonical schema in `references/summary_schema.md`.
- Successful runs may append the original paper ID to `research/meta/summarized_ids.txt` when metadata is available.

## Canonical Assets

- Summary schema: `SKILLS/paper-summary/references/summary_schema.md`
- Batch summarizer: `SKILLS/paper-summary/scripts/gemini_parallel_summary.py`
