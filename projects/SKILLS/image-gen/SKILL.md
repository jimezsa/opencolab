---
name: image-gen
description: Generate and edit images from prompts and optional reference images with Google Gemini (Nano Banana 2.1) or OpenAI GPT Image 2.6, using the model chosen in ignite (IMAGE_GEN_MODEL) and API keys from .env.local.
homepage: https://aistudio.google.com/docs/image-generation
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

# Image Generation Skill

Use this skill when the user wants image generation or image editing, especially for:

- paper architecture diagrams,
- figure redraws and cleanups,
- annotated illustrations,
- posters, covers, assets, and product shots,
- edits to an existing image while preserving the important parts,
- animated GIFs or SVG vector output (OpenAI models only).

For deterministic block diagrams, prefer the `block-diagram` skill; use this skill when free-form rendering is what the user wants.

## Models

The model comes from `IMAGE_GEN_MODEL` in `.env.local`, which the user picks in `opencolab ignite`. If it is not set, the default is `gemini-nano-banana-2.1`. Only pass `--model` when the user asks for a specific model or a cheaper/faster run.

| Model | Provider | Key | Use it for |
| --- | --- | --- | --- |
| `gemini-nano-banana-2.1` | Gemini | `GEMINI_API_KEY` | Default. Newest Nano Banana: strong text rendering, multi-turn consistency, 1K/2K/4K, Google Search grounding. |
| `gemini-3-pro-image` | Gemini | `GEMINI_API_KEY` | Nano Banana Pro: complex instructions and high-fidelity assets. |
| `gemini-3.1-flash-lite-image` | Gemini | `GEMINI_API_KEY` | Fastest and cheapest Gemini drafts. |
| `gpt-image-2.6-sunburst` | OpenAI | `OPENAI_API_KEY` | Newest ChatGPT image model, quality tier: detailed work, edit consistency, SVG export, animated GIFs. |
| `gpt-image-2.6-flare` | OpenAI | `OPENAI_API_KEY` | Newest ChatGPT image model, fast tier for quick iteration. |

The script picks the provider from the model name: `gpt-image-*` and `chatgpt-image-*` call OpenAI, everything else calls Gemini.

## Mission

Given a prompt and zero or more reference images:

1. Generate a new image or edit an existing one with the configured model.
2. Save every returned image locally.
3. Save any accompanying model text next to the image outputs.
4. Keep the workflow deterministic and scriptable from the terminal.

## Prerequisites

- `python3` is installed and available in `PATH`.
- The SDK for the selected provider is installed:

```bash
python3 -m pip install google-genai   # Gemini models
python3 -m pip install openai         # OpenAI models
```

- The matching API key (`GEMINI_API_KEY` or `OPENAI_API_KEY`) is set in the environment or `.env.local`. ChatGPT/Codex OAuth login does not cover the OpenAI image API; it needs `OPENAI_API_KEY`.
- Network access is available when the request runs.

## Hard Requirements

- Use `projects/SKILLS/image-gen/scripts/image_gen.py` for the API call so model and key loading stay consistent with the repo.
- Do not override the configured model unless the user explicitly asks for a different one.
- Save generated images in the current project folder under `images/`, not under `artifacts/`.
- If the generated image should be sent back to Telegram, emit a raw `@telegram-file {"kind":"photo","file":"<path>","caption":"optional"}` line on its own line after generation. Do not wrap it in backticks or code fences. Keep the JSON on one line, keep `kind` as `photo` (never `image`/`png`/`jpg`), and on Windows write the path with forward slashes. Send animated GIFs with `kind` `animation` and SVG files with `kind` `document`.
- For edits, pass the existing image with `--input` and tell the model exactly what must stay unchanged.
- For diagrams, specify the layout, labels, arrow directions, grouping, legend, and aspect ratio explicitly.
- When exact text matters, write the exact text in the prompt and keep it short.
- Do not assume the model inferred the paper structure correctly if the diagram is research-critical; inspect the generated image afterward.
- If the script exits with a missing-key or missing-package error, tell the user exactly which key or package is missing instead of switching providers silently.

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

Generate a new image with the configured model:

```bash
python3 projects/SKILLS/image-gen/scripts/image_gen.py \
  --prompt "Create a conference-paper style architecture diagram for a monocular 3D reconstruction pipeline with clearly labeled modules, arrows, and a small legend." \
  --aspect-ratio 16:9 \
  --image-size 2K \
  --output-prefix images/mono3d-diagram
```

Edit an existing image:

```bash
python3 projects/SKILLS/image-gen/scripts/image_gen.py \
  --prompt "Edit the provided figure into a polished academic diagram. Keep the layout and labels semantically equivalent, but clean the typography, spacing, arrow routing, and color hierarchy." \
  --input assets/rough-diagram.png \
  --aspect-ratio 16:9 \
  --output-prefix images/rough-diagram-polished
```

Use multiple references:

```bash
python3 projects/SKILLS/image-gen/scripts/image_gen.py \
  --prompt "Create a product hero image using the bottle from the first reference and the packaging language from the second reference. Keep the bottle shape faithful to the original." \
  --input references/bottle.png \
  --input references/box.png \
  --aspect-ratio 4:5 \
  --output-prefix images/product-hero
```

Use Google Search grounding when real-world accuracy matters (Gemini models):

```bash
python3 projects/SKILLS/image-gen/scripts/image_gen.py \
  --prompt "Create an editorial-style travel poster for Berlin using accurate landmark details and current visual references." \
  --google-search \
  --aspect-ratio 3:4 \
  --image-size 2K \
  --output-prefix images/berlin-poster
```

Use OpenAI-only output options (transparent PNG, animated GIF, SVG):

```bash
python3 projects/SKILLS/image-gen/scripts/image_gen.py \
  --model gpt-image-2.6-sunburst \
  --prompt "A flat vector logo of a lab flask with a leaf, two colors, no text." \
  --output-format svg \
  --background transparent \
  --quality high \
  --output-prefix images/lab-logo
```

### Options by provider

- Both: `--prompt`/`--prompt-file`, `--input` (repeatable), `--model`, `--aspect-ratio`, `--output-prefix`, `--retries`.
- Gemini only: `--image-size` (`1K`, `2K`, `4K`), `--google-search`, `--image-only`.
- OpenAI only: `--size` (`auto`, `1024x1024`, `1536x1024`, `1024x1536`), `--quality` (`auto`, `low`, `medium`, `high`, `xhigh`, `max`), `--background` (`auto`, `transparent`, `opaque`), `--output-format` (`png`, `jpeg`, `webp`, `gif`, `svg`), `--count` (1-10).
- With OpenAI models, `--aspect-ratio` maps to the closest standard size (square, 1536x1024 landscape, or 1024x1536 portrait) unless `--size` is set.
- Options for the other provider are ignored with a warning, so the same command keeps working when the configured model changes.

### 3. Review outputs

- The script saves generated images as `<output-prefix>_01.<ext>`, `<output-prefix>_02.<ext>`, and so on.
- Any model text (Gemini commentary or OpenAI revised prompts) is saved as `<output-prefix>.txt`.
- A machine-readable run summary is saved as `<output-prefix>.json`.
- Without `--output-prefix`, outputs go to `images/image-gen-<timestamp>_*`.
- If the first result is close but not correct, rerun with the previous output as a new `--input` and tighten the prompt.

## Output Contract

- One or more local image files.
- Optional accompanying text file if the model returns text alongside the image.
- One JSON summary describing the provider, model, prompt, inputs, options, and saved outputs.

## Canonical Assets

- Skill doc: `projects/SKILLS/image-gen/SKILL.md`
- Python runner: `projects/SKILLS/image-gen/scripts/image_gen.py`
