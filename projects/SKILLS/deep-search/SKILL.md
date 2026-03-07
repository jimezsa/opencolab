---
name: deep-search
description: Deep scientific investigation with papercli. Iterative search, broad PDF corpus download and reading, equation-level analysis, and exhaustive referenced markdown findings.
homepage: https://github.com/jimezsa/papercli
metadata:
  {
    "openclaw":
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

## Recommended Corpus Size

- Candidate set: 30-60 papers.
- Deep-read set: 12-20 papers.
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
mkdir -p research/{search,meta,pdf,text,notes,tables}
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
  papercli info "$id" --provider all --format json --out "research/meta/${safe_id}.json" || true
  papercli download "$id" --provider all --out "research/pdf/${safe_id}.pdf" || true
done < research/meta/deep_read_ids.txt
```

### 5. Full-text extraction

```bash
for pdf in research/pdf/*.pdf; do
  [ -e "$pdf" ] || continue
  txt="research/text/$(basename "${pdf%.pdf}").txt"
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext -layout "$pdf" "$txt"
  fi
done
```

If extraction fails:
- Keep metadata reference.
- Mark as "metadata-only evidence" in the final report.
- Attempt an alternate local extractor before giving up.

### 6. Structured evidence capture

For each deep-read paper, store notes in `research/notes/<safe_id>.md` with:
- Problem and motivation.
- Assumptions and threat model.
- Method details.
- Experimental setup.
- Main quantitative outcomes.
- Failure modes and limitations.
- Reproducibility signals (code/data availability).
- Key equations and variable definitions.

### 7. Cross-paper synthesis

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

## Key Math Protocol

- Extract 5+ important equations across the corpus when available.
- Render equations in LaTeX.
- Explain each equation in domain terms, not only symbol definitions.
- Attach at least one citation per equation explanation.

Example:

```markdown
\[
\mathrm{ELBO} = \mathbb{E}_{q_\phi(z \mid x)}[\log p_\theta(x \mid z)] - D_{KL}(q_\phi(z \mid x)\|p(z))
\]
This objective trades reconstruction fidelity against posterior regularization, directly affecting representation quality and generative calibration [R5].
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
- Corpus stats (candidate count, deep-read count)

## Literature Map
| Ref | Paper | Year | Method family | Evidence depth |
|---|---|---|---|---|
| R1 | ... | ... | ... | full-text |

## Core Ideas and Concepts
Deep synthesis paragraphs with inline refs [R#].

## Quantitative Evidence
| Ref | Dataset/Setting | Metric | Reported result | Notes |
|---|---|---|---|---|
| R3 | ... | ... | ... | ... |

## Key Math and Mechanisms
\[
...
\]
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
| Ref | Title | Authors | Year | Provider ID | Local evidence |
|---|---|---|---|---|---|
| R1 | ... | ... | ... | ... | `meta/...json`, `text/...txt` |
```

## Referencing Standard

- Use `[R1]`, `[R2]`, ... inline everywhere factual.
- Tables must include citations in relevant cells.
- For numerical claims, cite source paper(s) in the same sentence or cell.
- Do not add a claim if evidence is not present in metadata or extracted text.

## Quality Gate Before Finish

Before finalizing `findings.md`, verify:
1. All major sections are present.
2. Every analytical claim has citations.
3. Math section includes equations plus interpretation.
4. Conflicting evidence is surfaced, not hidden.
5. References map to real downloaded/parsed files.
