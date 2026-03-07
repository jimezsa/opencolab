---
name: fast-search
description: Fast scientific paper scouting with papercli. Search, download, read, and produce a referenced markdown findings file with core ideas, concepts, and key math.
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

# Fast Search Skill

Use this skill for a rapid, evidence-grounded literature brief when the user needs quick scientific orientation without sacrificing traceability.

## Update This Skill

Only do this if the user explicitly asks to update this skill from the GitHub repo.

To refresh this skill directly from the GitHub repo:

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/papercli/main/SKILLS/fast-search/SKILL.md \
  -o SKILLS/fast-search/SKILL.md
```

## Mission

Given a research question, use `papercli` to:
1. Search relevant papers.
2. Download a focused core set of PDFs.
3. Read enough content to extract core ideas, concepts, and key equations.
4. Produce a detailed `findings.md` report with inline references tied to exact papers.

## Prerequisites

- `papercli` is installed and available in `PATH`.
- Optional provider keys:
  - `PAPERCLI_SEMANTIC_API_KEY`
  - `PAPERCLI_SERPAPI_KEY`
- If keys are missing, continue with `arxiv` coverage and document the reduced coverage.

## Required Inputs

- Research question or hypothesis.
- Optional scope constraints: years, domain, must-include authors, method family.

If inputs are missing, infer a minimal scope and proceed.

## Hard Requirements

- Always use `papercli` for retrieval (`search`, `info`, `download`).
- Download and read papers, not just metadata.
- Every factual claim must be grounded by references.
- Include key math when present in papers.
- Final output must be a markdown file named `findings.md`.

## Workflow

### 1. Setup workspace

```bash
mkdir -p research/{search,meta,pdf,text,notes}
```

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
  --out research/search/seed.json

papercli search "<alternate query>" \
  --provider all \
  --sort date \
  --year-from <optional_year> \
  --limit 10 \
  --format json \
  --out research/search/recency.json
```

### 3. Select and enrich 3-6 papers

Prioritize relevance, recency, and diversity of approach.

```bash
jq -r '.[].id' research/search/seed.json research/search/recency.json | \
  awk 'NF && !seen[$0]++' | head -n 6 > research/meta/selected_ids.txt
```

For each selected paper, fetch metadata and PDF:

```bash
while read -r id; do
  safe_id="$(echo "$id" | tr '/:' '__')"
  papercli info "$id" --provider all --format json --out "research/meta/${safe_id}.json" || true
  papercli download "$id" --provider all --out "research/pdf/${safe_id}.pdf" || true
done < research/meta/selected_ids.txt
```

### 4. Extract readable text from PDFs

Preferred extractor:

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

- If `pdftotext` is unavailable, try another local PDF-to-text method (for example a Python reader).
- If extraction still fails, keep the paper in references and mark it as metadata-only evidence.

### 5. Produce `findings.md`

Target quality: fast but technically useful.

- Include 3-6 referenced papers.
- Provide a compact synthesis of core ideas.
- Include at least 2 key equations from the corpus when available.

## Output Contract (`findings.md`)

Use this structure:

```markdown
# Findings: <topic>

## Scope
- Question: ...
- Coverage window: ...
- Selection criteria: ...

## Core Ideas
Claim with inline refs [R1][R3].
Claim with inline refs [R2].

## Key Concepts
- Concept A: definition and role [R1].
- Concept B: definition and trade-off [R2][R4].

## Key Math
\[
<equation>
\]
Meaning and why it matters [R3].

\[
<equation>
\]
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
| Ref | Paper | Provider ID | Year | Evidence |
|---|---|---|---|---|
| R1 | Title... | arxiv:... | 2024 | PDF text (`research/text/...`) |
| R2 | Title... | semantic:... | 2023 | PDF text (`research/text/...`) |
```

## Referencing Rules

- Use `[R#]` inline citations in all analytical sections.
- Do not cite claims without evidence.
- For equation-based claims, cite the source paper on the same line.
- Keep quotes short; prefer paraphrase plus citation.

## Done Criteria

- `findings.md` exists and is detailed.
- Claims are referenced.
- Papers were downloaded and read.
- Core ideas, concepts, and key math are covered.
