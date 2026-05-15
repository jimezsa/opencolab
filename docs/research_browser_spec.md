# OpenColab Research Browser Spec

## 1. Purpose

Expose research artifacts produced by research-class skills (deep-research, fast-research, pro-research, paper-summary, pageindex-grounded, and any future siblings) in the OpenColab Studio web interface, grouped by research run, with inline preview of PDFs and Markdown.

The browser is read-only in the first milestone. It is a new surface inside the existing web interface defined in `docs/web_interface_spec.md`, not a separate app.

## 2. Scope

### In scope

- Discover research runs at two locations: project-level and agent-level
- Group all artifacts of a run (findings, PDFs, summaries, diagrams, pageindex output, metadata) under one navigable unit
- Render `findings.md` and per-paper `.md` summaries inline (Markdown)
- Render downloaded PDFs inline (page navigation + zoom only)
- Render diagrams (PNG/SVG) inline
- Show parsed `RUN.md` frontmatter and link back to the source skill
- Surface in-progress runs (status badge + lightweight polling)

### Out of scope (first milestone)

- Writing, deleting, archiving, or renaming runs from the UI
- Re-running a research skill from the UI
- Full-text search across runs
- Cross-project aggregation outside a single repo
- Editing `findings.md` or any artifact
- Rendering JSON tree files (`pageindex/trees/*.json`) — list only

## 3. Storage model — where research lives

Research runs may exist at **two levels** in the tree. Both must be browsable.

### 3.1 Project-level

```
projects/<project>/research/
  INDEX.md
  <YYYY-MM-DD>-<topic-slug>/
    findings.md
    RUN.md
    pdf/
    meta/
    search/
    diagrams/
    pageindex/        (optional)
```

Used when research is owned by the project as a whole, or produced by skills invoked outside any single agent.

### 3.2 Agent-level

```
projects/<project>/AGENTS/<agent>/research/
  INDEX.md
  <YYYY-MM-DD>-<topic-slug>/
    ... (same layout as 3.1)
```

Used when an agent runs its own research and the outputs are part of that agent's memory/working set. Each agent has an independent `INDEX.md`.

### 3.3 Resolution rule

When a skill runs, it must pick exactly one location:

- If `OPENCOLAB_ACTIVE_AGENT` is set, write under `projects/<project>/AGENTS/<agent>/research/`
- Otherwise write under `projects/<project>/research/`

The web interface does not enforce this; it discovers whatever exists. But the contract keeps the skill side simple.

### 3.4 Nested-project edge case

The current tree allows an agent to have its own nested project (`projects/<project>/AGENTS/<agent>/projects/<sub>/`). The browser scans **one level** of agent nesting only — `AGENTS/*/research/`. Deeper recursion is out of scope; nested projects are surfaced through the existing project switcher, not by this browser.

## 4. On-disk contract

These contracts must be honored by every research skill. Updates to `AGENTS.md` will reflect them.

### 4.1 `RUN.md`

Frontmatter-first so the server can parse without scraping prose:

```yaml
---
skill: deep-research
topic: "diffusion model schedulers"
question: "What scheduler tradeoffs matter for low-step inference?"
status: running | complete | failed | abandoned
created: 2026-05-15T10:32:00Z
updated: 2026-05-15T11:04:00Z
corpus:
  papers: 12
  summaries: 11
  diagrams: 2
deliverables:
  - findings.md
  - diagrams/lit-map.png
---
```

The body below the frontmatter is free-form notes for humans.

### 4.2 `INDEX.md`

Markdown table, one row per run, columns in this fixed order:

`Folder | Skill | Topic | Status | Created | Updated | Corpus | Deliverables | Notes`

The server parses this table when present and uses it as the source of truth for the run list. When absent or malformed, the server falls back to directory scanning.

### 4.3 Folder naming

`<YYYY-MM-DD>-<topic-slug>` where `topic-slug` is lowercased, hyphenated, ASCII-only, ≤ 60 chars. The date is the local creation date; collisions append `-2`, `-3`, …

### 4.4 Artifact placement inside a run

- PDFs: `pdf/<safe_id>.pdf`
- Per-paper summary: colocated `pdf/<safe_id>.md` (same basename as the PDF)
- Diagrams: `diagrams/*.{png,svg,d2}` — PNG preferred for inline render, SVG fallback
- Metadata: `meta/*.json|tsv|txt`
- Search results: `search/*.json`
- PageIndex output: `pageindex/trees/<safe_id>.json`, `pageindex/manifest.json`, `pageindex/answers/<date>-<topic>.md`

Skills must not write outside the run folder (no stray paths to `~/Downloads`, etc.).

## 5. Backend

### 5.1 Placement

New module: `src/web/server/research.ts`, sibling of `src/web/server/artifacts.ts`. Routes are mounted by `src/web/server/index.ts`. Shared DTOs go in `src/web/shared/types.ts`.

### 5.2 DTOs

```ts
WebResearchScope = "project" | "agent"

WebResearchRun = {
  id: string                // "<scope>:<project>:<agent?>:<folder>"
  scope: WebResearchScope
  projectId: string
  agentId?: string          // only for scope="agent"
  folder: string            // "<YYYY-MM-DD>-<topic-slug>"
  skill: string
  topic: string
  question?: string
  status: "running" | "complete" | "failed" | "abandoned" | "unknown"
  created?: string
  updated?: string
  corpus: { papers: number; summaries: number; diagrams: number }
  deliverables: string[]    // relative paths inside the run folder
  findingsPath?: string
  path: string              // absolute path to run folder, used by /file
}

WebResearchFile = {
  path: string              // relative to run folder
  kind: "pdf" | "markdown" | "image-png" | "image-svg" | "json" | "text" | "other"
  size: number
  modified: string
  pairedSummary?: string    // for PDFs, the colocated .md if present
}

WebResearchRunDetail = WebResearchRun & {
  tree: WebResearchFile[]
  runMd: { frontmatter: object; body: string }
}
```

### 5.3 Endpoints (all under `/api/web`, read-only)

| Method | Path | Returns |
|---|---|---|
| GET | `/projects/:projectId/research` | `WebResearchRun[]` (project + all agents, sorted by `updated` desc) |
| GET | `/projects/:projectId/research/:runId` | `WebResearchRunDetail` |
| GET | `/projects/:projectId/research/:runId/file?path=<rel>` | streamed bytes with correct `Content-Type` |
| GET | `/agents/:agentId/research` | convenience filter; same shape as project list, scope="agent" only |

The `:runId` is opaque to clients (matches `WebResearchRun.id`). The server resolves it back to a filesystem path internally.

### 5.4 Path-traversal guard

`/file?path=<rel>` must resolve the final absolute path and assert it starts with the run folder's absolute path. Reject `..`, absolute paths, and symlinks that escape the run folder. Reject any extension not in the allowlist (`.pdf`, `.md`, `.png`, `.svg`, `.json`, `.txt`, `.csv`, `.tsv`, `.d2`).

### 5.5 Content types

- `.pdf` → `application/pdf`
- `.md` → `text/markdown; charset=utf-8`
- `.png` / `.svg` → matching image types
- `.json` → `application/json`
- everything else allowed → `text/plain; charset=utf-8`

### 5.6 Caching

Use `ETag` from `(size, mtimeMs)` and respond `304` on match. Run-list and run-detail responses can use `Cache-Control: no-cache` since polling is expected.

### 5.7 In-progress runs

A run with `status: running` may be missing files. The server still returns it; `corpus` counts reflect what is on disk now. Clients poll the detail endpoint every ~5s while status is `running`.

## 6. Frontend

### 6.1 Routes

Two entry points, one shared underlying component:

| Route | Source | Shows |
|---|---|---|
| `/projects/:projectId/research` | project-level + agent-level merged | all runs in a project, with a "scope" filter chip (All / Project / Agent: X) |
| `/projects/:projectId/agents/:agentId/research` | agent-level only | runs owned by one agent |
| `/projects/:projectId/research/:runId` | run detail | viewer pane |

The agent detail page (`/projects/:projectId/agents/:agentId`) gains a **Research** tab that embeds the agent-scoped list.

### 6.2 List view layout

- Card grid, newest first
- Card shows: skill badge (color per skill), topic, status pill, scope badge (Project / Agent: name), created → updated, corpus counts (📄 papers, 📝 summaries, 🖼 diagrams)
- Filters: scope, skill, status, date range
- Empty state: link to `AGENTS.md` section on research skills

### 6.3 Detail view layout

Three-pane:

- **Left** (~22%): file tree of the run folder. Sections: Findings, PDFs, Summaries, Diagrams, PageIndex, Metadata. PDFs and their colocated `.md` summaries group as a single row with two tabs (PDF | Summary).
- **Center** (~58%): viewer for the currently selected file.
- **Right** (~20%): parsed `RUN.md` frontmatter as a key/value table, plus the free-form body rendered as Markdown. "Open findings" jump button. "Show in artifacts" link to the existing flat artifacts view, pre-filtered.

Header strip: breadcrumbs (Project › Research › Run topic), status pill, "Refresh" button.

### 6.4 Selection state in URL

Selected file path is a query string on the detail route: `?file=pdf/arxiv__2501.01234.pdf`. Deep-linking must work; reload must restore the same file in the viewer.

## 7. Viewers

### 7.1 Markdown

- Library: `react-markdown` + `remark-gfm` + `rehype-highlight`
- Rewrite relative links and images so `findings.md` references like `diagrams/foo.png` resolve through `/api/web/projects/:projectId/research/:runId/file?path=diagrams/foo.png`
- Absolute external links open in a new tab
- Cross-run references are left as plain text (not resolved) in this milestone

### 7.2 PDF

- Library: `react-pdf` (wraps `pdfjs-dist`)
- pdfjs worker served as a static asset from the Vite client build
- Controls: prev/next page, page number jump, zoom (50% / 75% / 100% / fit-width / fit-page)
- Lazy-render: only the current page plus one ahead
- Large-file guard: PDFs over 50 MB show a "Download" button instead of inline render

### 7.3 Images

- PNG / JPEG: `<img>` against the file endpoint
- SVG ≤ 100 KB: inlined; larger SVGs render via `<img>`

### 7.4 JSON

- Listed but not opened in this milestone. Selecting renders "Open in editor" with a copy-path button.

## 8. Discovery & indexing

### 8.1 Scan rules

When `GET /projects/:projectId/research` is hit:

1. If `projects/<project>/research/INDEX.md` exists, parse the table → project-scoped runs.
2. Otherwise scan `projects/<project>/research/*/` directories that match `^\d{4}-\d{2}-\d{2}-.+`.
3. For each `projects/<project>/AGENTS/<agent>/`, repeat steps 1-2 against that agent's `research/`.
4. For each run folder, read `RUN.md` frontmatter for status/counts. If `RUN.md` is missing, fall back to counting files in `pdf/`, `diagrams/`, presence of `findings.md`.
5. Sort by `updated` desc, then `created` desc.

### 8.2 Performance

- Scan must complete in < 250 ms for a project with 100 runs containing 50 PDFs each. Achieved by reading only directory entries + `RUN.md`, never opening PDFs.
- Cache results in-memory keyed by `(projectId, dir mtime)`; invalidate on mtime change.

### 8.3 Errors

Malformed `RUN.md` or `INDEX.md` does not fail the whole list. The offending run is returned with `status: "unknown"` and a `warnings: string[]` field (added to the DTO). The list view shows a small warning icon on the card.

## 9. Skill-side updates required

To support this browser without breaking existing skill behavior:

- **deep-research, fast-research, pro-research**: emit `RUN.md` with the frontmatter in §4.1; append to the scope-appropriate `INDEX.md`.
- **paper-summary**: continue colocating `.md` next to `.pdf`; bump `corpus.summaries` in the parent run's `RUN.md` on completion.
- **pageindex-grounded**: write under `<run>/pageindex/` (already specified); update `corpus` counts in `RUN.md`.
- **All**: respect `OPENCOLAB_ACTIVE_AGENT` for path resolution (§3.3).

These changes are documented in a new "Research output contract" section of `AGENTS.md` (lines ~49-77 area).

## 10. Non-goals & explicit decisions

- No SQLite / database for research metadata. The filesystem + `INDEX.md` is the source of truth. Revisit if scan time crosses 1 s.
- No websocket push for in-progress updates. Polling is sufficient at expected scale.
- No bulk download (zip a whole run). Defer to a later milestone.
- No editing. Read-only forever in this surface; mutations live in CLI / skills.
- No write of `INDEX.md` from the server. Only skills write it.

## 11. Implementation order

1. Lock the on-disk contract: update `AGENTS.md` with §4 and §3.3.
2. Backend: `research.ts`, list endpoint, scan + cache. Wire into `src/web/server/index.ts`.
3. Frontend: list route at `/projects/:projectId/research`, no viewer yet. Validates end-to-end.
4. Backend: detail + file endpoints, path-traversal guard.
5. Frontend: detail route, file tree, Markdown viewer (`react-markdown`).
6. Frontend: PDF viewer (`react-pdf` + worker), image viewer.
7. Agent-scoped routes + Research tab on agent detail page.
8. Polling for in-progress runs, status badges, warnings surface.
9. Skill-side updates (one PR per skill) to honor §4 strictly.
10. Documentation: append a "Research" section to `docs/web_interface_spec.md` referencing this spec.

## 12. Open questions

- **Cross-project view**: should there be a top-level `/research` route aggregating across projects in the repo? Current consensus: no in milestone 1; nested under project is consistent with the rest of Studio. Reopen if users ask.
- **Search**: full-text search across `findings.md` is desirable but expensive without an index. Defer until a research corpus is large enough to justify it.
- **Permissions**: today the gateway is loopback-only and there is no auth. If the gateway ever binds non-loopback, the `/file` endpoint becomes the highest-risk surface and must gain auth before that change ships.
