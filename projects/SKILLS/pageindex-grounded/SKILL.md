---
name: pageindex-grounded
description: SDK-backed grounded follow-up QA over already-downloaded papers. Use the packaged PageIndex Python SDK, keep paper selection bounded, cache local manifests and tree artifacts, and answer with exact paper or page references when the evidence supports it.
homepage: https://docs.pageindex.ai/sdk
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
2. Use the packaged PageIndex Python SDK to submit or reuse those documents.
3. Cache the returned document ids and tree artifacts under `research/pageindex/`.
4. Ask a grounded question with citations enabled.
5. Return a concise answer with exact paper or page references and explicit limitations.
6. Persist reusable artifacts and answer notes for later follow-up questions.

## Prerequisites

- Local PDFs already exist under `research/pdf/`.
- Optional metadata exists under `research/meta/`.
- Optional paper summaries exist under `research/pdf/*.md`.
- `python3` is installed and available in `PATH`.
- `PAGEINDEX_API_KEY` is set in the environment.
- Network access is available when the SDK runs.

Install or upgrade the packaged SDK with:

```bash
python3 -m pip install -q --upgrade pageindex
```

If you are working in a notebook instead of a shell, the equivalent is:

```python
%pip install -q --upgrade pageindex
```

## Hard Requirements

- Operate only on already-downloaded local PDFs. Do not use this skill to search for new papers.
- Keep paper selection bounded before retrieval. Default to 1 paper for a single-paper question and 2-5 papers for a cross-paper question.
- Use the packaged `pageindex` Python SDK. Do not clone the upstream PageIndex repo into the project as part of this workflow.
- Use the canonical helper script `projects/SKILLS/pageindex-grounded/scripts/pageindex_grounded.py` instead of ad hoc one-off SDK snippets.
- Persist local artifacts under `research/pageindex/`, including `manifest.json`, `trees/`, and optional `answers/`.
- Prefer reusing an existing `doc_id` from the local manifest when it is still valid.
- Enable citations when asking questions through the SDK so PageIndex can return inline references such as `<doc=file.pdf;page=1>`.
- Final answers must include exact paper or page references for non-trivial claims whenever the local evidence supports that level of grounding.
- If evidence is partial, summary-only, metadata-only, or not fully verified against the current PDF corpus, say so explicitly.
- OpenColab normally provides `OPENCOLAB_PROGRESS_FILE` during provider runs. When it is set and the task is long enough to justify updates, emit bounded JSON progress events for selection, submission, polling, tree sync, grounded answer generation, degraded coverage, and final delivery.

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
- SDK install started or completed
- document submission or reuse started
- document processing completed
- tree artifact synced locally
- grounded answer started or completed
- degraded run because a PDF, API key, or network dependency is missing

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

### 2. Prepare the local PageIndex workspace

```bash
mkdir -p research/pageindex/{trees,answers}
python3 -m pip install -q --upgrade pageindex
```

### 3. Run the canonical helper script

Index only:

```bash
python3 projects/SKILLS/pageindex-grounded/scripts/pageindex_grounded.py \
  --pdf research/pdf/<safe_id>.pdf
```

Grounded QA over one or more local papers:

```bash
python3 projects/SKILLS/pageindex-grounded/scripts/pageindex_grounded.py \
  --question "What is the exact main claim about the benchmark result?" \
  --pdf research/pdf/<safe_id>.pdf \
  --pdf research/pdf/<other_safe_id>.pdf
```

The helper script will:

- submit or reuse documents through the PageIndex SDK
- poll until processing completes
- sync the document tree locally under `research/pageindex/trees/`
- maintain `research/pageindex/manifest.json`
- optionally write a grounded answer note under `research/pageindex/answers/`

### 4. Verify the answer when necessary

If the answer depends on exact wording, a figure, a table, or an equation:

- check the local PDF directly
- check the existing `paper-summary` output when it already captured the anchor cleanly
- preserve the PageIndex citation format in the final answer when it is returned

For cross-paper questions, do this per paper first, then synthesize. Do not merge unrelated documents into one vague answer.

### 5. Return the final answer

The user-facing reply should:

- answer the question directly
- name the searched local paper count when it materially affects confidence
- include exact paper or page references inline or immediately after the supported claim
- surface missing PDFs, invalid `doc_id`s, missing `PAGEINDEX_API_KEY`, network failures, summary-only evidence, or other limitations that materially affect confidence
- point to the saved grounded answer note when one was written

## Output Contract

- `research/pageindex/manifest.json`
- `research/pageindex/trees/<safe_id>.json` for each synchronized paper
- optional `research/pageindex/answers/<date>-<topic-slug>.md`
- optional `research/pageindex/answers/<date>-<topic-slug>.json`
- a concise grounded final reply with exact paper or page references when supported by the local evidence

## Canonical Assets

- Skill doc: `projects/SKILLS/pageindex-grounded/SKILL.md`
- SDK helper: `projects/SKILLS/pageindex-grounded/scripts/pageindex_grounded.py`
