---
name: block-diagram
description: Generate accurate, readable D2 block diagrams for software, research, and system explanations from a text brief. Normalize components and edges, write a canonical .d2 source file, render compact sketch-style SVG and optional PNG artifacts by default, support optional LaTeX equation blocks when the diagram genuinely needs them, keep arrows unlabeled unless a label adds concrete meaning, and emit Telegram file directives when needed.
homepage: https://github.com/terrastruct/d2
metadata:
  {
    "opencolab":
      {
        "emoji": "🧱",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["d2", "bash"] },
        "install":
          [
            {
              "id": "install-script",
              "kind": "shell",
              "script": "curl -fsSL https://d2lang.com/install.sh | sh -s --",
              "bins": ["d2"],
              "label": "Install D2 with the official install script",
            },
            {
              "id": "homebrew",
              "kind": "shell",
              "script": "brew install d2",
              "bins": ["d2"],
              "label": "Install D2 with Homebrew",
            },
          ],
      },
  }
---

# Block Diagram Skill

Use this skill when the user wants a block diagram that explains a system, model, pipeline, service, architecture, or workflow.

This is the deterministic path for architecture visuals in OpenColab. The source of truth is a D2 file, not an image-generation prompt. The default rendered style is D2 sketch mode, which gives a hand-drawn look while keeping the diagram deterministic and editable. Diagrams should stay compact, and arrows should remain unlabeled unless the label carries specific technical meaning.

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
- Optional must-include formulas or equations.
- Optional preferred output name.
- Optional render style: `sketch` or `clean`.

If the user does not provide an audience, assume `engineer`.
If the user does not provide an output name, derive a short slug from the system name.
If the user does not provide a render style, use `sketch`.

## Hard Requirements

- Use this skill for block diagrams instead of defaulting to a free-form image model.
- Treat the `.d2` file as the canonical artifact and the rendered image as a derived artifact.
- Do not invent components, edges, protocols, or subsystems that were not implied by the request.
- Support optional formula blocks with `equation: |latex` only when a mathematically important transformation, loss, or objective would be materially harder to understand without an explicit equation.
- Do not generate a formula just because the request mentions math, a model, or an algorithm; include one only when the diagram would otherwise lose important meaning.
- If one ambiguity blocks a faithful diagram, ask one targeted question. Otherwise proceed autonomously.
- Keep the first diagram readable and compact. If the architecture is too dense, split it into an overview diagram plus one focused detail diagram.
- Use `references/style-guide.md` for layout, color semantics, naming, and grouping rules.
- Use `references/patterns.md` when selecting the diagram structure.
- Use `ml-llm-architecture-template.md` as an optional template for detailed ML, LLM, neural-network, transformer, training, or quantization architecture diagrams.
- Use `references/validation.md` before returning the final result.
- Use `scripts/render_d2_diagram.sh` to format, validate, and render the final diagram.
- Default to sketch-style rendering. Only switch to clean rendering when the user explicitly asks for a polished, paper-ready, or non-sketch output.
- Default to unlabeled arrows. Add edge labels only when they convey specific information such as a protocol, artifact, or payload that the arrow alone would not communicate.
- Never use generic edge labels such as `input`, `output`, `data`, `result`, `something input`, or `something output`.
- OpenColab normally provides `OPENCOLAB_PROGRESS_FILE` during provider runs. When it is set and the task is long enough to justify updates, emit bounded JSON progress events for normalization, draft completion, render start, warnings, blockers, or final artifact creation when they help the user understand real progress.
- If the rendered artifact should be sent to Telegram, emit a raw `@telegram-file {"kind":"document","file":"diagrams/<slug>.svg","caption":"optional"}` or `@telegram-file {"kind":"photo","file":"diagrams/<slug>.png","caption":"optional"}` line on its own line with no backticks or code fences.
- If PNG rendering is unavailable in the current environment, fall back to the SVG artifact and send it as a Telegram document instead of pretending the PNG exists.

## Workflow

### 1. Normalize the architecture

Translate the request into this internal structure before drawing:

- title
- audience
- diagram scope
- layout direction
- render style
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

- default to the smallest readable flow direction; use left-to-right for broad systems and top-down for long pipelines or repeated blocks when that keeps the canvas smaller
- keep labels short and concrete
- use containers for subsystems
- keep related nodes close and avoid stretched connections when a tighter readable layout is possible
- prefer unlabeled edges
- label only edges whose labels add concrete meaning
- never use filler labels like `input`, `output`, `data`, or `result`
- preserve exact component names when the user cares about wording
- when a formula is truly necessary, represent it as a dedicated node with a short title and an `equation: |latex` body instead of cramming math into a normal label
- let the renderer control sketch versus clean styling unless the request needs D2 source-level style overrides

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
- The default render style is `sketch`.
- The renderer uses compact spacing by default to reduce unnecessary whitespace and long connections.
- Use `--style clean` only when the user explicitly asks for a polished, paper-style, or non-sketch diagram.
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
- ML/LLM architecture template: `projects/SKILLS/block-diagram/ml-llm-architecture-template.md`
- Validation checklist: `projects/SKILLS/block-diagram/references/validation.md`
