---
name: pdf-figure-extract
description: Extract and return figures from already-downloaded local PDFs with PyMuPDF, optionally reusing PageIndex artifacts for page selection and verifying shortlisted candidates multimodally before delivery.
homepage: https://github.com/pymupdf/PyMuPDF
metadata:
  {
    "opencolab":
      {
        "emoji": "🖼️",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# PDF Figure Extract Skill

Use this skill when the user wants a figure, architecture image, pipeline diagram, qualitative result panel, or other visual artifact extracted from a paper that already exists locally under the current project.

Typical use cases:

- "send me the architecture figure from this paper"
- "extract Figure 3 from the local PDF"
- "return the pipeline overview image"
- "find the model diagram from the paper and send it back"
- "pull out the qualitative comparison panel on page 7"

This skill complements `pageindex-grounded`, not replaces it.
When cached PageIndex artifacts already exist, reuse them to narrow candidate pages before extraction.
When PageIndex is missing or inactive, continue in standalone PyMuPDF mode instead of blocking the run.

## Mission

Given a request for a figure in an already-downloaded local PDF:

1. Select a bounded local paper set.
2. Reuse PageIndex artifacts when available to narrow likely pages, otherwise shortlist pages directly from the PDF.
3. Extract or render 1-3 figure candidates with PyMuPDF.
4. Inspect those candidates with the agent's multimodal capability when available to confirm which image best matches the user's request.
5. Save the exported artifacts and manifest data under `research/figures/`.
6. Return the best figure with paper and page context, plus explicit limitations when confidence is reduced.

## Prerequisites

- Local PDFs already exist under `research/pdf/`.
- `python3` is installed and available in `PATH`.
- PyMuPDF is installed:

```bash
python3 -m pip install PyMuPDF
```

Optional but recommended:

- `research/pageindex/manifest.json` and cached PageIndex trees already exist.
- paper summaries exist under `research/pdf/*.md`.

If PyMuPDF is missing, only install it when the user explicitly asks for installation or setup work.

## Hard Requirements

- Operate only on already-downloaded local PDFs. Do not use this skill for paper discovery.
- Use `projects/SKILLS/pdf-figure-extract/scripts/pdf_figure_extract.py` as the canonical local extractor.
- Treat PageIndex as optional acceleration:
  - reuse it when available and relevant
  - do not fail just because PageIndex artifacts are missing
- Keep selection bounded:
  - normally 1 paper for a single-paper request
  - normally 2-3 papers for a cross-paper figure request unless the user explicitly asks for broader coverage
  - normally 1-8 candidate pages per selected paper before exporting images
- Persist artifacts under `research/figures/`, not under temporary ad hoc folders.
- Export a user-deliverable PNG even when the figure is vector-heavy or mixed-content.
- Before returning the figure, inspect the shortlisted candidate images directly with the active agent's multimodal capability when the provider runtime supports local image inspection.
- If multimodal inspection is unavailable, say so explicitly and fall back to caption, page, and layout heuristics instead of overstating certainty.
- If confidence is low, prefer returning the best candidate or top candidates with limitations rather than pretending the match is exact.
- If the chosen figure should be sent back through Telegram, emit a raw `@telegram-file {"kind":"photo","file":"<path>","caption":"optional"}` line on its own line with no backticks or code fences.
- The final reply must identify the paper and page, and include nearby caption text or figure number when available.

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

Useful update categories for this skill:

- selected paper set known
- PageIndex artifacts found or missing
- candidate pages shortlisted
- figure candidates exported
- multimodal verification started or skipped
- degraded standalone fallback
- final figure delivered

## Workflow

### 1. Select the paper set

Use the request plus whatever local artifacts already exist:

- `research/meta/*.json`
- `research/pdf/*.md`
- `research/pageindex/manifest.json`
- prior `findings.md`

Selection guidance:

- exact single-paper request: 1 paper
- "compare the architecture figures in these two papers": 2 papers
- broader but still bounded figure request: 2-3 papers

### 2. Prepare the figure workspace

```bash
mkdir -p research/figures/{exports,manifests,notes}
```

### 3. Run the extractor

Standalone or auto mode:

```bash
python3 projects/SKILLS/pdf-figure-extract/scripts/pdf_figure_extract.py \
  --pdf-path research/pdf/<safe_id>.pdf \
  --query "architecture figure" \
  --output-root research/figures \
  --top-k 3
```

PageIndex-assisted mode when the cached tree is already known:

```bash
python3 projects/SKILLS/pdf-figure-extract/scripts/pdf_figure_extract.py \
  --pdf-path research/pdf/<safe_id>.pdf \
  --query "architecture figure" \
  --pageindex-tree research/pageindex/trees/<safe_id>.json \
  --output-root research/figures \
  --top-k 3
```

Direct figure or page hint mode:

```bash
python3 projects/SKILLS/pdf-figure-extract/scripts/pdf_figure_extract.py \
  --pdf-path research/pdf/<safe_id>.pdf \
  --query "Figure 3" \
  --figure-number 3 \
  --page-hint 5 \
  --output-root research/figures \
  --top-k 2
```

The script writes a per-run manifest under `research/figures/manifests/` and updates `research/figures/manifest.json` with the latest run summary.

### 4. Verify the candidates multimodally

After extraction:

1. Read the manifest and note the top 1-3 candidate image paths.
2. Inspect those local images directly with the active provider's multimodal capability.
3. Check whether the image actually matches the request:
   - architecture or pipeline overview,
   - the requested figure number,
   - the nearby caption or page context,
   - the expected visual content.
4. Choose the best candidate only after that inspection step.

If the provider runtime cannot inspect local images, say so explicitly and rely on the manifest, page context, caption text, and extraction score as a degraded fallback.

### 5. Write an optional note

For non-trivial figure retrieval, write:

- `research/figures/notes/<date>-<topic-slug>.md`

Recommended structure:

```markdown
# Figure Extraction Note: <topic>

## Request

...

## Selected Paper

...

## Extraction Mode

- `pageindex-assisted` or `standalone`

## Chosen Figure

- file: `research/figures/exports/...`
- page: ...
- caption: ...

## Limitations

...
```

### 6. Return the result

The user-facing reply should:

- answer directly
- identify the selected paper and page
- say whether the result came from `pageindex-assisted` or `standalone`
- mention when the returned artifact is a clipped page render rather than a direct embedded-image extraction if that matters
- surface low-confidence matching, missing multimodal verification, missing PageIndex artifacts, or other limitations when they affect confidence
- point to the saved note when one was written

If returning the figure through Telegram, emit the raw `@telegram-file` line after the short reply.

## Output Contract

- `research/figures/manifest.json` for the latest run summary
- `research/figures/manifests/<slug>.json` for the per-run manifest
- `research/figures/exports/<slug>__p<page>__cand<rank>.png` for shortlisted figure candidates
- optional raw extracted image files when the source figure was directly embedded
- optional `research/figures/notes/<date>-<topic-slug>.md`
- a concise final reply with paper, page, and limitations

## Canonical Assets

- Skill doc: `projects/SKILLS/pdf-figure-extract/SKILL.md`
- Python extractor: `projects/SKILLS/pdf-figure-extract/scripts/pdf_figure_extract.py`
