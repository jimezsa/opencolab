# Research-to-PDF Integration

Use this reference when converting `fast-research`, `pro-research`, or
`deep-research` outputs into a LaTeX report or survey PDF.

## Expected Inputs

Look for these artifacts in the active project:

- `findings.md`
- `research/search/*.json`
- `research/meta/*.json`
- `research/pdf/*.pdf`
- `research/pdf/*.md`
- `research/figures/`
- `diagrams/`
- `references.bib` or BibTeX snippets inside findings

Do not block just because some artifacts are missing. State coverage limits in
the report.

## Recommended Report Structure

Use `generic-survey` unless the user requests a venue-specific format.

Sections:

1. executive summary
2. corpus and scope
3. taxonomy of methods
4. architecture or pipeline comparison
5. benchmark and experiment comparison
6. limitations and open problems
7. references

## Visuals

- Use an existing literature-map diagram when the research skill already produced
  one.
- Use `block-diagram` for a synthesized taxonomy, architecture, or pipeline
  diagram when a visual would clarify the summary.
- Use `pdf-figure-extract` only for figures from already-downloaded local PDFs.
- Label synthesized diagrams as summaries or reconstructions when they are not
  direct figures from a paper.

## Grounding

- Cite the source paper or finding for every non-trivial claim.
- Use `pageindex-grounded` for exact page references when a detail is important
  enough that summary-level evidence is insufficient.
- Include a limitations paragraph when the corpus is partial, metadata-only, or
  missing local PDFs.
