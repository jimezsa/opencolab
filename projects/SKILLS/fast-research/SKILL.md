---
name: fast-research
description: Fast scientific paper scouting with papercli. Search, download, read, and produce a referenced markdown findings file with core ideas, concepts, and key math.
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

# Fast Research Skill

Use this skill for a rapid, evidence-grounded literature brief when the user needs quick scientific orientation without sacrificing traceability.

If the user later asks an exact follow-up question about one of the downloaded local papers, use `pageindex-grounded` for that bounded grounded retrieval step instead of treating this search workflow as the final QA layer.

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/fast-research/SKILL.md \
  -o SKILLS/fast-research/SKILL.md
```

## Mission

Given a research question, use `papercli` to:

1. Search relevant papers.
2. Download a focused core set of PDFs.
3. Read enough content to extract core ideas, concepts, and key equations.
4. Produce a detailed `findings.md` report inside the active research run folder, with inline references tied to exact papers.
5. Produce a companion literature-map block diagram that shows how the selected papers connect.

## Prerequisites

- `papercli` is installed and available in `PATH`.

## Required Inputs

- Research question or hypothesis.
- Optional scope constraints: years, domain, must-include authors, method family.

If inputs are missing, infer a minimal scope and proceed.

## Hard Requirements

- Always use `papercli` for retrieval (`search`, `info`, `download`).
- Download and read papers, not just metadata.
- Every factual claim must be grounded by references.
- Include key math when present in papers.
- Final output must be a markdown file named `findings.md` inside the active research run folder.
- Each distinct topic must live in its own dated, topic-slugged folder under `research/`.
- Maintain `research/INDEX.md` and the run-local `RUN.md` metadata file so later agents can recognize what each research folder contains.
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

## Topic-Scoped Research Workspace

Every run must use an active run root:

- New topic: `research/<YYYY-MM-DD>-<topic-slug>/`.
- Topic slug: lowercase ASCII, hyphenated, 3-8 meaningful words, and specific enough to distinguish the topic from nearby research.
- Collision rule: if the folder exists for different work, append `-2`, `-3`, or another short disambiguator.
- Continuation rule: reuse an existing folder only when the user asks to continue the same topic or the folder clearly matches the current request.
- Root catalog: update `research/INDEX.md` when the run starts and again when it finishes, is blocked, or is left partial.
- Run metadata: create and update `<RUN_ROOT>/RUN.md` with topic, question, skill, status, created/updated timestamps, corpus counts, generated artifact paths, and follow-up notes.

Recommended `research/INDEX.md` columns:

```markdown
| Folder | Skill | Topic | Status | Created | Updated | Corpus | Deliverables | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

Recommended `<RUN_ROOT>/RUN.md` headings:

```markdown
# Research Run: <topic>

## Metadata

- Skill: fast-research
- Status: in-progress
- Created:
- Updated:
- Topic slug:
- Question:

## Corpus

- Selected:
- Downloaded:
- Summarized:
- Failure events:

## Artifacts

- Findings:
- Literature map:
- Search files:
- Metadata:
- PDFs and summaries:

## Notes
```

## Workflow

### 1. Setup topic-scoped workspace

```bash
TOPIC_SLUG="<topic-slug>"
RUN_ROOT="research/$(date +%F)-${TOPIC_SLUG}"
mkdir -p "$RUN_ROOT"/{search,meta,pdf,diagrams}
printf "stage\tid\treason\n" > "$RUN_ROOT/meta/failures.tsv"
: > "$RUN_ROOT/meta/downloaded_ids.txt"
: > "$RUN_ROOT/meta/summarized_ids.txt"
```

Before retrieval, add or update the row for `$RUN_ROOT` in `research/INDEX.md` with status `in-progress`, and create or update `$RUN_ROOT/RUN.md`.

Initialize config when needed:

```bash
papercli config init
```

### 2. Run fast retrieval pass

Use one tight query and one alternate phrasing:

```bash
papercli search "<query>" \
  --provider all \
  --sort relevance \
  --limit 15 \
  --format json \
  --out "$RUN_ROOT/search/seed.json"

papercli search "<alternate query>" \
  --provider all \
  --sort date \
  --year-from <optional_year> \
  --limit 10 \
  --format json \
  --out "$RUN_ROOT/search/recency.json"
```

### 3. Select and enrich 3-6 papers

Prioritize relevance, recency, and diversity of approach.

```bash
jq -r '.[].id' "$RUN_ROOT/search/seed.json" "$RUN_ROOT/search/recency.json" | \
  awk 'NF && !seen[$0]++' | head -n 6 > "$RUN_ROOT/meta/selected_ids.txt"
```

For each selected paper, fetch metadata and PDF:

```bash
while read -r id; do
  safe_id="$(echo "$id" | tr '/:' '__')"

  if ! papercli info "$id" --provider all --format json --out "$RUN_ROOT/meta/${safe_id}.json"; then
    printf "info\t%s\tmetadata lookup failed\n" "$id" >> "$RUN_ROOT/meta/failures.tsv"
  fi

  if papercli download "$id" --provider all --out "$RUN_ROOT/pdf/${safe_id}.pdf"; then
    printf "%s\n" "$id" >> "$RUN_ROOT/meta/downloaded_ids.txt"
  else
    printf "download\t%s\tpdf download failed\n" "$id" >> "$RUN_ROOT/meta/failures.tsv"
  fi
done < "$RUN_ROOT/meta/selected_ids.txt"
```

### 4. Create agent-ready paper summaries

Delegate this step to the `paper-summary` skill. It owns the canonical summary schema, the Gemini-based batch runner, and the per-paper output contract.

Run the batch summarizer after PDFs and metadata are in place:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf-dir "$RUN_ROOT/pdf" \
  --metadata-dir "$RUN_ROOT/meta" \
  --summarized-ids "$RUN_ROOT/meta/summarized_ids.txt" \
  --failures-tsv "$RUN_ROOT/meta/failures.tsv" \
  --concurrency 10
```

Retry a single failed paper with:

```bash
python3 SKILLS/paper-summary/scripts/gemini_parallel_summary.py \
  --pdf "$RUN_ROOT/pdf/<safe_id>.pdf" \
  --metadata-dir "$RUN_ROOT/meta" \
  --summarized-ids "$RUN_ROOT/meta/summarized_ids.txt" \
  --failures-tsv "$RUN_ROOT/meta/failures.tsv"
```

Summary requirements:

- Use the canonical schema in `SKILLS/paper-summary/references/summary_schema.md`.
- Write each summary to `$RUN_ROOT/pdf/<safe_id>.md`, next to `$RUN_ROOT/pdf/<safe_id>.pdf`, unless an explicit output directory is needed.
- Read the PDF directly so figures, captions, tables, equations, and page anchors remain first-class evidence.
- Use metadata only as fallback and label it clearly.
- Record summary failures in `$RUN_ROOT/meta/failures.tsv` and continue processing the rest of the corpus.

### 5. Produce `findings.md`

Target quality: fast but technically useful.

- Include 3-6 referenced papers.
- Provide a compact synthesis of core ideas.
- Include at least 2 key equations from the corpus when available.
- Write math in plain-text markdown, not LaTeX blocks, so the file reads cleanly in raw form and can be parsed by downstream tools.
- Use the per-paper schemas in `$RUN_ROOT/pdf/` as the primary synthesis substrate.

### 6. Produce literature-map block diagram

Delegate this step to the shared `block-diagram` skill. It owns the canonical D2 source, render, validation, and diagram-file delivery flow.

Diagram requirements:

- Base the diagram on the same corpus and `[R#]` references used in `findings.md`.
- Show how the most relevant papers connect through evidence-backed relations only.
- Prefer compact paper-family clusters when a flat per-paper diagram would be noisy.
- Use a topic-derived slug such as `<topic-slug>-literature-map` under `$RUN_ROOT/diagrams/`.
- Prefer `png` as the primary delivered literature-map artifact.
- Keep `svg` as the editable or fallback artifact when PNG rendering is unavailable.

## Output Contract (`findings.md`)

Use this structure:

```markdown
# Findings: <topic>

## Scope

- Question: ...
- Coverage window: ...
- Selection criteria: ...
- Corpus stats: selected ..., downloaded ..., summarized ..., failure events ...

## Core Ideas

Claim with inline refs [R1][R3].
Claim with inline refs [R2].

## Key Concepts

- Concept A: definition and role [R1].
- Concept B: definition and trade-off [R2][R4].

## Key Math

Equation: <name> = <plain-text formula> [R3]
Where: <symbol> = <meaning>; ...
Meaning and why it matters [R3].

Equation: <name> = <plain-text formula> [R2]
Where: <symbol> = <meaning>; ...
Meaning and assumptions [R2].

## Paper Notes

### [R1] <title>

- Problem:
- Method:
- Main result:
- Limits:

### [R2] <title>

- Problem:
- Method:
- Main result:
- Limits:

## References

| Ref | Paper    | Provider ID  | Year | Evidence                  |
| --- | -------- | ------------ | ---- | ------------------------- |
| R1  | Title... | arxiv:...    | 2024 | `pdf/...md`, `pdf/...pdf` |
| R2  | Title... | semantic:... | 2023 | `pdf/...md`, `pdf/...pdf` |
```

Companion literature-map artifacts:

- `$RUN_ROOT/diagrams/<topic-slug>-literature-map.d2`
- `$RUN_ROOT/diagrams/<topic-slug>-literature-map.png`
- optional `$RUN_ROOT/diagrams/<topic-slug>-literature-map.svg`

## Final Chat Reply

After writing `$RUN_ROOT/findings.md`, return a short, friendly summary for the user-facing chat reply. Do not change the `findings.md` structure to match the chat reply.

- Keep the tone warm and readable, but still evidence-grounded.
- A small number of emojis is fine when it improves scanability. Prefer at most one emoji per line.
- Include:
  - one direct-answer line
  - one corpus-stats line with selected, downloaded, summarized, and failure counts
  - one short literature-map line explaining how the main papers or paper families connect
  - 2-3 short cited takeaways
  - one short limitation or uncertainty line when it materially affects confidence
  - one short closing line that points to `$RUN_ROOT/findings.md`
- Do not paste large chunks of `findings.md` into the chat reply.
- If the active channel supports returning files, return `findings.md` plus the PNG literature-map diagram after the summary. If PNG rendering is unavailable, return the SVG artifact instead.

## Referencing Rules

- Use `[R#]` inline citations in all analytical sections.
- Do not cite claims without evidence.
- For equation-based claims, cite the source paper on the same line.
- Keep quotes short; prefer paraphrase plus citation.

## Done Criteria

- `findings.md` exists and is detailed.
- Claims are referenced.
- Papers were downloaded and read.
- Each selected paper has an agent-ready summary in `$RUN_ROOT/pdf/` unless extraction failed.
- Selected, downloaded, and summarized counts reconcile with `$RUN_ROOT/meta/selected_ids.txt`, `$RUN_ROOT/meta/downloaded_ids.txt`, and `$RUN_ROOT/meta/summarized_ids.txt`, and failure events reconcile with `$RUN_ROOT/meta/failures.tsv`.
- Core ideas, concepts, and key math are covered.
- A PNG literature-map artifact exists, or an SVG fallback is returned when PNG rendering is unavailable, and the diagram only shows evidence-backed cross-paper connections.
- `research/INDEX.md` and `$RUN_ROOT/RUN.md` are updated with final status, corpus counts, artifact paths, and any limitations or next-step notes.
