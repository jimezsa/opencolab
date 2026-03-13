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

Read each PDF directly first so figures, tables, and layout structure remain available during deep analysis.

Direct-ingestion priorities:
- Inspect the abstract, introduction, method section, architecture figures, benchmark tables, ablations, appendix figures, and limitations.
- Treat figures, captions, tables, and appendix visuals as first-class evidence.
- If the PDF cannot be inspected locally, keep metadata reference and mark the summary as metadata-only evidence.

### 6. Structured evidence capture

For each deep-read paper, create `research/pdf/<safe_id>.md`, next to `research/pdf/<safe_id>.pdf`, using this exact schema:

```markdown
# Paper Extraction Schema: <Paper Title>

Rules:
- Keep the section order unchanged for deterministic parsing.
- Ingest the PDF directly first so figures, tables, captions, and layout remain available.
- Anchor each section to observable PDF evidence such as figures, captions, equations, tables, and appendix material.
- Record exact figure, table, equation, algorithm, and page anchors whenever available. If you cannot locate one, write `Anchor not located in available evidence.`.
- Use metadata only as fallback and label it clearly.
- Do not invent equations, datasets, metrics, links, or foundation papers.
- If evidence is missing, write `Not clearly stated in available evidence.`.
- If a statement is an inference rather than an explicit claim, label it `Inference from available evidence: ...`.

## 1. The Why (Motivation & Core Problem)
- The Problem: What specific limitation in existing research or technology is this paper trying to solve? Keep this to 1-2 sentences.
- The Core Idea: What is the authors' main hypothesis or novel approach to solving this problem?
- Evidence Anchors: Exact page, figure, table, or equation anchors supporting the problem framing.

## 2. Main Architecture (Mathematical Formalization)
Agent instruction: Extract the core methodology and represent it strictly as a sequence of mathematical operations, data flows, and loss functions. Use standard LaTeX notation.
The main architecture can often be extracted directly from the architecture image or pipeline diagram in the paper.
If the method is explained primarily through a figure or diagram, use the PDF figure as evidence and translate it into equations and ordered data flow.
If the paper has no learnable architecture (for example a survey, benchmark, theorem, dataset, or systems paper), replace this section with `Algorithm / theorem / protocol flow` and formalize the central steps instead.
Use `Loss / Optimization: Not applicable.` when no training objective exists.

Input:
\[
X = \text{...}
\]

Forward Pass:
\[
H_1 = f_{\text{module\_1}}(X)
\]
\[
H_2 = f_{\text{module\_2}}(H_1)
\]
\[
\hat{Y} = f_{\text{head}}(H_2)
\]

Loss / Optimization:
\[
\mathcal{L}_{\text{total}} = \lambda_1 \mathcal{L}_{\text{task}} + \lambda_2 \mathcal{L}_{\text{reg}}
\]

Evidence Anchors: Exact figure, equation, algorithm, and page anchors used for this formalization.

## 3. The Why of the Architecture (Component Rationale)
Agent instruction: For every variable and function defined in Section 2, explain exactly why it was chosen or designed that way.
If Section 2 is non-architectural, explain why each algorithmic step, theorem component, protocol stage, or evaluation stage exists instead of model modules.

- $X$: Why is the input represented this way?
- $f_{\text{module\_1}}$: Why use this specific module?
- $f_{\text{module\_2}}$: Why is this step necessary?
- $f_{\text{head}}$: Why this prediction head?
- $\mathcal{L}_{\text{task}}$: Why this task objective?
- $\mathcal{L}_{\text{reg}}$: Why use this specific regularizer?
- Evidence Anchors: Exact page, figure, or appendix anchors supporting the rationale.

## 4. Metrics & Evaluation
- Datasets Used: List the primary benchmarks.
- Key Metrics: How is success quantified?
- The Result: One sentence summarizing the paper's main performance claim.
- Visual Evidence: Note the key figure, table, or ablation that best supports the reported result when one is clearly present.
- Evidence Anchors: Exact table, figure, ablation, and page anchors supporting the reported results.

## 5. Relevant Links & Knowledge Anchors
- Project Page / GitHub: Link if available in the paper or metadata.
- Core Foundation Paper: The 1 or 2 most relied-upon prior papers, if the dependency is clear from the text.
- Evidence Anchors: Exact reference numbers, appendix pages, or metadata fields used to identify these links and foundation papers.
```

Summary requirements:
- Keep the section order unchanged.
- Express the main method as LaTeX equations plus data flow and loss terms.
- If no learnable architecture exists, switch Section 2 to `Algorithm / theorem / protocol flow` and write `Loss / Optimization: Not applicable.` instead of inventing modules.
- Explain why each Section 2 variable, module, and loss term exists.
- Preserve figure/table evidence when it carries the method, mechanism, or strongest empirical support.
- Record exact evidence anchors in each section.
- Label missing evidence explicitly instead of guessing.
- Mark inferred statements as `Inference from available evidence: ...`.

After finishing each summary, append the original paper ID to `research/meta/summarized_ids.txt`.

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
- Use the structured paper summaries in `research/pdf/` as the canonical source for cross-paper comparison.

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
- Corpus stats (candidate count, deep-read count, downloaded count, summarized count, failure-event count)

## Literature Map
| Ref | Paper | Year | Method family | Evidence depth |
|---|---|---|---|---|
| R1 | ... | ... | ... | pdf-read |

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
| R1 | ... | ... | ... | ... | `meta/...json`, `pdf/...md`, `pdf/...pdf` |
```

## Referencing Standard

- Use `[R1]`, `[R2]`, ... inline everywhere factual.
- Tables must include citations in relevant cells.
- For numerical claims, cite source paper(s) in the same sentence or cell.
- Do not add a claim if evidence is not present in metadata, the PDF, or the structured summary.

## Quality Gate Before Finish

Before finalizing `findings.md`, verify:
1. All major sections are present.
2. Every analytical claim has citations.
3. Math section includes equations plus interpretation.
4. Conflicting evidence is surfaced, not hidden.
5. References map to real downloaded/local files.
6. Each deep-read paper has an agent-ready summary in `research/pdf/` unless extraction failed.
7. Downloaded and summarized counts reconcile with `research/meta/downloaded_ids.txt` and `research/meta/summarized_ids.txt`, and failure events reconcile with `research/meta/failures.tsv`.
