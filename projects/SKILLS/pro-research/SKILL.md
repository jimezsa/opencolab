---
name: pro-research
description: Professional paper research with papercli. Multi-pass search, PDF download and reading, math-aware synthesis, and a detailed referenced markdown findings report.
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

# Pro Research Skill

Use this skill when the user needs a serious literature synthesis, not a quick scan. This workflow prioritizes methodological depth, cross-paper comparison, and explicit evidence tracking.

If the user later asks an exact follow-up question about a downloaded paper or a bounded local paper subset, switch to `pageindex-grounded` for page-level grounded retrieval instead of forcing that work through the synthesis report alone.

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/pro-research/SKILL.md \
  -o SKILLS/pro-research/SKILL.md
```

## Mission

Answer a scientific question by building a medium-depth evidence base from papers retrieved with `papercli`, then deliver a detailed `findings.md` with:

- Core ideas and major concepts.
- Key mathematical formulations.
- Cross-paper agreements and disagreements.
- Explicit references for every non-trivial claim.
- A companion literature-map block diagram that shows how the main papers or paper families connect.

## Prerequisites

- `papercli` is installed and available in `PATH`.

## Hard Requirements

- Retrieval must use `papercli`.
- Download and read the selected PDFs.
- Do not rely on abstract-only synthesis when full text is available.
- Every analytical paragraph must contain `[R#]` citations.
- Final deliverable is a detailed markdown file named `findings.md`.
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

Delegate this step to the `paper-summary` skill. It centralizes the summary schema, PDF-first evidence rules, and Gemini-based parallel execution.

Run it after `research/pdf/*.pdf` and `research/meta/*.json` are ready:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf-dir research/pdf \
  --metadata-dir research/meta \
  --summarized-ids research/meta/summarized_ids.txt \
  --failures-tsv research/meta/failures.tsv \
  --concurrency 10
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
- Treat figures, captions, tables, equations, and layout cues as first-class evidence.
- Mark metadata-only evidence explicitly when the PDF is unreadable.
- Record failures in `research/meta/failures.tsv` so the synthesis step can reconcile counts.

### 5. Synthesize with explicit comparisons

Build an evidence matrix in the report:

- Rows: papers.
- Columns: task, data, method, metrics, strengths, weaknesses.

Then produce:

- Consensus findings.
- Disputed findings.
- Practical implications for the user's question.
- Base the comparison on the structured summaries in `research/pdf/`, not ad hoc free-form notes.

### 6. Produce literature-map block diagram

Delegate this step to the shared `block-diagram` skill. It owns the canonical D2 source, render, validation, and diagram-file delivery flow.

Diagram requirements:

- Base the diagram on the same corpus and `[R#]` references used in `findings.md`.
- Show how the strongest papers or paper families connect through evidence-backed relations only.
- Prefer compact family clusters when a flat per-paper graph would be noisy.
- Use a topic-derived slug such as `<topic-slug>-literature-map` under `diagrams/`.
- Prefer `png` as the primary delivered literature-map artifact.
- Keep `svg` as the editable or fallback artifact when PNG rendering is unavailable.

## Key Math Handling

- Extract at least 3 high-signal equations across the corpus when available.
- Write equations in plain-text markdown, not LaTeX blocks.
- Prefer ASCII-friendly notation that survives raw markdown: use forms like `sum_{i=1 to N}`, `E[...]`, `argmax`, `<=`, `>=`, and `^`.
- Use a consistent three-line pattern:
  - `Equation: <name> = <plain-text formula> [R#]`
  - `Where: <symbol> = <meaning>; ...`
  - `Interpretation: <role, assumptions, and trade-offs> [R#]`
- Explain variable meanings and assumptions.
- Tie each equation to a paper reference on the same line.

Example style:

```markdown
Equation: L(theta) = sum\_{i=1 to N} ell(f_theta(x_i), y_i) + lambda \* Omega(theta) [R4]
Where: f_theta = model with parameters theta; ell = per-example loss; Omega(theta) = regularizer; lambda = regularization weight.
Interpretation: Regularized empirical risk objective balancing data fit against model complexity [R4].
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
| --- | ----- | ------ | ------- | -------------------- | ------ |
| R1  | ...   | ...    | ...     | ...                  | ...    |

## Core Ideas and Concepts

Paragraph-level synthesis with inline refs [R1][R2].

## Key Math

Equation: <name> = <plain-text formula> [R#]
Where: <symbol> = <meaning>; ...
Interpretation [R3].

## Agreements and Conflicts

- Agreement: ... [R2][R5]
- Conflict: ... [R4][R6]

## Practical Takeaways

- Actionable implication 1 [R1][R7]
- Actionable implication 2 [R3][R8]

## References

| Ref | Title | Authors | Year | Provider ID | Source files                              |
| --- | ----- | ------- | ---- | ----------- | ----------------------------------------- |
| R1  | ...   | ...     | ...  | ...         | `meta/...json`, `pdf/...md`, `pdf/...pdf` |
```

Companion literature-map artifacts:

- `diagrams/<topic-slug>-literature-map.d2`
- `diagrams/<topic-slug>-literature-map.png`
- optional `diagrams/<topic-slug>-literature-map.svg`

## Final Chat Reply

After writing `findings.md`, return a short, friendly summary for the user-facing chat reply. Do not alter the `findings.md` format.

- Keep the reply concise, readable, and confident without sounding casual or sloppy.
- Light emoji use is allowed when it helps the user scan the result quickly.
- Include:
  - one direct-answer line
  - one corpus/method line with selected, downloaded, summarized, and failure counts
  - one short literature-map line explaining how the main papers or paper families connect
  - 3-4 cited takeaways or comparisons
  - one short limitations line when there are real coverage gaps or uncertainty
  - one closing line that points the user to `findings.md` for the full analysis
- Do not dump the whole evidence matrix or report body into chat.
- If the active channel supports returning files, return `findings.md` plus the PNG literature-map diagram after the summary. If PNG rendering is unavailable, return the SVG artifact instead.

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
- A PNG literature-map artifact exists, or an SVG fallback is returned when PNG rendering is unavailable, and the diagram only shows evidence-backed cross-paper connections.
