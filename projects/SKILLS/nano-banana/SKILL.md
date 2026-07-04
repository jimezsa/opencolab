---
name: nano-banana
description: Generate and edit images with Google Gemini Nano Banana Pro from prompts and optional reference images, using GEMINI_API_KEY from .env.local when available.
homepage: https://ai.google.dev/gemini-api/docs/image-generation
metadata:
  {
    "opencolab":
      {
        "emoji": "🖼️",
        "os": ["linux", "darwin"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# Nano Banana Pro Skill

Use this skill when the user wants image generation or image editing with Google Gemini, especially for:

- paper architecture diagrams,
- figure redraws and cleanups,
- annotated illustrations,
- posters, covers, assets, and product shots,
- edits to an existing image while preserving the important parts.

This skill defaults to Nano Banana Pro (`gemini-3-pro-image-preview`), which Google documents as the professional image model for complex instructions and high-fidelity asset production.

## Mission

Given a prompt and zero or more reference images:

1. Generate a new image or edit an existing one with Gemini.
2. Save every returned image locally.
3. Save any accompanying model text next to the image outputs.
4. Keep the workflow deterministic and scriptable from the terminal.

## Prerequisites

- `python3` is installed and available in `PATH`.
- `google-genai` is installed:

```bash
python3 -m pip install google-genai
```

- Network access is available when the Gemini request runs.

## Hard Requirements

- Use `projects/SKILLS/nano-banana/scripts/nano_banana.py` for the API call so key loading stays consistent with the repo.
- Default to `gemini-3-pro-image-preview` unless the user explicitly wants a cheaper or faster model.
- Save generated images in the current project folder under `images/`, not under `artifacts/`.
- If the generated image should be sent back to Telegram, emit a raw `@telegram-file {"kind":"photo","file":"<path>","caption":"optional"}` line on its own line after generation. Do not wrap it in backticks or code fences. Keep the JSON on one line, keep `kind` as `photo` (never `image`/`png`/`jpg`), and on Windows write the path with forward slashes.
- For edits, pass the existing image with `--input` and tell the model exactly what must stay unchanged.
- For diagrams, specify the layout, labels, arrow directions, grouping, legend, and aspect ratio explicitly.
- When exact text matters, write the exact text in the prompt and keep it short.
- Do not assume the model inferred the paper structure correctly if the diagram is research-critical; inspect the generated image afterward.

## Workflow

### 1. Write a concrete prompt

Good prompts for this skill are explicit about:

- subject,
- composition,
- style,
- required labels/text,
- what to preserve,
- what to change,
- output format or aspect ratio.

Useful prompt patterns:

- Paper architecture diagram:
  `Create a clean research-paper architecture diagram on a white background. Show the pipeline as five left-to-right blocks with arrows between them: Input Image, Feature Encoder, Multi-Scale Fusion, 3D Reconstruction Head, Rendered Output. Use concise academic figure styling, thin gray arrows, blue highlight for the main module, and exact labels in a modern sans-serif font. Add a small legend in the lower-right corner.`
- Edit an image:
  `Edit the provided image. Keep the framing, subject identity, and overall lighting unchanged. Replace the background with a clean studio backdrop, add a subtle shadow, and preserve the original object proportions.`
- Redraw a rough figure:
  `Use the provided sketch as structure reference only. Redraw it as a polished conference-paper figure with consistent spacing, aligned labels, clear arrows, and export-ready visual quality.`

### 2. Run the script

Generate a new image:

```bash
python3 projects/SKILLS/nano-banana/scripts/nano_banana.py \
  --prompt "Create a conference-paper style architecture diagram for a monocular 3D reconstruction pipeline with clearly labeled modules, arrows, and a small legend." \
  --aspect-ratio 16:9 \
  --image-size 2K \
  --output-prefix images/mono3d-diagram
```

Edit an existing image:

```bash
python3 projects/SKILLS/nano-banana/scripts/nano_banana.py \
  --prompt "Edit the provided figure into a polished academic diagram. Keep the layout and labels semantically equivalent, but clean the typography, spacing, arrow routing, and color hierarchy." \
  --input assets/rough-diagram.png \
  --aspect-ratio 16:9 \
  --image-size 2K \
  --output-prefix images/rough-diagram-polished
```

Use multiple references:

```bash
python3 projects/SKILLS/nano-banana/scripts/nano_banana.py \
  --prompt "Create a product hero image using the bottle from the first reference and the packaging language from the second reference. Keep the bottle shape faithful to the original." \
  --input references/bottle.png \
  --input references/box.png \
  --aspect-ratio 4:5 \
  --image-size 2K \
  --output-prefix images/product-hero
```

Use Google Search grounding when real-world accuracy matters:

```bash
python3 projects/SKILLS/nano-banana/scripts/nano_banana.py \
  --prompt "Create an editorial-style travel poster for Berlin using accurate landmark details and current visual references." \
  --google-search \
  --aspect-ratio 3:4 \
  --image-size 2K \
  --output-prefix images/berlin-poster
```

### 3. Review outputs

- The script saves generated images as `<output-prefix>_01.<ext>`, `<output-prefix>_02.<ext>`, and so on.
- Any model text is saved as `<output-prefix>.txt`.
- A machine-readable run summary is saved as `<output-prefix>.json`.
- If the first result is close but not correct, rerun with the previous output as a new `--input` and tighten the prompt.

## Output Contract

- One or more local image files.
- Optional accompanying text file if Gemini returns text alongside the image.
- One JSON summary describing the model, prompt source, inputs, and saved outputs.

## Canonical Assets

- Skill doc: `projects/SKILLS/nano-banana/SKILL.md`
- Python runner: `projects/SKILLS/nano-banana/scripts/nano_banana.py`
