---
name: deep-search
description: Deep scientific investigation with papercli. Iterative search, broad PDF corpus download and reading, equation-level analysis, and exhaustive referenced markdown findings.
homepage: https://github.com/jimezsa/papercli
metadata:
  {
    "opencolab":
      {
        "emoji": "📄",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["papercli"] },
        "install":
          [
            {
              "id": "homebrew",
              "kind": "shell",
              "script": "brew install jimezsa/tap/papercli",
              "bins": ["papercli"],
              "label": "Install PaperCLI with Homebrew",
            },
            {
              "id": "source",
              "kind": "shell",
              "script": "git clone https://github.com/jimezsa/papercli.git && cd papercli && make build && sudo install -m 0755 ./bin/papercli /usr/local/bin/papercli",
              "bins": ["papercli"],
              "label": "Build PaperCLI from source",
            },
          ],
      },
  }
---

# Deep Search Skill

Use this skill for comprehensive scientific research tasks such as state-of-the-art reviews, deep comparisons, research strategy, and evidence-heavy decision support.

If the user later asks an exact follow-up question about a downloaded paper or wants a bounded local verification pass, switch to `pageindex-grounded` for grounded retrieval over the existing PDF corpus.

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/deep-search/SKILL.md \
  -o SKILLS/deep-search/SKILL.md
```

## Mission

Deliver an institutional-grade `findings.md` by:

1. Running iterative `papercli` retrieval across multiple query waves.
2. Downloading and reading a broad, diverse paper corpus.
3. Extracting core ideas, concepts, results, assumptions, and key mathematics.
4. Producing a detailed markdown report where all claims are grounded by references.
5. Producing a companion literature-map block diagram that shows how the main papers or paper families connect.

## Prerequisites

- `papercli` is installed and available in `PATH`.
- Optional provider keys:
  - `PAPERCLI_SEMANTIC_API_KEY`
  - `PAPERCLI_SERPAPI_KEY`
- If keys are absent, continue with available providers and record this limitation in the report.

## Non-Negotiable Rules

- Use `papercli` as the retrieval backbone.
- Read paper content from downloaded PDFs whenever possible.
- Never present uncited factual claims.
- Surface conflicts and uncertainty explicitly.
- Final output must be a detailed markdown file named `findings.md`.
- After synthesis, produce a companion literature-map diagram through the shared `block-diagram` skill.
- The literature map must only show evidence-backed relations such as method lineage, direct comparison, shared benchmark or dataset, critique, or common problem framing.
- Do not invent paper-to-paper influence or citation edges that are not supported by the corpus.
- OpenColab normally provides `OPENCOLAB_PROGRESS_FILE` during provider runs. When it is set, emit bounded JSON progress updates for long-running stages instead of remaining silent until the end.

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
emit_progress '{"kind":"progress","stage":"download","slot":"search","current":8,"total":12,"message":"Downloaded 8 of 12 PDFs."}'
```

Let the agent decide what is worth sending. Use `progress` for countable ongoing work, `milestone` for stage changes, `warning` for degraded runs, `needs_input` for blockers, and `completed` when an explicit completion event helps. Do not narrate every minor command.

## Recommended Corpus Size

- Candidate set: 50-100 papers.
- Deep-read set: 40-60 papers.
- If access constraints reduce coverage, document the shortfall in the report.

## End-to-End Workflow

### 1. Scope and evaluation design

Define:

- Research question(s).
- Inclusion/exclusion criteria.
- Comparison axes (data, methods, metrics, assumptions, compute, robustness).
- Time split (foundational vs. recent papers).

### 2. Multi-wave retrieval with papercli

Create workspace:

```bash
mkdir -p research/{search,meta,pdf,tables}
printf "stage\tid\treason\n" > research/meta/failures.tsv
: > research/meta/downloaded_ids.txt
: > research/meta/summarized_ids.txt
```

Run at least 4 waves:

1. Core terminology.
2. Synonyms and adjacent terminology.
3. Method families.
4. Recent trend and benchmark-focused search.

```bash
papercli search "<core query>" --provider all --sort relevance --limit 30 --format json --out research/search/w1_core.json
papercli search "<adjacent query>" --provider all --sort relevance --limit 30 --format json --out research/search/w2_adjacent.json
papercli search "<method family query>" --provider all --sort relevance --limit 30 --format json --out research/search/w3_methods.json
papercli search "<benchmark/trend query>" --provider all --sort date --year-from <recent_year> --limit 30 --format json --out research/search/w4_recent.json
```

Optional citation-hub expansion through author trails:

```bash
papercli author "<influential author>" --provider all --sort relevance --limit 20 --format json --out research/search/author_1.json
papercli author "<contrasting author>" --provider all --sort relevance --limit 20 --format json --out research/search/author_2.json
```

### 3. Candidate consolidation and screening

```bash
jq -r '.[].id' research/search/*.json | awk 'NF && !seen[$0]++' > research/meta/candidate_ids.txt
```

Screen candidates for:

- Relevance to user question.
- Methodological diversity.
- Dataset/benchmark coverage.
- Publication-year balance.

Write selected IDs to `research/meta/deep_read_ids.txt`.

### 4. Metadata enrichment and bulk download

```bash
while read -r id; do
  safe_id="$(echo "$id" | tr '/:' '__')"

  if ! papercli info "$id" --provider all --format json --out "research/meta/${safe_id}.json"; then
    printf "info\t%s\tmetadata lookup failed\n" "$id" >> research/meta/failures.tsv
  fi

  if papercli download "$id" --provider all --out "research/pdf/${safe_id}.pdf"; then
    printf "%s\n" "$id" >> research/meta/downloaded_ids.txt
  else
    printf "download\t%s\tpdf download failed\n" "$id" >> research/meta/failures.tsv
  fi
done < research/meta/deep_read_ids.txt
```

### 5. Create agent-ready paper summaries

Delegate the summary phase to the `paper-summary` skill so the deep workflow uses the same canonical schema and batch summarizer as the other search skills.

Run it after the deep-read PDFs and metadata are ready:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf-dir research/pdf \
  --metadata-dir research/meta \
  --summarized-ids research/meta/summarized_ids.txt \
  --failures-tsv research/meta/failures.tsv \
  --concurrency 20
```

Retry one paper with:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf research/pdf/<safe_id>.pdf \
  --metadata-dir research/meta \
  --summarized-ids research/meta/summarized_ids.txt \
  --failures-tsv research/meta/failures.tsv
```

Summary requirements:

- Use the canonical schema in `SKILLS/paper-summary/references/summary_schema.md`.
- Write each summary to `research/pdf/<safe_id>.md`.
- Treat figures, captions, tables, appendix visuals, equations, and page anchors as first-class evidence.
- Mark metadata-only evidence explicitly when the PDF cannot be analyzed directly.
- Record summary failures in `research/meta/failures.tsv` and keep the corpus moving.

### 6. Cross-paper synthesis

Build at least these comparative artifacts inside `findings.md`:

- Taxonomy table (approach families).
- Results table (metrics and conditions).
- Assumption table (where methods break).
- Equation registry (important formulas and interpretation).

Then analyze:

- Consensus patterns.
- Contradictions and likely causes.
- Gaps and open problems.
- Most defensible practical recommendations.
- Use the structured paper summaries in `research/pdf/` as the canonical source for cross-paper comparison.

### 7. Produce literature-map block diagram

Delegate this step to the shared `block-diagram` skill. It owns the canonical D2 source, render, validation, and diagram-file delivery flow.

Diagram requirements:

- Base the diagram on the same corpus and `[R#]` references used in `findings.md`.
- Show how the main papers, method families, benchmark clusters, or critique branches connect through evidence-backed relations only.
- Prefer compact family clusters when a flat per-paper graph would be noisy.
- Use a topic-derived slug such as `<topic-slug>-literature-map` under `diagrams/`.
- Prefer `png` as the primary delivered literature-map artifact.
- Keep `svg` as the editable or fallback artifact when PNG rendering is unavailable.

## Key Math Protocol

- Extract 5+ important equations across the corpus when available.
- Write equations in plain-text markdown, not LaTeX blocks.
- Prefer ASCII-friendly math so the output stays readable in raw markdown and easy to parse by tools.
- Use a consistent three-line pattern:
  - `Equation: <name> = <plain-text formula> [R#]`
  - `Where: <symbol> = <meaning>; ...`
  - `Interpretation: <what the equation does, why it matters, and any assumptions> [R#]`
- Explain each equation in domain terms, not only symbol definitions.
- Attach at least one citation per equation explanation.

Example:

```markdown
Equation: ELBO = E_q_phi(z | x)[log p_theta(x | z)] - KL(q_phi(z | x) || p(z)) [R5]
Where: x = observed input; z = latent variable; q_phi = approximate posterior; p_theta = decoder; KL = Kullback-Leibler divergence.
Interpretation: This objective trades reconstruction fidelity against posterior regularization, which shapes representation quality and generative calibration [R5].
```

## Output Contract (`findings.md`)

Use this exact top-level structure:

```markdown
# Findings: <topic>

## Executive Answer

Direct answer to the user question with confidence-qualified claims [R#].

## Scope and Method

- Question framing
- Inclusion/exclusion criteria
- Corpus stats (candidate count, deep-read count, downloaded count, summarized count, failure-event count)

## Literature Map

| Ref | Paper | Year | Method family | Evidence depth |
| --- | ----- | ---- | ------------- | -------------- |
| R1  | ...   | ...  | ...           | pdf-read       |

## Core Ideas and Concepts

Deep synthesis paragraphs with inline refs [R#].

## Quantitative Evidence

| Ref | Dataset/Setting | Metric | Reported result | Notes |
| --- | --------------- | ------ | --------------- | ----- |
| R3  | ...             | ...    | ...             | ...   |

## Key Math and Mechanisms

Equation: <name> = <plain-text formula> [R#]
Where: <symbol> = <meaning>; ...
Interpretation and implications [R#].

## Agreements, Conflicts, and Uncertainty

- Agreement:
- Conflict:
- Sources of uncertainty:

## Recommendations and Research Gaps

- What is ready to use now.
- What needs further validation.
- High-value open research directions.

## References

| Ref | Title | Authors | Year | Provider ID | Local evidence                            |
| --- | ----- | ------- | ---- | ----------- | ----------------------------------------- |
| R1  | ...   | ...     | ...  | ...         | `meta/...json`, `pdf/...md`, `pdf/...pdf` |
```

Companion literature-map artifacts:

- `diagrams/<topic-slug>-literature-map.d2`
- `diagrams/<topic-slug>-literature-map.png`
- optional `diagrams/<topic-slug>-literature-map.svg`

## Final Chat Reply

After writing `findings.md`, return a short, friendly summary for the user-facing chat reply. Keep `findings.md` as the full canonical report and do not change its structure.

- Use an executive-summary tone that still reads well in chat.
- Light emoji use is allowed when it makes the message easier to scan.
- Include:
  - one direct-answer line
  - one coverage line with candidate, deep-read, downloaded, summarized, and failure counts
  - one short literature-map line explaining how the main papers or paper families connect
  - 3-5 cited takeaways covering the strongest findings and the main disagreements
  - one short uncertainty or risk line when it materially affects the recommendation
  - one closing line that points to `findings.md` for the full evidence base
- Do not paste the full literature map, quantitative tables, or long report sections into chat.
- If the active channel supports returning files, return `findings.md` plus the PNG literature-map diagram after the summary. If PNG rendering is unavailable, return the SVG artifact instead.

## Referencing Standard

- Use `[R1]`, `[R2]`, ... inline everywhere factual.
- Tables must include citations in relevant cells.
- For numerical claims, cite source paper(s) in the same sentence or cell.
- Do not add a claim if evidence is not present in metadata, the PDF, or the structured summary.

## Quality Gate Before Finish

Before finalizing `findings.md`, verify:

1. All major sections are present.
2. Every analytical claim has citations.
3. Math section uses plain-text equations plus interpretation.
4. Conflicting evidence is surfaced, not hidden.
5. References map to real downloaded/local files.
6. Each deep-read paper has an agent-ready summary in `research/pdf/` unless extraction failed.
7. Downloaded and summarized counts reconcile with `research/meta/downloaded_ids.txt` and `research/meta/summarized_ids.txt`, and failure events reconcile with `research/meta/failures.tsv`.
8. A PNG literature-map artifact exists, or an SVG fallback is returned when PNG rendering is unavailable, and the diagram only shows evidence-backed cross-paper connections.
