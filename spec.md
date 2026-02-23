# Multi-Agent AI Research Lab Specification

**Status:** Draft v1
**Date:** February 23, 2026
**Audience:** Founder, research leads, engineering team
**Co-authors:**

- Gemini CLI, interactive CLI agent
- Codex (GPT-5), AI coding and research assistant
- Claude Opus 4.6 (Anthropic), AI architecture and systems design

## 1. Why Build This

AI research speed is limited by serial thinking, inconsistent rigor, and compute bottlenecks.
This system is designed to solve that by combining:

- A **Professor Agent** (high experience, strategic judgment, critical review).
- Multiple **PhD Student Agents** (high intelligence, parallel hypothesis generation and experimentation).
- Dedicated **GPU-enabled execution slots** (Google Colab and remote SSH GPU nodes) per student agent.
- **Full computer-use workspaces** where each agent can operate a desktop environment, browse the web, take screenshots, and interact with tools like a human researcher.

### Core Value Proposition

- Increase idea throughput by running many research paths in parallel.
- Preserve quality through centralized critique and methodology control.
- Convert exploration into reproducible knowledge, not just one-off experiments.
- Enable agents to use any research tool a human would — browsers, notebooks, terminals, visualization software — through computer-use capabilities.

## 2. Vision

Create an autonomous research lab where you provide a topic (for example, a new model architecture or training method), and the system:

1. Designs a research program.
2. Spawns coordinated agent teams with isolated workspaces.
3. Agents read relevant papers, discuss ideas, and challenge each other.
4. Runs experiments on GPU resources with full desktop control.
5. Critiques results with scientific discipline through structured debate.
6. Produces ranked conclusions and next-step plans.
7. Generates a submission-ready scientific manuscript package.

## 3. Scope

### In Scope

- Multi-agent coordination (Professor + PhD students).
- Research topic decomposition into hypotheses and experiment plans.
- **Inter-agent communication:** structured channels for idea sharing, debate, and peer feedback.
- **Computer-use agent workspaces:** each agent gets a sandboxed desktop environment with browser, terminal, file system, and screenshot capabilities.
- **Literature review pipeline:** agents can search, read, summarize, and cite papers from the web.
- Experiment execution pipeline with Google Colab and remote SSH GPU access.
- Result logging, comparison, and iterative improvement loops.
- Reproducibility and decision traceability.
- Scientific manuscript drafting from validated research outputs.

### Out of Scope (for v1)

- Frontier-scale pretraining infrastructure.
- Automatic paper submission to venues without human author approval.
- Human-free safety sign-off for high-risk experiments.

## 4. Design Principles

- **Parallel by default:** many independent hypothesis tracks run concurrently.
- **Collaboration over isolation:** agents share findings, challenge each other, and build on peer work.
- **Critique before commitment:** no result is accepted without adversarial review.
- **Reproducibility over novelty theater:** every claimed win must be rerunnable.
- **Budget-aware intelligence:** compute is allocated by expected information gain.
- **Model-agnostic architecture:** plug in best available agents over time.
- **Full autonomy within guardrails:** agents control their own machines but operate within policy boundaries.
- **Human-in-the-loop by design:** operators can pause, redirect, or override critical decisions.

## 5. Role Architecture

### 5.1 Professor Agent (PI)

Primary function: guidance, research strategy, and critical thinking.

The professor is not the smartest agent in the lab. Student agents are selected to be the "smartest" entities, exploring architectures with superior raw problem-solving and coding capabilities. The professor's value is in **strategic coherence, methodological discipline, and adversarial critique** — the same role a senior PI plays in academia.

Responsibilities:

- Translate user topic into a measurable research objective.
- Conduct initial literature survey to ground the research program in prior art.
- Define evaluation protocol and success criteria.
- Assign subproblems to student agents with clear scope and constraints.
- Challenge weak assumptions and methodological flaws.
- Facilitate structured debates between students with divergent findings.
- Decide when to pivot, continue, or terminate tracks.
- Publish a final synthesis memo and ranked next experiments.

### 5.2 PhD Student Agents (N agents, parallel)

Primary function: deep exploration, creative ideation, and experiment execution.

These are the lab's strongest problem-solvers. Each student operates with high autonomy inside an isolated workspace.

Responsibilities:

- Search and read relevant papers from arXiv, Semantic Scholar, Google Scholar, and other sources.
- Propose novel hypotheses and architecture variants grounded in literature.
- Build experiment plans with baselines and ablations.
- Run GPU experiments in assigned execution slots (Colab or remote SSH nodes).
- Use their computer-use workspace to write code, run notebooks, visualize results, debug training runs, and take screenshots of outputs.
- Analyze outputs and submit evidence-backed findings.
- Share intermediate results with peer students and respond to their critiques.
- Self-critique and respond to professor objections.

### 5.3 Optional Supporting Agents (Recommended)

- **Librarian Agent:** paper search, retrieval, summarization, and prior-art mapping. Maintains a shared literature database accessible to all agents.
- **Reviewer Agent:** adversarial replication and leakage detection.
- **Ops Agent:** runtime monitoring, retry, checkpoint integrity, artifact collection.
- **Writer Agent:** transforms validated outputs into venue-ready manuscript drafts.

## 6. Inter-Agent Communication Protocol

Agents in this lab are not siloed workers dispatched by a central controller. They are a **collaborative research team** that communicates, debates, and builds on each other's work.

### 6.1 Communication Channels

- **Broadcast channel:** professor posts directives, milestones, and portfolio updates visible to all agents.
- **Peer-to-peer channels:** student agents can send findings, questions, and suggestions directly to specific peers.
- **Discussion threads:** structured debate threads on specific hypotheses or conflicting results, visible to all participants and the professor.
- **Shared knowledge board:** a persistent, queryable store where any agent can post insights, negative results, useful references, or reusable code snippets.

### 6.2 Communication Primitives

Each message in the system carries:

- **Sender** and **recipient(s)** (or broadcast flag).
- **Message type:** directive, finding, question, critique, suggestion, status-update.
- **Reference links:** pointers to experiment IDs, paper DOIs, artifact URIs, or prior messages.
- **Confidence level:** self-assessed confidence (for findings and claims).
- **Timestamp** and **thread ID** for conversation tracking.

### 6.3 Structured Collaboration Patterns

- **Idea-sharing round:** after initial hypothesis generation, students present their approaches to the group. The professor and peers provide feedback before experiments begin.
- **Cross-pollination:** when one student discovers a useful technique or negative result, it is posted to the shared board so others can adapt their approaches.
- **Conflict resolution:** when two students produce contradictory results, the professor opens a structured debate thread, requests additional evidence, and adjudicates.
- **Peer review:** before any finding is promoted to a conclusion, at least one other student agent must attempt to replicate or critically evaluate it.

## 7. Agent Workspaces and Computer-Use Capabilities

Each PhD student agent is provisioned with a **sandboxed desktop workspace** — a full computing environment that the agent controls through computer-use APIs.

### 7.1 Workspace Components

Each agent workspace includes:

- **Virtual desktop:** a containerized Linux desktop environment (for example, via Docker + VNC/noVNC or a cloud desktop service).
- **Browser:** for reading papers, accessing documentation, searching the web, and interacting with Colab notebooks.
- **Terminal:** full shell access for running scripts, managing files, and SSH-ing into GPU nodes.
- **Code editor:** for writing and editing experiment code.
- **File system:** isolated persistent storage for code, data, configs, and results.
- **Jupyter environment:** for interactive experimentation and visualization.

### 7.2 Computer-Use API

Agents interact with their workspace through a computer-use interface that supports:

- **Screenshot capture:** take a screenshot of the current desktop, browser, or application state.
- **Mouse and keyboard control:** click, type, scroll, drag — enabling agents to interact with any GUI application.
- **Clipboard operations:** copy/paste between applications.
- **File upload/download:** move files between the workspace and the shared artifact store.
- **Process management:** launch, monitor, and kill processes.

This capability is critical because many research tools (visualization dashboards, Colab notebooks, profiling tools, GPU monitoring) are designed for human GUI interaction. Computer-use lets agents operate these tools natively.

### 7.3 Workspace Lifecycle

- **Provisioning:** when a student agent is assigned an experiment, the system spins up an isolated workspace with the required dependencies pre-installed.
- **Snapshotting:** workspace state can be snapshotted and restored for reproducibility or debugging.
- **Teardown:** after experiment completion and artifact extraction, the workspace is cleaned up. Persistent artifacts are moved to the shared registry.
- **Sharing:** an agent can grant temporary read-only access to its workspace for peer review or professor inspection.

### 7.4 Security and Isolation

- Each workspace runs in a sandboxed container with no network access to other agent workspaces (communication goes through the message bus only).
- Outbound network access is allowed for: research paper sites, package repositories, GPU node SSH, and approved APIs.
- No workspace has access to the control plane credentials or other agents' secrets.
- All workspace actions are logged for audit.

## 8. Literature Review and Web Research

Agents are not limited to pre-loaded knowledge. They actively search and read from the open web.

### 8.1 Paper Discovery

- **Search APIs:** arXiv API, Semantic Scholar API, Google Scholar (via scraping or SerpAPI).
- **Citation graph traversal:** given a seed paper, agents can follow references and citing papers to map the landscape.
- **Keyword and topic monitoring:** the librarian agent (or students directly) can set up alerts for new papers on relevant topics.

### 8.2 Paper Processing Pipeline

1. **Retrieve:** download PDF or access HTML version.
2. **Parse:** extract text, figures, tables, and equations (using tools like GROBID, Nougat, or marker).
3. **Summarize:** generate structured summaries (objective, method, key results, limitations).
4. **Index:** store in the shared literature database with embeddings for semantic search.
5. **Cite:** when referencing a paper in findings or manuscripts, the system links to the indexed source.

### 8.3 Web Research Beyond Papers

Agents can also:

- Read blog posts, technical reports, and documentation.
- Browse GitHub repositories for reference implementations.
- Access benchmark leaderboards and dataset documentation.
- Search Stack Overflow, forums, and discussion threads for debugging help.

All web-sourced information is tagged with provenance (URL, access timestamp, retrieval method).

## 9. High-Level System Architecture

### 9.1 Control Plane

- Topic intake and objective definition.
- Task decomposition and assignment.
- Policy enforcement (budget, guardrails, stop criteria).
- Global memory and experiment registry.
- Human intervention queue and approval state machine.

### 9.2 Agent Plane

- Professor Agent orchestration loop.
- PhD Student Agent execution loops.
- Reviewer/Librarian loops (if enabled).
- **Inter-agent message bus** for all communication channels.

### 9.3 Workspace Plane

- Agent workspace provisioning and lifecycle management.
- Computer-use API gateway (screenshot, input, process control).
- Workspace snapshotting and restore.
- Network policy enforcement per workspace.

### 9.4 Compute Plane

- Per-agent runtime allocation across Google Colab and remote SSH GPU nodes.
- Data/artifact storage (checkpoints, logs, metrics, reports).
- Failure recovery and resume logic.

### 9.5 Evaluation Plane

- Baseline comparison engine.
- Statistical validation and significance checks.
- Reproducibility verification.
- Leaderboard and evidence-weighted ranking.

### 9.6 Publication Plane

- Manuscript assembly (IMRaD structure and venue template formatting).
- Auto-generation of figures/tables from tracked experiment artifacts.
- Citation management with source verification.
- Reproducibility appendix packaging (configs, seeds, compute details).

### 9.7 Human Oversight Plane

- Role-based approvals for budget, safety-sensitive runs, and major claim promotion.
- Manual pause/resume/terminate controls at experiment, agent, and program levels.
- Intervention event logging with rationale, actor identity, and timestamp.
- Escalation rules when automated confidence drops below thresholds.

## 10. End-to-End Workflow

1. **Topic Submission:** user submits a focused research question.
2. **Literature Survey:** librarian and professor survey existing work to identify gaps and baselines.
3. **Program Design:** professor defines objective, constraints, metrics, milestones.
4. **Hypothesis Drafting:** each student reads relevant papers and proposes independent approach families.
5. **Idea-Sharing Round:** students present hypotheses to the group; professor and peers provide feedback.
6. **Portfolio Selection:** professor selects diversified high-value experiments.
7. **Human Checkpoint A:** operator approves portfolio, budget allocation, and risk class.
8. **Workspace Provisioning:** each student gets an isolated workspace with required tools and GPU access.
9. **Execution Run:** each student launches experiments in their workspace, using computer-use to interact with notebooks, terminals, and visualization tools.
10. **Cross-Pollination:** students share intermediate findings on the shared board; peers adapt.
11. **Result Ingestion:** metrics, artifacts, screenshots, and notes are registered automatically.
12. **Critical Review:** professor and reviewer challenge claims; peer students attempt replication.
13. **Human Checkpoint B:** operator approves which claims can be promoted to conclusions.
14. **Iteration Loop:** spawn follow-up ablations/refinements where evidence is strongest.
15. **Synthesis:** final report with what worked, what failed, and what to run next.
16. **Paper Drafting:** writer agent composes manuscript from validated evidence.
17. **Submission Package:** system exports submission-ready files for human author sign-off.

## 11. Hybrid GPU Provisioning Strategy (Colab + Remote SSH)

### 11.1 Resource Model

- One runtime slot per active student agent, mapped to either Colab or a remote SSH GPU node.
- Agents connect to their GPU runtime from within their workspace (via browser for Colab, via SSH for remote nodes).
- Soft and hard runtime budgets per agent (time + total GPU hours).
- Priority queue for high-expected-value experiments.

### 11.2 Reliability Requirements

- Frequent checkpointing to persistent storage.
- Auto-resume after runtime disconnection/preemption.
- Deterministic seed logging for reruns.
- Runtime health checks and retry policy.
- SSH heartbeat checks and host capability validation before launch.

### 11.3 Operational Constraints to Design Around

- Colab session time limits and occasional disconnects.
- Variable GPU availability/type across both providers.
- Ephemeral local runtime state on Colab.
- Heterogeneous remote SSH environments (drivers/CUDA/library drift).
- Network connectivity and credential reliability for SSH execution.

The system must treat all runtimes as potentially transient and preserve progress externally.

## 12. Experiment Contract (Mandatory Standard)

Each experiment must include:

- Hypothesis statement.
- Baseline and expected improvement target.
- Dataset/version and split definition.
- Architecture/training configuration.
- Metrics (primary and secondary).
- Ablation plan.
- Stopping criteria.
- Reproducibility recipe.
- Literature references supporting the approach.
- Exportable artifacts for publication figures and tables.

Any run missing this contract is not eligible for portfolio decisions.

## 13. Memory and Knowledge Management

### 13.1 Research Memory

- Topic graph (question -> hypotheses -> experiments -> outcomes).
- Decision log (why experiments were accepted/rejected).
- Failure archive (negative results to avoid repeated dead ends).

### 13.2 Shared Literature Database

- Indexed paper summaries with semantic search via embeddings.
- Citation graph linking papers to experiments that reference them.
- Annotation layer where agents can tag papers with relevance scores, key takeaways, and critiques.

### 13.3 Artifact Registry

- Config snapshots.
- Model checkpoints.
- Training/eval logs.
- Generated reports, critiques, and workspace screenshots.

### 13.4 Retrieval Requirements

- Agents must retrieve prior similar experiments before proposing new runs.
- Agents must search the literature database for relevant papers before designing new approaches.
- Professor must see confidence intervals, not only point improvements.

## 14. Intelligence Strategy: "Most Intelligent Agents"

Do not lock the lab to one model/provider.
Instead, maintain a **capability routing layer**:

- Use strongest long-context reasoning models for professor/reviewer roles.
- Use strongest coding/research execution models for student roles.
- Use models with best computer-use capabilities for workspace interaction.
- Periodically benchmark available agents on:
  - hypothesis quality,
  - experimental rigor,
  - computer-use task completion accuracy,
  - literature comprehension and synthesis quality,
  - reproducibility quality,
  - cost per validated insight.

Routing decisions should be benchmark-driven, not brand-driven.

### 14.1 Model Capability Matrix

Maintain a live capability matrix mapping agent roles to model requirements:

| Role        | Key Capabilities Required                                       |
| ----------- | --------------------------------------------------------------- |
| Professor   | Long-context reasoning, strategic planning, critical evaluation |
| PhD Student | Coding, math, computer-use, creativity, paper comprehension     |
| Librarian   | Information retrieval, summarization, citation accuracy         |
| Reviewer    | Adversarial reasoning, statistical literacy, replication design |
| Writer      | Scientific writing, figure/table generation, LaTeX fluency      |

## 15. Governance and Safety

- Compute quota enforcement by role and by topic.
- Data policy checks before experiment launch.
- Restricted operations policy (high-risk model behaviors require explicit approval).
- Full audit trail of prompts, decisions, agent communications, and experiment outputs.
- Mandatory approval gates for high-cost runs, high-risk topics, and publication claims.
- Emergency manual override that can stop or quarantine active runs immediately.
- Workspace network policies preventing unauthorized external access.
- Agent communication logs preserved for audit (no off-the-record channels).

## 16. Success Metrics (KPIs)

- **Research throughput:** experiments/week, validated findings/month.
- **Quality:** replication pass rate, false-positive rate.
- **Efficiency:** GPU hours per validated insight.
- **Novelty with rigor:** percentage of wins surviving adversarial review.
- **Cycle time:** topic-to-actionable-conclusion lead time.
- **Collaboration quality:** percentage of findings that incorporate peer feedback or cross-pollinated ideas.
- **Literature grounding:** percentage of hypotheses backed by cited prior work.

## 17. Rollout Plan

### Phase 0: Foundation

- Define experiment schema and artifact registry.
- Implement professor + 3 student agents with basic message passing.
- Set up agent workspace infrastructure (containerized desktops with computer-use API).
- Manual runtime assignment (Colab and/or remote SSH).
- Basic literature search integration.

### Phase 1: Autonomous Loop MVP

- Automated topic decomposition and experiment assignment.
- Full inter-agent communication channels (broadcast, peer-to-peer, shared board).
- Basic retry/checkpoint logic for Colab and SSH runtime failures.
- Paper search and indexing pipeline.
- First reproducibility gate and leaderboard.

### Phase 2: Robust Multi-Agent Lab

- Add reviewer and librarian agents.
- Dynamic compute allocation by expected information gain.
- Portfolio-level strategy optimization.
- Workspace snapshotting and restore for reproducibility.
- Add writer agent and manuscript assembly pipeline.

### Phase 3: Scaled Research Operations

- Continuous benchmark-driven model routing.
- Multi-topic concurrent programs.
- Standardized publish-ready research packs.
- Multi-venue template support (for example NeurIPS/ICLR/ACL formats).
- Advanced workspace capabilities (multi-monitor, GPU profiling tools, visualization suites).

## 18. Recommended Tech Stack (v1)

As of February 23, 2026, this stack provides the best balance of intelligence routing, research rigor, and operational reliability.

### 18.1 Core Platform

- **Language/runtime:** TypeScript 5.x on Node.js 25+ for the control plane, agent services, and tooling.
- **Type safety and schemas:** TypeScript strict mode plus `zod` for experiment contracts, agent I/O, and runtime validation.
- **Control API:** `Fastify` (or `NestJS`) for orchestration endpoints and operator controls.
- **Project CLI:** TypeScript CLI (`opencolab`) for topic intake, checkpoint approvals, run control, status, and audit-log inspection.
- **Ops UI:** `Next.js` for live experiment portfolio, agent status, and decision trails.

### 18.2 Multi-Agent and Workflow Orchestration

- **Agent workflow layer:** `LangGraph` JS/TS runtime for professor/student/reviewer graph execution and branching logic.
- **Durable execution layer:** `Temporal` for retries, timeouts, long-running workflows, and crash recovery.
- **Model gateway:** `LiteLLM Proxy` for multi-provider routing, fallback, and cost controls.
- **Message bus:** `Redis Streams` or `NATS` for inter-agent communication channels.

### 18.3 Agent Workspaces

- **Container runtime:** `Docker` for isolated workspace environments.
- **Desktop environment:** lightweight Linux desktop (Xfce/LXDE) with VNC/noVNC for remote display.
- **Computer-use API:** Anthropic computer-use tool, or open-source alternatives (for example, `notte` or `browser-use`), for screenshot, mouse, and keyboard control.
- **Browser automation fallback:** `Playwright` for headless web interaction when full desktop control is not needed.

### 18.4 Literature and Knowledge

- **Paper search:** arXiv API, Semantic Scholar API, SerpAPI (for Google Scholar).
- **PDF parsing:** `Nougat`, `marker`, or `GROBID` for structured extraction from research PDFs.
- **Embedding and retrieval:** `pgvector` in PostgreSQL for semantic search over paper summaries and experiment logs.

### 18.5 Research Data and Artifacts

- **Metadata and memory store:** `PostgreSQL` plus `pgvector` for experiment history and retrieval.
- **Artifact/checkpoint store:** `GCS` or `S3`-compatible object storage for models, logs, and intermediate states.
- **Experiment tracking:** `Weights & Biases` for run tracking, artifact lineage, and sweep management.

### 18.6 Compute and Runtime Strategy

- **Primary exploratory compute:** one runtime per active PhD student agent from either Colab or remote SSH GPU pool.
- **Remote SSH runner:** SSH-based job launcher with preflight checks (GPU type, CUDA/toolchain compatibility, disk, and connectivity).
- **Scale-out path:** `Kubernetes Jobs` for standardized batch workloads and higher reliability.
- **Reliability guardrails:** mandatory checkpointing, auto-resume logic, and runtime health monitoring across both providers.

### 18.7 Observability and Security

- **Telemetry:** `OpenTelemetry` traces for end-to-end workflow visibility.
- **Metrics/alerts:** `Prometheus` + `Grafana` dashboards for latency, failures, and GPU efficiency.
- **Secrets and access controls:** cloud secret manager plus role-based credentials per agent service.
- **Workspace network policy:** container network isolation with explicit allowlists.

## 19. 4-Week Implementation Plan (v1)

### Week 1: Foundation and Contracts

- Define experiment contract schema and validation rules.
- Stand up Fastify (or NestJS) service, PostgreSQL + pgvector, and object storage.
- Scaffold the TypeScript `opencolab` CLI with `init`, `topic submit`, and `program status` commands.
- Integrate W&B tracking and artifact registration.
- Build agent workspace infrastructure (Docker + VNC + computer-use API).
- Set up inter-agent message bus (Redis Streams or NATS).
- Deliverable: topic intake works end-to-end through API and CLI, agent workspaces are provisionable, and message bus is operational.

### Week 2: Multi-Agent Core

- Implement professor and 3 PhD student agents in LangGraph JS/TS.
- Add LiteLLM routing profiles by role (professor, student, reviewer).
- Add Temporal workflows for durable run state and retries.
- Implement inter-agent communication channels (broadcast, peer-to-peer, shared board).
- Integrate paper search and indexing pipeline (arXiv + Semantic Scholar).
- Implement human intervention queue and approval APIs.
- Extend CLI with `checkpoint approve`, `cycle run`, and `logs` commands.
- Deliverable: one topic can generate parallel experiment plans with agents reading papers, sharing ideas, and maintaining full decision logs via API and CLI.

### Week 3: Hybrid Execution Loop

- Build Colab and remote SSH execution adapters with run packaging and launch protocol.
- Enable agents to use computer-use to interact with Colab notebooks and remote terminals from their workspaces.
- Implement checkpoint sync, disconnection recovery, and auto-resume across both providers.
- Add baseline comparison and replication gate in evaluation pipeline.
- Add CLI runtime controls for pause/resume/terminate and checkpoint-aware reruns.
- Deliverable: at least 3 parallel experiments run on Colab and/or remote SSH with agents using full workspace capabilities and reporting comparable metrics, fully operable from the CLI.

### Week 4: Hardening and First Research Cycle

- Add reviewer agent for adversarial verification and reproducibility checks.
- Add budget controls, quota policies, and stop criteria enforcement.
- Build operator dashboard views for portfolio ranking, agent communication logs, and risk status.
- Add manual pause/resume/override controls and intervention audit panels.
- Run one full pilot topic from intake to synthesis report.
- Generate a submission-ready paper draft with figures, tables, and references.
- Deliverable: production-like v1 demo with audited decisions, agent collaboration traces, one independently replicated result, one submission-ready manuscript draft, and complete command-line operability through `opencolab`.

## 20. Risks and Mitigations

- **Risk:** agent echo chamber and convergent thinking.
  **Mitigation:** forced diversity in hypothesis families, independent reviewer critiques, and mandatory exploration of at least one contrarian approach per research cycle.

- **Risk:** irreproducible wins due to runtime instability or environment drift.
  **Mitigation:** strict checkpointing, externalized state, environment fingerprinting, workspace snapshotting, mandatory rerun gate.

- **Risk:** high compute burn with low insight yield.
  **Mitigation:** budget caps, early stopping, information-gain scoring.

- **Risk:** poor strategic direction despite high local agent intelligence.
  **Mitigation:** professor-level objective reviews and milestone re-grounding.

- **Risk:** information overload from unfiltered inter-agent communication.
  **Mitigation:** structured message types, relevance filtering, and professor-curated priority queues.

- **Risk:** workspace security breach or uncontrolled external access.
  **Mitigation:** strict container isolation, network allowlists, action logging, and sandboxed execution.

- **Risk:** agents citing retracted, low-quality, or hallucinated papers.
  **Mitigation:** citation verification pipeline, cross-referencing with Semantic Scholar metadata, and mandatory source linking.

## 21. Acceptance Criteria for v1

- User can submit one research topic and launch a full multi-agent cycle.
- At least 3 student agents run parallel experiment tracks on Colab and/or remote SSH GPUs.
- Agents use computer-use workspaces to interact with notebooks, terminals, and browsers.
- Agents communicate findings through structured channels and build on each other's work.
- Agents search and cite relevant papers from the open web.
- Professor produces a ranked evidence-based summary with follow-up plan.
- At least one claimed improvement is independently replicated.
- System produces a submission-ready paper draft grounded in tracked artifacts and verified citations.
- Human operator can pause, edit, reroute, or terminate workflows at defined checkpoints.
- Core orchestration services and contracts are implemented in TypeScript.
- A project CLI (`opencolab`) can execute the end-to-end workflow: topic submission, checkpoint approvals, run execution, status inspection, and audit-log access.
- Full decision, communication, and artifact trace is available for audit.

## 22. Open Decisions (To Finalize Before Build)

- Number of concurrent student agents by default.
- Minimum evidence threshold for claiming a breakthrough.
- Preferred persistence backend for artifacts and checkpoints.
- Human approval points for expensive or high-risk runs.
- Default provider mix and fallback policy (Colab-first, SSH-first, or hybrid priority).
- Target venue templates and reference style policy.
- Human authorship and final sign-off workflow before external submission.
- Who has override authority, and what approval quorum is required per risk tier.
- Computer-use provider selection (Anthropic computer-use vs. open-source alternatives).
- Inter-agent communication rate limits and filtering policies.
- Paper source trust tiers and citation verification strictness.

## 23. Scientific Paper Output Standard

Every generated manuscript should be publication-ready and include:

- IMRaD structure (Introduction, Methods, Results, and Discussion/Conclusion).
- Related work section with verified citations sourced from the shared literature database.
- Methods detail sufficient for replication (datasets, preprocessing, model configs, training protocol).
- Results with confidence intervals and ablation coverage.
- Publication-quality figures and tables generated from tracked artifacts.
- Limitations, ethical considerations, and compute/resource disclosure.
- Reproducibility appendix with seeds, checkpoints, and environment fingerprints.

Quality gates before marking a draft as submission-ready:

- Claims must map to logged experiment IDs and metrics.
- Citations must be source-linked, deduplicated, and verified against indexed papers.
- Numerical values in text must match artifact registry values.
- Professor + reviewer approval required before final export.

## 24. Human Intervention Model

Human intervention is a first-class control loop, not only an exception path.

Intervention triggers:

- Budget threshold breach or abnormal spend velocity.
- Safety/policy flags from governance rules.
- Low-confidence or contradictory evaluator outputs.
- Claims with large reported gains that require stricter verification.
- Agent communication anomalies (for example, agents converging on identical approaches too quickly).

Available operator actions:

- Approve or reject pending portfolio/claim decisions.
- Edit constraints (budget, stop criteria, or experiment priority).
- Pause, resume, reroute, or terminate specific runs or entire programs.
- Request targeted reruns or additional ablations before claim promotion.
- Inspect agent workspaces (view screenshots, read logs, browse file systems).
- Inject directives into the inter-agent communication channel.

System guarantees:

- Interventions are durable, timestamped, and attributable to a human actor.
- Paused workflows resume from checkpoints without losing provenance.
- Overrides are logged in the decision graph and included in final reports.

---

This spec defines the operating model for a research lab that combines frontier-level exploration speed with academic-grade critical review and reproducibility discipline. Agents are not just task executors — they are collaborative researchers with full computer-use autonomy, shared knowledge, and the ability to read, debate, experiment, and write like a real research team.
