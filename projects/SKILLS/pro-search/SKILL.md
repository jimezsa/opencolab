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
mkdir -p research/{search,meta,pdf,text,notes}

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
  papercli info "$id" --provider all --format json --out "research/meta/${safe_id}.json" || true
  papercli download "$id" --provider all --out "research/pdf/${safe_id}.pdf" || true
done < research/meta/selected_ids.txt
```

### 4. Extract paper text and evidence notes

Extract full text when possible:

```bash
for pdf in research/pdf/*.pdf; do
  [ -e "$pdf" ] || continue
  txt="research/text/$(basename "${pdf%.pdf}").txt"
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext -layout "$pdf" "$txt"
  fi
done
```

Fallback:

- If `pdftotext` is unavailable, use another local extractor (for example Python PDF parsing).
- If full-text extraction fails for a paper, mark it explicitly as metadata-only evidence.

For each paper, record in `research/notes/`:
- Problem setup.
- Method and assumptions.
- Key result values.
- Claimed limitations.
- Important equations (or explicit "none detected").

### 5. Synthesize with explicit comparisons

Build an evidence matrix in the report:
- Rows: papers.
- Columns: task, data, method, metrics, strengths, weaknesses.

Then produce:
- Consensus findings.
- Disputed findings.
- Practical implications for the user's question.

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
| R1 | ... | ... | ... | ... | `meta/...json`, `text/...txt` |
```

## Referencing Rules

- Use `[R#]` inline for claims, numbers, and equation interpretations.
- If a claim cannot be cited, remove or soften it.
- Keep any direct quote short and attributed.

## Done Criteria

- `findings.md` is detailed and decision-useful.
- 8-12 papers were processed (or explain shortfall).
- Math, concepts, and evidence-based synthesis are present.
- References map back to local metadata and extracted text files.
