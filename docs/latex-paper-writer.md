# LaTeX Paper Writer Skill Plan

## Purpose

Add a shared OpenColab skill that helps agents create, edit, compile, and deliver
scientific LaTeX papers and research-summary PDFs. The skill should support
conference-aware templates, grounded summaries from search outputs, architecture
figures when needed, experiment-result tables, and final PDF generation for
delivery through the active user channel.

Proposed skill id: `latex-paper-writer`.

## Target Use Cases

- Create a new scientific paper draft from a topic, method description, notes,
  or experiment results.
- Edit an existing LaTeX paper while preserving its template, macros,
  bibliography style, figures, and section organization.
- Convert `deep-search`, `pro-search`, or `fast-search` findings into a
  structured PDF summary or survey.
- Create paper sections such as abstract, introduction, method, experiments,
  related work, limitations, and conclusion.
- Generate LaTeX tables and plots from experiment logs, CSV files, JSON files,
  markdown tables, or experiment manifests.
- Include architecture figures from existing assets, extracted paper figures,
  or generated block diagrams when they materially clarify the document.
- Keep each paper workspace under Git version control so drafts, figures,
  tables, citations, and compiled outputs can be checkpointed over time.
- Build a final PDF and return it through Telegram or another active channel
  when requested.

## Conference and Venue Families

The skill should map common venue names to template families. The initial
coverage should include:

| Area | Venues |
| --- | --- |
| Core ML and DL | NeurIPS, ICML, ICLR, AISTATS, UAI, COLT |
| Computer Vision | CVPR, ICCV, ECCV, BMVC, WACV |
| NLP and LLMs | ACL, EMNLP, NAACL, COLING, EACL |
| Data Mining, IR, and Recommenders | KDD, The WebConf, SIGIR, WSDM, RecSys, CIKM |
| General AI | AAAI, IJCAI, ECAI |
| Robotics and Embodied AI | ICRA, IROS, CoRL, RSS, HRI |
| Systems for ML | MLSys, OSDI, SOSP, NSDI, ASPLOS, EuroSys |
| Medical and Scientific AI | MICCAI, ISBI, MIDL, NeurIPS Datasets and Benchmarks |
| Audio and Speech | Interspeech, ICASSP, ISMIR |
| Multimedia | ACM MM, IEEE ICME |
| Human-centered AI | CHI, CSCW, UIST, IUI |
| Graphics and 3D | SIGGRAPH, SIGGRAPH Asia, Eurographics, 3DV |
| Security and Privacy ML | USENIX Security, IEEE S&P, CCS, NDSS, PETS |

The skill should treat `ICLR` as the canonical venue name. If a user writes a
near miss such as `ICRL`, the agent should infer `ICLR` when context makes that
clear and mention the correction briefly.

## Template Strategy

The skill should keep `SKILL.md` concise and place venue-specific detail in
reference files and reusable template assets.

Proposed structure:

```text
projects/SKILLS/latex-paper-writer/
  SKILL.md
  references/
    conference-map.md
    document-types.md
    citation-policy.md
    deep-search-integration.md
    experiment-tables.md
  assets/
    templates/
      generic-paper/
      generic-survey/
      generic-technical-report/
      neurips/
      icml/
      iclr/
      cvpr/
      iccv-eccv/
      acl/
      aaai/
      acm/
      ieee/
    bibtex/
      sample.bib
  scripts/
    build_pdf.sh
    validate_latex.sh
    make_results_table.py
```

Template selection should follow this order:

1. Use the exact existing paper template when editing an existing paper.
2. Use a bundled venue template when the target venue is supported.
3. Use a close template family when the venue is known but not bundled.
4. Use `generic-paper` or `generic-technical-report` when no venue is known.

The skill must not claim strict official venue compliance unless the exact
official template is bundled, supplied by the user, or otherwise verified.

## Paper Workspace Version Control

Every generated or managed paper folder should be version controlled with Git.
The skill should treat the paper folder as the durable workspace for the paper,
not as a throwaway render directory.

Default behavior:

1. Create new generated papers under a stable folder such as
   `research/latex/<slug>/` unless the user supplies another path.
2. If the chosen paper folder is not inside an existing Git worktree, initialize
   a new Git repository in that folder.
3. If the chosen paper folder is already inside a Git worktree, use the existing
   repository by default instead of creating a nested repository.
4. If the user explicitly asks for each paper to have an independent repository,
   initialize a dedicated Git repository in the paper folder and avoid touching
   unrelated parent-repository files.
5. Add a paper-focused `.gitignore` for LaTeX build byproducts, caches, and
   temporary files while keeping source `.tex`, `.bib`, figures, tables, and
   final deliverable PDFs trackable.

Checkpoint policy:

- Make an initial checkpoint after creating the template and successfully
  compiling the first PDF.
- Make later checkpoint commits after meaningful edits, successful rebuilds, or
  imported result updates when the user has asked the agent to manage the paper.
- Never stage or commit unrelated changes outside the paper workspace.
- Before editing an existing paper repository, inspect `git status` and preserve
  user changes.
- Prefer short, descriptive commit messages such as `draft: add method section`
  or `results: update ablation table`.

## Core Workflows

### New Paper Draft

When a user asks for a new paper, the skill should:

1. Identify the topic, document type, target venue, deadline constraints, and
   available source material.
2. Select the nearest template family.
3. Create or reuse the Git-controlled paper workspace.
4. Create a minimal paper tree:

   ```text
   main.tex
   references.bib
   sections/
     abstract.tex
     introduction.tex
     related_work.tex
     method.tex
     experiments.tex
     limitations.tex
     conclusion.tex
   figures/
   tables/
   ```

5. Draft only claims supported by user notes, search findings, cited papers, or
   experiment artifacts.
6. Build the PDF and report unresolved citations, missing figures, or compile
   failures clearly.
7. Create a Git checkpoint when the build succeeds and the workspace is cleanly
   scoped to the paper.

### Existing Paper Editing

When editing an existing paper, the skill should:

- Inspect the existing LaTeX structure before changing files.
- Preserve the current venue template and bibliography style.
- Avoid replacing user macros or reorganizing sections unless requested.
- Make targeted edits, then compile and validate the result.
- Summarize changed files and remaining build warnings.

### Search-to-PDF Summary

When a user asks for a summary from `deep-search`, `pro-search`, or
`fast-search` output, the skill should:

1. Locate `findings.md`, downloaded papers, existing BibTeX, diagrams, extracted
   figures, and search metadata.
2. Choose a `generic-survey` or `generic-technical-report` template unless the
   user requests a specific venue format.
3. Produce a structured summary with:
   - title
   - abstract or executive summary
   - paper taxonomy
   - method and architecture comparison
   - experiment or benchmark comparison table when available
   - open problems and limitations
   - references
4. Use grounded citations for technical claims.
5. Build the final PDF and return it through the active channel if requested.

### Experiment Tables and Graphics

When given experiment data, the skill should generate readable LaTeX tables
and optional plots for:

- main benchmark results
- ablations
- dataset comparisons
- runtime, memory, and cost comparisons
- per-class or per-task breakdowns
- statistical summaries with means, standard deviations, confidence intervals,
  or significance markers when provided

The table generator should support CSV, JSON, markdown tables, and simple log
extracts. It should output reusable `.tex` fragments under `tables/` and include
them from `main.tex`.

## Integration with Existing Skills

The new skill should reuse existing OpenColab skills instead of duplicating
research, grounding, figure extraction, or diagram logic:

- Use `fast-search`, `pro-search`, and `deep-search` outputs as research inputs.
- Use `pageindex-grounded` for grounded follow-up QA over already-downloaded
  papers.
- Use `pdf-figure-extract` for extracting figures from local PDFs.
- Use `block-diagram` for literature maps, model architectures, and pipeline
  diagrams when no suitable figure exists or a synthesized diagram is clearer.

The LaTeX skill owns document structure, template selection, citation assembly,
table generation, PDF compilation, validation, and delivery packaging.

## Figure and Diagram Policy

- Prefer user-supplied figures or figures already extracted from local papers.
- Use `pdf-figure-extract` when a source paper likely contains a needed figure.
- Use `block-diagram` when a synthesized architecture, taxonomy, or pipeline
  diagram is more useful than a copied figure.
- Do not invent architectural details, benchmark numbers, or paper claims.
- Clearly label synthesized diagrams as summaries or reconstructions when they
  are not direct figures from a paper.

## Citation and Grounding Policy

- Preserve existing BibTeX entries when editing an existing paper.
- Generate or normalize BibTeX only from reliable source metadata.
- Cite every non-trivial technical claim in research summaries.
- Mark weak, inferred, or partially supported claims explicitly.
- Do not fabricate titles, authors, venues, arXiv ids, DOIs, or benchmark
  values.

## PDF Build and Validation

The skill should prefer deterministic local build steps:

1. Compile with `latexmk` when available.
2. Fall back to a bounded `pdflatex` plus `bibtex` flow when needed.
3. Check that the PDF exists and is non-empty.
4. Inspect logs for missing files, unresolved citations, undefined references,
   overfull boxes, and bibliography failures.
5. Return a concise status with the PDF path and important warnings.

When running in a Telegram-routed workflow, the final PDF should be returned
using the raw file directive expected by OpenColab, for example a raw
`@telegram-file <json>` line, not a markdown-wrapped snippet.

## Implementation Steps

1. Add the `latex-paper-writer` shared skill under `projects/SKILLS/`.
2. Write a concise `SKILL.md` with trigger-focused frontmatter and workflow
   instructions.
3. Add `references/conference-map.md` with venue aliases, template families,
   and fallback rules.
4. Add document-type guidance for papers, surveys, technical reports, search
   summaries, and experiment reports.
5. Add initial template assets for generic paper, generic survey, NeurIPS,
   ICML, ICLR, CVPR-style, ACL-style, ACM-style, and IEEE-style documents.
6. Add build and validation scripts.
7. Add a table-generation script for CSV, JSON, markdown, and simple experiment
   summaries.
8. Add Git workspace initialization, `.gitignore`, status inspection, and
   checkpoint guidance.
9. Document integration points with `deep-search`, `pageindex-grounded`,
   `pdf-figure-extract`, and `block-diagram`.
10. Update `docs/spec.md` first when turning this plan into a behavior change,
   then sync `README.md`, `AGENTS.md`, and implementation files in the same
   change.
11. Validate the skill with realistic prompts:
    - create an ICLR-style paper draft from notes
    - generate a survey PDF from `deep-search/findings.md`
    - turn experiment logs into LaTeX ablation tables
    - edit and rebuild an existing CVPR-style paper

## Open Questions

- Should official conference templates be bundled directly, or should the skill
  ask the user to provide official template zip files for venues with strict
  licensing or versioning?
- Should generated summary PDFs live under `research/latex/<slug>/` by default,
  or should each project define its own output convention?
- Should the first implementation support plots directly, or start with tables
  and rely on user-provided/generated figures for graphics?
- Which LaTeX distribution should be documented as the supported local default
  for macOS, Linux, and Windows installs?
