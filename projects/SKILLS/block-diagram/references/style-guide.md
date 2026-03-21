# Style Guide

This skill optimizes for readable technical block diagrams, not decorative art.

## Default layout

- Direction: left to right.
- Layout engine: `elk`.
- Use one dominant flow direction per diagram.
- Split large architectures into multiple diagrams instead of forcing one dense canvas.

## Block naming

- Use nouns or short noun phrases for blocks.
- Keep labels between 1 and 4 words when possible.
- Preserve exact product, service, or model names when they matter.
- Avoid repeating the same prefix in every node if a container already gives the context.

Good:

- `Feature Encoder`
- `Queue`
- `Vector Store`
- `Rendered Output`

Bad:

- `This service receives requests from mobile clients`
- `Very Advanced Deep Neural Network Processor Block`

## Edge labeling

- Label only important flows.
- Use short payload or protocol labels.
- Prefer `HTTPS`, `events`, `embeddings`, `writes`, `predictions`, `frames`.
- Do not label every edge unless the diagram is specifically about protocols.

## Containers and grouping

- Use containers for subsystems, trust boundaries, or phases.
- Keep 2 to 6 blocks per container when possible.
- Do not nest deeply unless the hierarchy is essential.
- If there are more than 3 levels of hierarchy, the diagram probably needs to be split.

## Color semantics

Use restrained, consistent color meaning:

- inputs or clients: pale blue
- compute or transformation: pale green
- storage or state: pale amber
- outputs or presentation: pale violet
- external systems or third parties: light gray

Suggested palette:

- input/client: fill `#e8f1ff`, stroke `#4c78a8`
- compute: fill `#eef7ec`, stroke `#4e9c68`
- storage: fill `#fff4e5`, stroke `#c17d11`
- output: fill `#f5ecff`, stroke `#7a52b3`
- external: fill `#f3f4f6`, stroke `#6b7280`

Do not use many unrelated colors. Color should clarify structure, not decorate it.

## Readability thresholds

- Overview diagrams: aim for 6 to 12 blocks.
- If the first draft is more than about 15 blocks, consider splitting it.
- Avoid crossing arrows where possible.
- Avoid legends unless category colors or symbols genuinely need explanation.

## Audience tuning

- beginner: fewer blocks, plainer labels, stronger grouping
- engineer: normal detail, concrete component names
- executive: focus on major stages and business-relevant interfaces
- paper figure: clean labels, crisp pipeline flow, minimal prose
