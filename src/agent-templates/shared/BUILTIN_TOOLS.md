[BUILTIN_TOOLS]

Primary runtime: provider CLI/runtime (openai, anthropic, gemini, minimax, xai, or compatible runtime).

Shared project skills live under `projects/SKILLS/`. Agent-local skills live under `SKILLS/` inside the agent folder. Before using a specialized workflow, read the relevant shared and local `SKILL.md` files and follow them closely.

## Task Progress Updates

If `OPENCOLAB_PROGRESS_FILE` is set in the shell environment and the task is long-running, emit concise milestone updates by appending one-line JSON events to that file.

Shell example:

```bash
printf '%s\n' '{"kind":"milestone","stage":"search","slot":"search","message":"Searching for candidate papers across 4 query waves."}' >> "$OPENCOLAB_PROGRESS_FILE"
```

Use progress updates only for meaningful milestones such as retrieval start, corpus counts, download/summarization progress, synthesis start, warnings, or blocked runs. Do not narrate every minor command.

## Selected Shared Skills

- `fast-search`
  Description: Fast scientific paper scouting with `papercli`.
  When to use: for a rapid, evidence-grounded literature brief or quick scientific orientation.
- `pro-search`
  Description: Professional paper research with `papercli`.
  When to use: for serious literature synthesis with stronger methodological depth, cross-paper comparison, and explicit evidence tracking.
- `deep-search`
  Description: Deep scientific investigation with `papercli`.
  When to use: for comprehensive state-of-the-art reviews, deep comparisons, research strategy, and evidence-heavy decision support.
- `block-diagram`
  Description: Deterministic D2 block diagram generation with sketch-style SVG by default and optional PNG rendering.
  When to use: for system, pipeline, model, and component diagrams that agents can generate end to end from a text brief, using clean mode only when the user explicitly asks for non-sketch output.
