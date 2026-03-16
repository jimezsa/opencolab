# Paper Extraction Schema: <Paper Title>

Rules:

- Keep the section order unchanged for deterministic parsing.
- Ingest the PDF directly first so figures, tables, captions, and layout remain available.
- Anchor each section to observable PDF evidence such as figures, captions, equations, tables, and appendix material.
- Record exact figure, table, equation, algorithm, and page anchors whenever available. If you cannot locate one, write `Anchor not located in available evidence.`.
- Use metadata only as fallback and label it clearly.
- Do not invent equations, datasets, metrics, links, or foundation papers.
- If evidence is missing, write `Not clearly stated in available evidence.`.
- If a statement is an inference rather than an explicit claim, label it `Inference from available evidence: ...`.

## 1. The Why (Motivation & Core Problem)

- The Problem: What specific limitation in existing research or technology is this paper trying to solve? Keep this to 1-2 sentences.
- The Core Idea: What is the authors' main hypothesis or novel approach to solving this problem?
- Evidence Anchors: Exact page, figure, table, or equation anchors supporting the problem framing.

## 2. Main Architecture (Mathematical Formalization)

Agent instruction: Extract the core methodology and represent it as a rigorous mathematical specification, not just a loose sketch. The goal is to let a technically strong reader recover the method, tensors, transformations, objectives, and execution order from this section alone. Write equations in Markdown using fenced `math` blocks so they remain readable in raw `.md` and machine-extractable.
The architecture is often communicated most clearly in PDF pictures such as pipeline figures, block diagrams, method overviews, and annotated visual layouts. Inspect those images directly and use them as primary evidence when reconstructing the model or algorithm flow.
The main architecture can often be extracted directly from the architecture image or pipeline diagram in the paper.
If the method is explained primarily through a figure or diagram, use the PDF figure as evidence and translate it into equations and ordered data flow.
If the paper has no learnable architecture (for example a survey, benchmark, theorem, dataset, or systems paper), replace this section with `Algorithm / theorem / protocol flow` and formalize the central steps instead.
Use `Loss / Optimization: Not applicable.` when no training objective exists.
Formatting rules for this section:

- Start with a brief `Notation / Symbols` block that defines the main variables, tensors, sets, graphs, latent states, or sequences, including dimensions, domains, or indexing when the paper provides them.
- Separate `Training-Time Flow` and `Inference-Time Flow` when the paper uses different procedures, losses, sampling strategies, decoding rules, or refinement stages.
- Use a short label such as `Input`, `Forward Pass`, `Update Rule`, `Objective`, or `Algorithm Step k` before each math block.
- Put each standalone equation or tightly related equation group in its own fenced `math` block.
- Use inline math such as `$X$` only for short variable mentions inside sentences or bullets.
- Prefer aligned multi-line math when the paper presents a sequence, derivation, or factorized objective.
- Include intermediate representations, normalization steps, residual paths, attention/message-passing equations, decoding rules, and post-processing steps when they materially affect the method.
- When the paper provides dimensions, shapes, complexity, constraints, masking rules, or probabilistic factorization, include them explicitly instead of paraphrasing them away.
- Decompose the objective into named sub-losses, regularizers, constraints, priors, or auxiliary terms, and state how they combine.
- State the optimization target and, when available, the update rule, sampling rule, beam search rule, diffusion schedule, EM step, or iterative refinement step.
- If the paper presents pseudocode, an algorithm box, or a theorem statement, convert it into ordered mathematical steps with variable updates and stopping criteria.
- Keep notation faithful to the paper; if you rename a symbol for clarity, say `Inference from available evidence: renamed ... for consistency.`.
- Do not paste raw LaTeX delimiters like `\[` or `\]` directly into prose outside a fenced `math` block.
- If some mathematical detail is omitted in the paper, say exactly which part is underspecified rather than filling it in from prior knowledge.

Recommended extraction order for this section:

- `Notation / Symbols`
- `Input`
- `Preprocessing / Encoding`
- `Core Transformation(s)`
- `Prediction / Decoding`
- `Loss / Optimization`
- `Inference / Sampling / Decision Rule`
- `Algorithm / theorem / protocol flow` when the paper is not centered on a learnable model

Notation / Symbols:

```math
X \in \mathbb{R}^{B \times T \times d}, \quad
M \in \{0,1\}^{B \times T}, \quad
Y \in \mathcal{Y}
```

Input:

```math
X = \text{...}
```

Preprocessing / Encoding:

```math
Z_0 = \phi_{\text{enc}}(X)
```

Core Transformation(s):

```math
\begin{aligned}
H_1 &= f_{\text{module\_1}}(Z_0) \\
H_2 &= f_{\text{module\_2}}(H_1) \\
\hat{Y} &= f_{\text{head}}(H_2)
\end{aligned}
```

Loss / Optimization:

```math
\mathcal{L}_{\text{total}} = \lambda_1 \mathcal{L}_{\text{task}} + \lambda_2 \mathcal{L}_{\text{reg}}
```

Inference / Sampling / Decision Rule:

```math
\hat{y} = \arg\max_{y \in \mathcal{Y}} p_{\theta}(y \mid X)
```

Evidence Anchors: Exact figure, equation, algorithm, and page anchors used for this formalization.

## 3. The Why of the Architecture (Component Rationale)

Agent instruction: For every variable and function defined in Section 2, explain exactly why it was chosen or designed that way.
If Section 2 is non-architectural, explain why each algorithmic step, theorem component, protocol stage, or evaluation stage exists instead of model modules.

- $X$: Why is the input represented this way?
- $f_{\text{module\_1}}$: Why use this specific module?
- $f_{\text{module\_2}}$: Why is this step necessary?
- $f_{\text{head}}$: Why this prediction head?
- $\mathcal{L}_{\text{task}}$: Why this task objective?
- $\mathcal{L}_{\text{reg}}$: Why use this specific regularizer?
- Evidence Anchors: Exact page, figure, or appendix anchors supporting the rationale.

## 4. Metrics & Evaluation

- Datasets Used: List the primary benchmarks.
- Key Metrics: How is success quantified?
- The Result: One sentence summarizing the paper's main performance claim.
- Visual Evidence: Note the key figure, table, or ablation that best supports the reported result when one is clearly present.
- Evidence Anchors: Exact table, figure, ablation, and page anchors supporting the reported results.

## 5. Relevant Links & Knowledge Anchors

- Project Page / GitHub: Link if available in the paper or metadata.
- Core Foundation Paper: The 1 or 2 most relied-upon prior papers, if the dependency is clear from the text.
- Evidence Anchors: Exact reference numbers, appendix pages, or metadata fields used to identify these links and foundation papers.

Summary requirements:

- Keep the section order unchanged.
- Express the main method as Markdown-native math: use fenced `math` blocks for standalone equations and inline math for short symbol references.
- Structure Section 2 as labeled math steps so both humans and parsers can recover notation, shapes or domains, transformations, objectives, and inference rules.
- Make Section 2 rigorous enough that a reader could reconstruct the core computation graph or algorithmic procedure without needing the original prose paragraph.
- If no learnable architecture exists, switch Section 2 to `Algorithm / theorem / protocol flow` and write `Loss / Optimization: Not applicable.` instead of inventing modules.
- Explain why each Section 2 variable, module, and loss term exists.
- Preserve figure/table evidence when it carries the method, mechanism, or strongest empirical support.
- Record exact evidence anchors in each section.
- Label missing evidence explicitly instead of guessing.
- Mark inferred statements as `Inference from available evidence: ...`.
