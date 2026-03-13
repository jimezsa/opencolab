---
name: pro-search
description: Professional paper research with papercli. Multi-pass search, PDF download and reading, math-aware synthesis, and a detailed referenced markdown findings report.
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

# Pro Search Skill

Use this skill when the user needs a serious literature synthesis, not a quick scan. This workflow prioritizes methodological depth, cross-paper comparison, and explicit evidence tracking.

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/pro-search/SKILL.md \
  -o SKILLS/pro-search/SKILL.md
```

## Mission

Answer a scientific question by building a medium-depth evidence base from papers retrieved with `papercli`, then deliver a detailed `findings.md` with:
- Core ideas and major concepts.
- Key mathematical formulations.
- Cross-paper agreements and disagreements.
- Explicit references for every non-trivial claim.

## Prerequisites

- `papercli` is installed and available in `PATH`.
- Optional provider keys:
  - `PAPERCLI_SEMANTIC_API_KEY`
  - `PAPERCLI_SERPAPI_KEY`
- If provider keys are missing, proceed with available providers and document any coverage gaps.

## Hard Requirements

- Retrieval must use `papercli`.
- Download and read the selected PDFs.
- Do not rely on abstract-only synthesis when full text is available.
- Every analytical paragraph must contain `[R#]` citations.
- Final deliverable is a detailed markdown file named `findings.md`.

## Workflow

### 1. Define research frame

Extract:
- Main question.
- Scope boundaries (domain, years, task setting, constraints).
- Evaluation criteria (accuracy, sample efficiency, robustness, compute, interpretability, etc.).

### 2. Build query matrix and search

Run at least 3 query types:
1. Canonical problem phrasing.
2. Method-centric phrasing.
3. Recent trend phrasing.

```bash
mkdir -p research/{search,meta,pdf}
printf "stage\tid\treason\n" > research/meta/failures.tsv
: > research/meta/downloaded_ids.txt
: > research/meta/summarized_ids.txt

papercli search "<canonical query>" --provider all --sort relevance --limit 25 --format json --out research/search/q1.json
papercli search "<method query>"    --provider all --sort relevance --limit 25 --format json --out research/search/q2.json
papercli search "<trend query>"     --provider all --sort date --year-from <recent_year> --limit 25 --format json --out research/search/q3.json
```

Optional author-centered expansion:

```bash
papercli author "<key author>" --provider all --sort relevance --limit 15 --format json --out research/search/author.json
```

### 3. Select 8-12 papers and enrich metadata

Selection rules:
- Include seminal plus recent papers.
- Include at least two competing approaches.
- Include at least one negative/critical or limitation-heavy paper when possible.

```bash
jq -r '.[].id' research/search/*.json | awk 'NF && !seen[$0]++' | head -n 12 > research/meta/selected_ids.txt

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
done < research/meta/selected_ids.txt
```

### 4. Create agent-ready paper summaries

Read each PDF directly first so figures, tables, and page structure remain available during analysis.

Direct-ingestion priorities:

- Inspect the abstract, introduction, method section, architecture figures, key result tables, ablations, and limitations.
- Treat figures, captions, and tables as first-class evidence during note creation.
- If the PDF cannot be inspected locally for a paper, mark the summary explicitly as metadata-only evidence.

For each paper, create `research/pdf/<safe_id>.md`, next to `research/pdf/<safe_id>.pdf`, using this exact schema:

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
- Preserve figure/table evidence when it carries the method or quantitative result.
- Record exact evidence anchors in each section.
- Label missing evidence explicitly instead of guessing.

After finishing each summary, append the original paper ID to `research/meta/summarized_ids.txt`.

### 5. Synthesize with explicit comparisons

Build an evidence matrix in the report:
- Rows: papers.
- Columns: task, data, method, metrics, strengths, weaknesses.

Then produce:
- Consensus findings.
- Disputed findings.
- Practical implications for the user's question.
- Base the comparison on the structured summaries in `research/pdf/`, not ad hoc free-form notes.

## Key Math Handling

- Extract at least 3 high-signal equations across the corpus when available.
- Render equations in LaTeX blocks.
- Explain variable meanings and assumptions.
- Tie each equation to a paper reference on the same line.

Example style:

```markdown
\[
\mathcal{L}(\theta) = \sum_{i=1}^{N} \ell(f_\theta(x_i), y_i) + \lambda \Omega(\theta)
\]
Regularized empirical risk objective balancing fit and complexity [R4].
```

## Output Contract (`findings.md`)

Use this structure:

```markdown
# Findings: <research question>

## Research Scope
- Question:
- In/Out of scope:
- Corpus size:
- Corpus stats: selected ..., downloaded ..., summarized ..., failure events ...

## Methodology Snapshot
- Retrieval strategy:
- Selection criteria:
- Reading depth:

## Evidence Matrix
| Ref | Paper | Method | Setting | Best reported result | Limits |
|---|---|---|---|---|---|
| R1 | ... | ... | ... | ... | ... |

## Core Ideas and Concepts
Paragraph-level synthesis with inline refs [R1][R2].

## Key Math
\[
...
\]
Interpretation [R3].

## Agreements and Conflicts
- Agreement: ... [R2][R5]
- Conflict: ... [R4][R6]

## Practical Takeaways
- Actionable implication 1 [R1][R7]
- Actionable implication 2 [R3][R8]

## References
| Ref | Title | Authors | Year | Provider ID | Source files |
|---|---|---|---|---|---|
| R1 | ... | ... | ... | ... | `meta/...json`, `pdf/...md`, `pdf/...pdf` |
```

## Referencing Rules

- Use `[R#]` inline for claims, numbers, and equation interpretations.
- If a claim cannot be cited, remove or soften it.
- Keep any direct quote short and attributed.

## Done Criteria

- `findings.md` is detailed and decision-useful.
- 8-12 papers were processed (or explain shortfall).
- Math, concepts, and evidence-based synthesis are present.
- Each processed paper has an agent-ready summary in `research/pdf/` unless extraction failed.
- Selected, downloaded, and summarized counts reconcile with `research/meta/selected_ids.txt`, `research/meta/downloaded_ids.txt`, and `research/meta/summarized_ids.txt`, and failure events reconcile with `research/meta/failures.tsv`.
- References map back to local metadata, colocated paper summaries, and downloaded PDFs.
