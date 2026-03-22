---
name: pageindex-grounded
description: Local-first grounded follow-up QA over already-downloaded papers. Build and cache per-paper PageIndex trees, keep paper selection bounded, and answer with exact paper or page references when the evidence supports it.
homepage: https://github.com/VectifyAI/PageIndex
metadata:
  {
    "opencolab":
      {
        "emoji": "📚",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# PageIndex Grounded Skill

Use this skill when the user needs precise, grounded follow-up answers from papers that already exist locally under the current project.

Typical use cases:

- exact claim verification from one downloaded paper
- "where does this paper say X?" questions
- page-level follow-up after `fast-search`, `pro-search`, or `deep-search`
- bounded cross-paper comparison across a small local paper set
- checking whether a prior synthesis overclaimed or missed a qualification

Do not use this skill for paper discovery. Use `fast-search`, `pro-search`, or `deep-search` first when the papers are not already local.
Do not use this skill as a replacement for `paper-summary`. `paper-summary` remains the canonical per-paper summary workflow.

## Mission

Given a precise question over already-downloaded local papers:

1. Select a bounded local paper set that is likely to contain the answer.
2. Generate or reuse cached PageIndex tree artifacts for those papers.
3. Use the tree structure to retrieve the most relevant sections.
4. Verify the answer against the tree output, the local PDF, and existing paper summaries when needed.
5. Return a concise grounded answer with exact paper or page references and explicit limitations.
6. Persist reusable artifacts under `research/pageindex/`.

## Prerequisites

- Local PDFs already exist under `research/pdf/`.
- Optional metadata exists under `research/meta/`.
- Optional paper summaries exist under `research/pdf/*.md`.
- `python3` is installed and available in `PATH`.
- A local checkout of the open-source PageIndex repo exists. Recommended path: `tools/PageIndex`.
- `OPENAI_API_KEY` is available, or `CHATGPT_API_KEY` is already set for PageIndex's local runner.

If the local PageIndex checkout is missing, only install it when the user explicitly asks for installation or setup work.

Recommended local setup when the user explicitly wants installation:

```bash
git clone https://github.com/VectifyAI/PageIndex.git tools/PageIndex
python3 -m pip install -r tools/PageIndex/requirements.txt
```

## Hard Requirements

- Operate only on already-downloaded local PDFs. Do not use this skill to search for new papers.
- Keep paper selection bounded before retrieval. Default to:
  - 1 paper for a single-paper question
  - 2-5 papers for a cross-paper question
- Persist PageIndex artifacts under `research/pageindex/`, not in the default `results/` directory.
- Maintain `research/pageindex/manifest.json` so later runs can reuse existing tree artifacts.
- Prefer reusing an existing tree when the source PDF has not changed.
- Bridge auth for the local PageIndex runner with:

```bash
export CHATGPT_API_KEY="${CHATGPT_API_KEY:-${OPENAI_API_KEY:-}}"
```

- Final answers must include exact paper or page references for non-trivial claims whenever the local evidence supports that level of grounding.
- If evidence is partial, summary-only, metadata-only, or not fully verified against the current PDF, say so explicitly.
- Default to the local open-source PageIndex workflow. Do not switch to hosted PageIndex MCP or hosted Chat API unless the user explicitly asks for that external-service path.
- OpenColab normally provides `OPENCOLAB_PROGRESS_FILE` during provider runs. When it is set and the task is long enough to justify updates, emit bounded JSON progress events for selection, indexing, retrieval, verification, degraded coverage, and final delivery.

## OpenColab Progress Helper

OpenColab exposes this progress channel by default during provider runs. When `OPENCOLAB_PROGRESS_FILE` is available, use this helper:

```bash
emit_progress() {
  if [ -z "${OPENCOLAB_PROGRESS_FILE:-}" ]; then
    return 0
  fi
  printf '%s\n' "$1" >> "$OPENCOLAB_PROGRESS_FILE"
}
```

Write one-line JSON events. Allowed `kind` values are `started`, `progress`, `milestone`, `warning`, `needs_input`, and `completed`.

Example:

```bash
emit_progress '{"kind":"milestone","stage":"pageindex","slot":"grounding","message":"Selected 3 local papers for grounded retrieval."}'
```

Useful update categories for this skill:

- selected paper set known
- cached trees reused
- tree generation started or completed
- retrieval and verification started
- degraded run because a PDF, tree, or local PageIndex checkout is missing
- final grounded answer written

## Workflow

### 1. Select a bounded local paper set

Use the question plus whatever local artifacts already exist:

- `research/meta/*.json`
- `research/pdf/*.md`
- prior `findings.md`
- prior `research/pageindex/answers/*.md`

Selection guidance:

- single-paper exact lookup: 1 paper
- "compare these two papers": 2 papers
- broader but still bounded comparison: 3-5 papers

Record the selected papers in `research/pageindex/manifest.json`.

### 2. Prepare the PageIndex workspace

```bash
mkdir -p research/pageindex/{trees,answers}
```

Recommended manifest shape:

```json
{
  "generated_at": "2026-03-22T12:34:56Z",
  "papers": [
    {
      "safe_id": "arxiv__2501.01234",
      "paper_id": "arXiv:2501.01234",
      "title": "Example Paper",
      "pdf_path": "research/pdf/arxiv__2501.01234.pdf",
      "summary_path": "research/pdf/arxiv__2501.01234.md",
      "tree_path": "research/pageindex/trees/arxiv__2501.01234.json",
      "status": "indexed"
    }
  ]
}
```

### 3. Generate or refresh per-paper trees

First bridge the expected env var:

```bash
export CHATGPT_API_KEY="${CHATGPT_API_KEY:-${OPENAI_API_KEY:-}}"
```

If the variable is still empty, stop and report the missing prerequisite instead of pretending the run is grounded.

For each selected paper:

```bash
python3 tools/PageIndex/run_pageindex.py \
  --pdf_path research/pdf/<safe_id>.pdf \
  --model gpt-4o-2024-11-20 \
  --if-add-node-id yes \
  --if-add-node-summary yes \
  --if-add-node-text yes
```

Then move or copy the generated artifact into the canonical cache path:

- from: `results/<safe_id>_structure.json`
- to: `research/pageindex/trees/<safe_id>.json`

If a cached tree already exists and the source PDF has not changed, reuse it.

### 4. Retrieve relevant sections with the tree

For each selected paper:

1. Read `research/pageindex/trees/<safe_id>.json`.
2. Use node titles, node summaries, node ids, and page ranges to shortlist relevant sections.
3. Use node text when available to narrow the answer.
4. If the question depends on exact wording, a figure, a table, or an equation, verify the relevant page or anchor against the local PDF or the existing `paper-summary` output.

For cross-paper questions, do this per paper first, then synthesize. Do not merge trees into one blob and guess.

### 5. Write an optional grounded answer note

When the question is non-trivial, write:

- `research/pageindex/answers/<date>-<topic-slug>.md`

Recommended structure:

```markdown
# Grounded Answer: <topic>

## Question

...

## Selected Local Papers

- `<safe_id>` ...

## Answer

...

## Evidence

- `[Paper: <safe_id>, pp. 4-5]` ...

## Limitations

...
```

### 6. Return the final answer

The user-facing reply should:

- answer the question directly
- name the searched local paper count when it materially affects confidence
- include exact paper or page references inline or immediately after the supported claim
- surface missing PDFs, stale trees, summary-only evidence, or other limitations that materially affect confidence
- point to the saved grounded answer note when one was written

## Output Contract

- `research/pageindex/manifest.json`
- `research/pageindex/trees/<safe_id>.json` for each indexed paper
- optional `research/pageindex/answers/<date>-<topic-slug>.md`
- a concise grounded final reply with exact paper or page references when supported by the local evidence

## Canonical Assets

- Skill doc: `projects/SKILLS/pageindex-grounded/SKILL.md`
- Expected upstream local runner: `tools/PageIndex/run_pageindex.py`
