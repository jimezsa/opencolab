---
name: block-diagram
description: Generate accurate, readable D2 block diagrams for software, research, and system explanations from a text brief. Normalize components and edges, write a canonical .d2 source file, render SVG and optional PNG artifacts, and emit Telegram file directives when needed.
metadata:
  {
    "opencolab":
      {
        "emoji": "🧱",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["d2", "bash"] },
      },
  }
---

# Block Diagram Skill

Use this skill when the user wants a clean block diagram that explains a system, model, pipeline, service, architecture, or workflow.

This is the deterministic path for architecture visuals in OpenColab. The source of truth is a D2 file, not an image-generation prompt.

## Mission

Given a textual architecture description:

1. Normalize it into components, groups, and directed relationships.
2. Write a canonical `diagrams/<slug>.d2` source file.
3. Render `diagrams/<slug>.svg`.
4. Render `diagrams/<slug>.png` when the user wants a raster image or when the result should be sent back to Telegram.
5. Return a short explanation of the diagram and any important assumptions.

## Prerequisites

- `d2` is installed and available in `PATH`.
- `bash` is available in `PATH`.
- The working directory is writable.

## Required Inputs

- A system or architecture description.
- Optional audience: beginner, engineer, executive, paper figure, infra team, and so on.
- Optional must-include components, flows, or labels.
- Optional preferred output name.

If the user does not provide an audience, assume `engineer`.
If the user does not provide an output name, derive a short slug from the system name.

## Hard Requirements

- Use this skill for block diagrams instead of defaulting to a free-form image model.
- Treat the `.d2` file as the canonical artifact and the rendered image as a derived artifact.
- Do not invent components, edges, protocols, or subsystems that were not implied by the request.
- If one ambiguity blocks a faithful diagram, ask one targeted question. Otherwise proceed autonomously.
- Keep the first diagram readable. If the architecture is too dense, split it into an overview diagram plus one focused detail diagram.
- Use `references/style-guide.md` for layout, color semantics, naming, and grouping rules.
- Use `references/patterns.md` when selecting the diagram structure.
- Use `references/validation.md` before returning the final result.
- Use `scripts/render_d2_diagram.sh` to format, validate, and render the final diagram.
- If `OPENCOLAB_PROGRESS_FILE` is set and the task is long enough to justify milestones, emit bounded progress updates for normalization, draft completion, render start, and final artifact creation.
- If the rendered artifact should be sent to Telegram, emit a raw `@telegram-file {"kind":"document","file":"diagrams/<slug>.svg","caption":"optional"}` or `@telegram-file {"kind":"photo","file":"diagrams/<slug>.png","caption":"optional"}` line on its own line with no backticks or code fences.
- If PNG rendering is unavailable in the current environment, fall back to the SVG artifact and send it as a Telegram document instead of pretending the PNG exists.

## Workflow

### 1. Normalize the architecture

Translate the request into this internal structure before drawing:

- title
- audience
- diagram scope
- layout direction
- containers or subsystems
- blocks inside each container
- directed edges
- optional legend categories
- optional assumptions

If helpful, write this structure as scratch notes in your reasoning, but the final artifacts must be the `.d2` file and rendered outputs.

### 2. Choose the diagram pattern

Pick one dominant pattern from `references/patterns.md`:

- pipeline
- layered system
- client-server
- event-driven or queue-based
- training/inference split
- overview plus detail split

Do not mix several patterns unless the system genuinely needs it.

### 3. Write the D2 source

Create `diagrams/<slug>.d2`.

Before writing, read:

- `references/style-guide.md`
- `references/d2-quick-reference.md`

Requirements for the D2 source:

- default to left-to-right flow
- keep labels short and concrete
- use containers for subsystems
- label only important edges
- preserve exact component names when the user cares about wording

### 4. Render the diagram

Run the canonical renderer:

```bash
bash projects/SKILLS/block-diagram/scripts/render_d2_diagram.sh \
  --input diagrams/<slug>.d2 \
  --svg diagrams/<slug>.svg \
  --png diagrams/<slug>.png
```

Notes:

- The renderer formats and validates the D2 source before rendering.
- The default layout engine is `elk`.
- SVG is the default deliverable.
- PNG is optional, but recommended for Telegram delivery when raster export works in the current environment.
- If PNG rendering fails, keep the SVG, mention the limitation briefly, and return or send the SVG as a document.

### 5. Validate and revise once

Use `references/validation.md`.

If the diagram fails the checklist, revise the `.d2` file once and rerender before replying.

### 6. Return the result

Return:

- the artifact paths
- a concise caption or explanation
- any assumptions that materially affected the diagram

If the request is for Telegram delivery, emit the raw `@telegram-file` directive after rendering.

## Output Contract

- `diagrams/<slug>.d2`
- `diagrams/<slug>.svg`
- optional `diagrams/<slug>.png`
- a short explanation of what the diagram shows

## Canonical Assets

- Skill doc: `projects/SKILLS/block-diagram/SKILL.md`
- Renderer: `projects/SKILLS/block-diagram/scripts/render_d2_diagram.sh`
- D2 quick reference: `projects/SKILLS/block-diagram/references/d2-quick-reference.md`
- Style guide: `projects/SKILLS/block-diagram/references/style-guide.md`
- Patterns: `projects/SKILLS/block-diagram/references/patterns.md`
- Validation checklist: `projects/SKILLS/block-diagram/references/validation.md`
