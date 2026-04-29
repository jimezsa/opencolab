# ML/LLM Architecture Diagram Template

Use this template from the shared `block-diagram` skill when the user wants a detailed architecture diagram for a neural network, LLM, ML training pipeline, quantization flow, or model system. This is not a separate skill; it is an optional template that extends the base `block-diagram` workflow with a visual language tuned for technical ML diagrams.

## When to Use

- Neural network architecture overviews (encoder/decoder, transformer blocks, attention mechanisms)
- LLM architecture diagrams (token flow, embeddings, attention stacks, MoE routing, logits, decoding)
- Training pipeline diagrams (optimizers, schedulers, QAT, SWA, quantization)
- Model internals at any zoom level (full system, single block, single sub-layer)
- Quantization and post-training pipeline flows
- Any ML system diagram where the user wants an implementation-oriented architecture figure

## Relationship to block-diagram

This template **inherits** from the shared `block-diagram` skill:
- Uses the same `render_d2_diagram.sh` renderer
- Uses the same D2 engine (elk layout)
- Uses sketch-style rendering by default
- Follows the same validation checklist

This template **overrides or extends**:
- Color palette is specialized for ML component types
- Node shapes have semantic meaning for ML concepts
- Layout conventions are opinionated for transformer architectures
- Detail level guidance for multi-zoom diagrams

## Style Rules

### Direction

- Default: `direction: down` (top-to-bottom) for architecture flow
- Use `direction: right` only for flat pipeline stages (training, post-training)
- Use `direction: up` only for the minimal "paper figure" style (bottom-to-top like published diagrams)

### Color Palette

Five semantic colors, each tied to a specific role:

| Role | Fill | Stroke | Use for |
|------|------|--------|---------|
| **Input / Attention** | `#e8f1ff` | `#4c78a8` | Input nodes, embeddings, attention sub-blocks, Q/K/V projections |
| **Compute / FFN** | `#eef7ec` | `#4e9c68` | Encoder/decoder containers, MLP/FFN sub-blocks, forward passes |
| **State / Control** | `#fff4e5` | `#c17d11` | Residual anchors, skip connections, control parameters, diffusion auxiliary, learned gates |
| **Output / Head** | `#f5ecff` | `#7a52b3` | Final norm, output projection, logit softcap, loss nodes |
| **External / Infra** | `#f3f4f6` | `#6b7280` | Training config, optimizer details, annotation notes, weight banks |

Never mix roles. Every node gets exactly one semantic color based on what it *is*, not where it sits.

### Node Shapes

| Shape | D2 syntax | Use for |
|-------|-----------|---------|
| Rectangle (default) | _(none)_ | Most computation blocks |
| Circle | `shape: circle` | Residual addition nodes (`⊕` or `+`) |
| Diamond | `shape: diamond` | Loss functions (CE, MSE) |
| Parallelogram | `shape: parallelogram` | Raw inputs (tensors, IDs) |
| Stored data | `shape: stored_data` | Persistent state (residual anchors, skip stacks) |
| Hexagon | `shape: hexagon` | Gating / routing mechanisms (skip connections, MoE routers) |
| Page | `shape: page` | Annotation notes (not in the data flow) |
| Text | `shape: text` | Ellipsis / repetition markers (`⋮`) |

### Residual Connections

- Use small circle nodes labeled `⊕` for addition points
- Set `style.font-size: 20` on circle nodes so the symbol is visible
- Place residual bypass arrows on the **left side** of sub-blocks (not right)
- Use the compute color for residual circles inside compute containers

### Labels

- **Block labels**: Short noun phrase + key dimensions on a second line
  - Good: `"RMSNorm × 1/√(i+1)"`
  - Good: `"Linear Up: 512 → 2048\nfrom MLP Up bank[i]"`
  - Bad: `"This layer normalizes using root mean square"`
- **Container labels**: Role + layer range
  - Good: `Encoder — Layers 0–4 (sequential)`
  - Good: `"Auxiliary Latent Diffusion\n3% of steps, active 25%–60% wallclock"`
- **Edge labels**: Almost never. Unlabeled by default. Only label when the connection type is ambiguous.
- Use Unicode where it helps readability: `×`, `→`, `⊕`, `α`, `β`, `σ`, subscripts (`x₀`)

### Containers

- **Encoder/Decoder**: Use compute green, label with layer range
- **Attention sub-block**: Use input blue, nest inside encoder/decoder
- **MLP sub-block**: Use compute green, nest inside encoder/decoder
- **Training pipeline**: Use external gray, `direction: right`
- **Annotation blocks**: Use page shape + external gray, `style.font-size: 14`

### Multi-Zoom Diagrams

For complex architectures, produce two complementary diagrams:

1. **Overview** (~10-15 nodes): Shows the full system as collapsed containers. Each major subsystem is one or two nodes. Good for understanding the data flow at a glance.
2. **Full detail** (unlimited): Expands every sub-block with dimensions, init schemes, hyperparameters. Good for implementation reference.

The overview should be renderable as a standalone diagram. The detail diagram references the same component names so the two can be read together.

### Annotation Notes

For configuration details that don't belong in the data flow (batch config, dtype flow, gradient settings), use `shape: page` nodes with `style.font-size: 14` placed near the relevant section but not connected to the main flow.

## Workflow

### 1. Classify the request

Decide the zoom level:
- **Overview**: User wants a high-level view, paper figure, or first look
- **Detailed**: User wants implementation-level detail with dimensions and HPs
- **Block detail**: User wants a single block (e.g., one transformer layer) expanded
- **Pipeline**: User wants training/quantization/post-training flow

### 2. Normalize components

Before writing D2, list:
- Components and their semantic roles (determines color)
- Container hierarchy (max 3 levels)
- Data flow edges
- Annotation blocks needed

### 3. Write the D2 source

Write to `diagrams/<slug>.d2`. Follow all style rules above.

### 4. Render

```bash
bash projects/SKILLS/block-diagram/scripts/render_d2_diagram.sh \
  --input diagrams/<slug>.d2 \
  --svg diagrams/<slug>.svg \
  --png diagrams/<slug>.png
```

### 5. Validate

Use the shared `block-diagram` validation checklist, plus:
- Every node has exactly one semantic color
- Residual additions use circle `⊕` nodes
- Loss nodes use diamond shape
- Containers don't exceed 3 nesting levels
- Annotation notes use page shape and smaller font

### 6. Deliver

Return the diagram with a concise explanation. Emit `@telegram-file` directive when sending to Telegram.

## Canonical Assets

- Base skill doc: `projects/SKILLS/block-diagram/SKILL.md`
- Template: `projects/SKILLS/block-diagram/ml-llm-architecture-template.md`
- Shared renderer: `projects/SKILLS/block-diagram/scripts/render_d2_diagram.sh`
- Shared references: `projects/SKILLS/block-diagram/references/`
