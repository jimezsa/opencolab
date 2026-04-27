# Citation and Grounding Policy

Scientific documents must distinguish supported claims from synthesis or
speculation.

## Rules

- Preserve existing `references.bib` entries when editing an existing paper.
- Cite every non-trivial technical claim in research-derived summaries.
- Prefer BibTeX from paper metadata files, publisher pages, arXiv, DOI records,
  or user-provided `.bib` files.
- Do not fabricate titles, authors, venues, arXiv ids, DOIs, URLs, benchmark
  numbers, or claims.
- Mark weak, inferred, or partially supported claims explicitly.
- Use `pageindex-grounded` when a claim needs exact page-level confirmation from
  downloaded local PDFs.
- Treat paper summaries and search findings as evidence summaries, not as
  replacements for exact verification when precision matters.

## BibTeX Handling

When a reliable citation key is unavailable, use a stable temporary key:

```text
firstauthorYYYYshorttopic
```

Add a `% TODO: verify metadata` comment above entries whose metadata came from a
partial source.

## Claim Language

Use direct grounded phrasing:

- "Smith et al. report..."
- "The paper evaluates..."
- "In the downloaded corpus, the main approaches cluster into..."

Avoid unsupported phrasing:

- "This proves..."
- "The best method is..."
- "The architecture uses..." when only a vague summary supports it
