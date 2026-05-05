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
- page-level follow-up after `fast-research`, `pro-research`, or `deep-research`
- bounded cross-paper comparison across a small local paper set
- checking whether a prior synthesis overclaimed or missed a qualification

Do not use this skill for paper discovery. Use `fast-research`, `pro-research`, or `deep-research` first when the papers are not already local.
Do not use this skill as a replacement for `paper-summary`. `paper-summary` remains the canonical per-paper summary workflow.
When the user wants the figure image itself instead of only a grounded answer, hand off to the shared `pdf-figure-extract` skill after you identify the likely paper and page range.

## Mission

Given a precise question over already-downloaded local papers:

1. Select a bounded local paper set that is likely to contain the answer.
2. Generate or reuse cached PageIndex tree artifacts for those papers.
3. Use the tree structure to retrieve the most relevant sections.
4. Verify the answer against the tree output, the local PDF, and existing paper summaries when needed.
5. Return a concise grounded answer with exact paper or page references and explicit limitations.
6. Persist reusable artifacts under the active research run folder, normally `<RUN_ROOT>/pageindex/`.

## Prerequisites

- Local PDFs already exist under an active research run folder, normally `research/<YYYY-MM-DD>-<topic-slug>/pdf/`, or under the legacy flat `research/pdf/` layout.
- Optional metadata exists under `<RUN_ROOT>/meta/` or legacy `research/meta/`.
- Optional paper summaries exist under `<RUN_ROOT>/pdf/*.md` or legacy `research/pdf/*.md`.
- `python3` is installed and available in `PATH`.
- A local checkout of the open-source PageIndex repo exists. Recommended path: `tools/PageIndex`.
- `GEMINI_API_KEY` is available for the local PageIndex runner.

If the local PageIndex checkout is missing, only install it when the user explicitly asks for installation or setup work.

Recommended local setup when the user explicitly wants installation:

```bash
git clone https://github.com/VectifyAI/PageIndex.git tools/PageIndex
python3 -m pip install -r tools/PageIndex/requirements.txt
```

## Hard Requirements

- Operate only on already-downloaded local PDFs. Do not use this skill to search for new papers.
- Prefer selecting the active research run folder from `research/INDEX.md` when it exists. If there is no index, infer the best run folder from the user's topic and existing `research/*/RUN.md` files; fall back to legacy `research/pdf/` only for older projects.
- Keep paper selection bounded before retrieval. Default to:
  - 1 paper for a single-paper question
  - 2-5 papers for a cross-paper question
- Persist PageIndex artifacts under `<RUN_ROOT>/pageindex/`, not in the default `results/` directory.
- Maintain `<RUN_ROOT>/pageindex/manifest.json` so later runs can reuse existing tree artifacts.
- Prefer reusing an existing tree when the source PDF has not changed.
- The local PageIndex runner must have `GEMINI_API_KEY` available in the environment.

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

- `research/INDEX.md`
- `<RUN_ROOT>/RUN.md`
- `<RUN_ROOT>/meta/*.json`
- `<RUN_ROOT>/pdf/*.md`
- prior `<RUN_ROOT>/findings.md`
- prior `<RUN_ROOT>/pageindex/answers/*.md`

Selection guidance:

- single-paper exact lookup: 1 paper
- "compare these two papers": 2 papers
- broader but still bounded comparison: 3-5 papers

Record the selected papers in `<RUN_ROOT>/pageindex/manifest.json`.

### 2. Prepare the PageIndex workspace

```bash
RUN_ROOT="research/<YYYY-MM-DD>-<topic-slug>"
mkdir -p "$RUN_ROOT/pageindex"/{trees,answers}
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
      "pdf_path": "research/2026-03-22-example-topic/pdf/arxiv__2501.01234.pdf",
      "summary_path": "research/2026-03-22-example-topic/pdf/arxiv__2501.01234.md",
      "tree_path": "research/2026-03-22-example-topic/pageindex/trees/arxiv__2501.01234.json",
      "status": "indexed"
    }
  ]
}
```

### 3. Generate or refresh per-paper trees

First confirm `GEMINI_API_KEY` is available. If it is missing, stop and report the missing prerequisite instead of pretending the run is grounded.

For each selected paper:

```bash
python3 tools/PageIndex/run_pageindex.py \
  --pdf_path "$RUN_ROOT/pdf/<safe_id>.pdf" \
  --model gemini/gemini-3.1-flash-lite-preview \
  --if-add-node-id yes \
  --if-add-node-summary yes \
  --if-add-node-text yes
```

Then move or copy the generated artifact into the canonical cache path:

- from: `results/<safe_id>_structure.json`
- to: `$RUN_ROOT/pageindex/trees/<safe_id>.json`

If a cached tree already exists and the source PDF has not changed, reuse it.

### 4. Retrieve relevant sections with the tree

For each selected paper:

1. Read `$RUN_ROOT/pageindex/trees/<safe_id>.json`.
2. Use node titles, node summaries, node ids, and page ranges to shortlist relevant sections.
3. Use node text when available to narrow the answer.
4. If the question depends on exact wording, a figure, a table, or an equation, verify the relevant page or anchor against the local PDF or the existing `paper-summary` output. If the user wants the figure artifact returned, pass the likely page(s) to `pdf-figure-extract` instead of trying to answer with text alone.

For cross-paper questions, do this per paper first, then synthesize. Do not merge trees into one blob and guess.

### 5. Write an optional grounded answer note

When the question is non-trivial, write:

- `$RUN_ROOT/pageindex/answers/<date>-<topic-slug>.md`

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

- `<RUN_ROOT>/pageindex/manifest.json`
- `<RUN_ROOT>/pageindex/trees/<safe_id>.json` for each indexed paper
- optional `<RUN_ROOT>/pageindex/answers/<date>-<topic-slug>.md`
- a concise grounded final reply with exact paper or page references when supported by the local evidence

## Canonical Assets

- Skill doc: `projects/SKILLS/pageindex-grounded/SKILL.md`
- Expected upstream local runner: `tools/PageIndex/run_pageindex.py`
