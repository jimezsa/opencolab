---
name: latex-paper-writer
description: Create, edit, Git-version, compile, and deliver scientific LaTeX papers, reports, and research-derived PDF summaries. Use for venue-aware templates such as ICLR, NeurIPS, ICML, CVPR, ACL, ACM, and IEEE; experiment-result tables; architecture figures or diagrams; deep-research/pro-research/fast-research to PDF summaries; and .tex to PDF builds with latexmk.
metadata:
  opencolab:
    emoji: "📝"
    os: ["linux", "darwin", "windows"]
    requires:
      bins: ["git", "python3"]
    optional:
      bins: ["latexmk", "pdflatex", "bibtex", "biber"]
    install:
      - id: "macos-mactex"
        kind: "shell"
        script: "brew install --cask mactex"
        bins: ["latexmk"]
        label: "Install full MacTeX with Homebrew"
      - id: "macos-basictex"
        kind: "shell"
        script: "brew install --cask basictex && sudo tlmgr update --self && sudo tlmgr install latexmk"
        bins: ["latexmk"]
        label: "Install smaller BasicTeX plus latexmk"
      - id: "ubuntu"
        kind: "shell"
        script: "sudo apt-get update && sudo apt-get install -y latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended"
        bins: ["latexmk"]
        label: "Install latexmk and common TeX Live packages on Debian or Ubuntu"
      - id: "fedora"
        kind: "shell"
        script: "sudo dnf install latexmk texlive-scheme-medium"
        bins: ["latexmk"]
        label: "Install latexmk and medium TeX Live on Fedora"
      - id: "arch"
        kind: "shell"
        script: "sudo pacman -S texlive-binextra texlive-latexrecommended texlive-latexextra"
        bins: ["latexmk"]
        label: "Install latexmk through TeX Live packages on Arch"
---

# LaTeX Paper Writer Skill

Use this skill when the user wants a scientific paper, survey, technical report,
research-derived PDF summary, LaTeX experiment table, or edits to an existing
LaTeX document.

This is the canonical OpenColab path for paper production. Research, grounding,
figure extraction, and architecture diagrams stay delegated to the existing
shared skills; this skill owns the LaTeX workspace, document structure,
template selection, scoped Git version control, PDF compilation, validation,
and final delivery packaging.

## Mission

Given source material for a scientific document:

1. Select or preserve the right LaTeX template.
2. Create or reuse a Git-controlled paper workspace.
3. Draft or edit the LaTeX sources with grounded claims and citations.
4. Generate experiment tables when useful.
5. Add user-supplied, extracted, or generated figures when they clarify the paper.
6. Build and validate the PDF.
7. Create scoped Git checkpoints when the paper has meaningful changes.
8. Return the final PDF path, and emit a raw Telegram file directive when needed.

## Prerequisites

- `git` is installed and available in `PATH`.
- `python3` is installed and available in `PATH`.
- `latexmk` is preferred for PDF builds:

```bash
latexmk -v
```

If `latexmk` is missing, read `references/document-types.md` for install
guidance and do not claim that compilation succeeded. Only run install commands
after the user explicitly approves installing system packages.

## Hard Requirements

- Read `references/conference-map.md` before choosing a venue template.
- Read `references/citation-policy.md` before writing claims from papers.
- Read `references/deep-research-integration.md` when converting research outputs
  into a PDF summary or survey.
- Read `references/experiment-tables.md` before generating result tables.
- Use the existing paper's template and macros when editing an existing paper.
- Treat `ICLR` as the canonical venue name; infer it from near misses such as
  `ICRL` only when context makes that clear, and mention the correction briefly.
- Do not claim official venue-template compliance unless the official template
  is bundled, user-supplied, or otherwise verified.
- Keep every generated or managed paper workspace under Git version control.
- Never stage or commit unrelated files outside the paper workspace.
- Inspect `git status` before editing an existing paper repository.
- Use `pdf-figure-extract` for figures from already-downloaded local PDFs.
- Use `block-diagram` for synthesized architecture, taxonomy, pipeline, or
  literature-map diagrams.
- Use `pageindex-grounded` for exact local evidence checks over downloaded
  papers when a technical claim needs verification.
- Do not fabricate citations, metadata, benchmark values, or architecture
  details.
- When sending a PDF through Telegram, emit a raw
  `@telegram-file {"kind":"document","file":"<path>","caption":"optional"}`
  line on its own line with no code fence.

## Workflow

### 1. Classify the task

Choose the path:

- new paper draft: create a workspace and template
- existing paper edit: inspect and preserve the current structure
- research-to-PDF summary: use `findings.md`, paper summaries, diagrams, and PDFs
- experiment report: generate tables/plots and cite the experiment artifacts
- table-only task: generate `.tex` table fragments under `tables/`

If the user provides a conference, map it with
`references/conference-map.md`. If no venue is known, use `generic-paper`,
`generic-survey`, or `generic-technical-report`.

### 2. Initialize or inspect the workspace

For a new paper:

```bash
python3 projects/SKILLS/latex-paper-writer/scripts/init_paper_workspace.py \
  --template iclr \
  --output research/latex/<slug> \
  --title "<paper title>" \
  --author "<author line>" \
  --venue "ICLR"
```

Use `--dedicated-git` only when the user explicitly wants the paper folder to
be its own repository even if it is inside a parent worktree.

For an existing paper, inspect files first:

```bash
git -C <paper-root> status --short
find <paper-root> -maxdepth 3 -type f | sort
```

Do not overwrite user changes or replace an existing template.

### 3. Write or edit the paper

Use the document type guidance in `references/document-types.md`.

Default new-paper tree:

```text
main.tex
references.bib
sections/
figures/
tables/
main.pdf
```

Keep the document source-first. The PDF is a derived deliverable, but it may be
tracked when the user wants deliverable history.

### 4. Generate experiment tables

For CSV, JSON, markdown table, or simple `key=value` logs:

```bash
python3 projects/SKILLS/latex-paper-writer/scripts/make_results_table.py \
  --input research/results.csv \
  --output tables/results.tex \
  --caption "Main benchmark results." \
  --label tab:main-results
```

Include the generated fragment from `main.tex` with `\input{tables/results}`.

### 5. Build and validate the PDF

```bash
bash projects/SKILLS/latex-paper-writer/scripts/build_pdf.sh \
  --root research/latex/<slug> \
  --main main.tex
```

The build script prefers `latexmk`, falls back to a bounded `pdflatex` plus
bibliography flow when possible, and then runs validation. If the compiler is
missing, return install guidance instead of pretending the PDF exists.

### 6. Commit scoped checkpoints

After a successful meaningful edit or build:

```bash
python3 projects/SKILLS/latex-paper-writer/scripts/git_checkpoint.py \
  --root research/latex/<slug> \
  --message "draft: add method section"
```

The checkpoint script stages only the paper workspace and aborts when unrelated
pre-staged files would be included in the same commit.

## Output Contract

For a full paper or report task, return:

- paper workspace path
- primary `.tex` path
- final PDF path when built
- important warnings from validation
- Git checkpoint commit hash when one was made
- raw `@telegram-file` line when Telegram delivery was requested

## Canonical Assets

- Skill doc: `projects/SKILLS/latex-paper-writer/SKILL.md`
- Conference map: `projects/SKILLS/latex-paper-writer/references/conference-map.md`
- Document types: `projects/SKILLS/latex-paper-writer/references/document-types.md`
- Citation policy: `projects/SKILLS/latex-paper-writer/references/citation-policy.md`
- Research integration: `projects/SKILLS/latex-paper-writer/references/deep-research-integration.md`
- Experiment tables: `projects/SKILLS/latex-paper-writer/references/experiment-tables.md`
- Templates: `projects/SKILLS/latex-paper-writer/assets/templates/`
- Workspace initializer: `projects/SKILLS/latex-paper-writer/scripts/init_paper_workspace.py`
- PDF builder: `projects/SKILLS/latex-paper-writer/scripts/build_pdf.sh`
- PDF validator: `projects/SKILLS/latex-paper-writer/scripts/validate_latex.sh`
- Table generator: `projects/SKILLS/latex-paper-writer/scripts/make_results_table.py`
- Git checkpoint helper: `projects/SKILLS/latex-paper-writer/scripts/git_checkpoint.py`
