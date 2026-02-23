# OpenColab

OpenColab is a multi-agent AI research lab that combines a senior "Professor" agent with multiple high-capability "PhD Student" agents to explore AI architectures in parallel.

Each student agent gets GPU-backed execution capacity (Google Colab and/or remote SSH GPU nodes) to run experiments, while the professor agent provides strategy, critique, and scientific rigor. The system also generates submission-ready scientific paper drafts from validated results.

## Why OpenColab

- Increase research throughput with parallel hypothesis testing.
- Improve quality with adversarial review and replication gates.
- Build reusable research memory so insights compound over time.

## System Overview

1. You submit a focused research topic.
2. Professor agent defines objective, metrics, and constraints.
3. Student agents propose diverse hypotheses and experiment plans.
4. Experiments run in parallel on per-agent GPU runtimes (Colab or remote SSH).
5. Results are ingested, critiqued, and ranked by evidence quality.
6. The system produces a synthesis report, next-step plan, and submission-ready manuscript draft.

## Agent Roles

- Professor Agent: strategy, decomposition, critical review, portfolio decisions.
- PhD Student Agents: exploration, implementation, experimentation, analysis.
- Reviewer Agent (optional): replication and confound detection.
- Librarian Agent (optional): prior-art and benchmark retrieval.
- Writer Agent (optional): evidence-grounded manuscript drafting and formatting.
- Ops Agent (optional): run monitoring, retries, and artifact integrity.

## Recommended v1 Stack

- Python 3.12 + uv
- Pydantic
- FastAPI + Next.js
- LangGraph + Temporal
- LiteLLM Proxy
- PostgreSQL + pgvector
- Weights & Biases
- GCS/S3-compatible artifact storage
- LaTeX/Pandoc template pipeline for manuscript output
- Remote SSH GPU runner with preflight checks and job launcher
- OpenTelemetry + Prometheus + Grafana
- Kubernetes Jobs (scale-out path beyond Colab)

## 4-Week v1 Plan

- Week 1: contracts, storage, tracking, topic intake pipeline.
- Week 2: professor + 3 student agents, routing, durable workflows.
- Week 3: Colab + remote SSH execution adapters, checkpoint/resume, evaluation gate.
- Week 4: reviewer + writer agents, policy controls, dashboard, pilot end-to-end run, manuscript draft export.

## Current Repository

- `spec.md`: Full system specification (why, how, architecture, KPIs, rollout).
- `README.md`: Project overview and implementation direction.
- `LICENSE`: MIT license.

## Status

Specification-first project. Core codebase implementation is next.

## License

MIT. See `LICENSE`.
