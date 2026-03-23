# OpenColab Runpod Execution Target Draft

## 1. Status

This document is a design draft for remote GPU experiment execution on Runpod.

It is intentionally separate from the current runtime contract in `docs/spec.md`.
Nothing in this file is normative for the existing OpenColab runtime until the design is promoted into `docs/spec.md`, `README.md`, and implementation.

## 2. Purpose

OpenColab currently treats agent provider execution and project-local file work as the primary runtime path.

The next capability is remote experiment execution on GPU infrastructure without turning the provider runtime into a remote shell layer.

The Runpod integration should therefore add a separate execution-target layer for experiments.

Goals:

- keep agent reasoning separate from remote experiment infrastructure
- let agents request bounded remote GPU runs instead of ad hoc remote shell sessions
- preserve OpenColab as the source of truth for project state, run records, logs, and artifacts
- make remote runs reproducible, inspectable, and safe enough for routine use
- establish a backend contract that can later support `ssh`, `colab`, and other remote targets

## 3. Product Position

The design should follow this principle:

`agent provider/runtime != experiment execution target`

Examples:

- an agent may still use `openai` with `codex` for reasoning while launching a training run on Runpod
- an agent may still use `anthropic` or `gemini` locally while monitoring or summarizing artifacts from a remote GPU run

Runpod is infrastructure for experiment execution, not the identity of the reasoning agent.

## 4. MVP Scope

The initial Runpod release should stay intentionally narrow.

Included in MVP:

- one backend: `runpod`
- one compute product: Runpod `Pods`
- one cloud class: `Secure Cloud`
- one storage mode: `network volume`
- one remote access mode: `SSH`
- one workspace root on the Pod: `/workspace`
- one run style: non-interactive batch experiments
- one operator channel: OpenColab CLI
- one user-visible progress path: existing OpenColab progress events

Explicitly out of scope for MVP:

- Runpod Serverless
- notebook-native workflows
- browser-driven Jupyter automation
- multi-node training
- distributed orchestration
- always-on background autonomous job scheduling
- marketplace optimization across multiple providers
- arbitrary interactive SSH terminals exposed directly to agents
- direct support for community-cloud-only features

## 5. Why Runpod First

Runpod is a strong first backend because it offers the primitives OpenColab needs for a durable remote experiment loop:

- API-managed Pod lifecycle
- SSH access to running Pods
- persistent storage through network volumes
- a predictable workspace mount for Pod-attached network volumes at `/workspace`

This makes Runpod a better first target than Google Colab for OpenColab's execution model.

Colab is notebook-first and session-oriented.
OpenColab needs job-oriented infrastructure with clearer lifecycle control:

- create
- sync
- launch
- poll
- fetch artifacts
- stop or keep warm

## 6. Runpod Constraints That Must Shape the Design

The Runpod MVP must respect the following platform realities:

- network volumes are persistent and exist independently of compute
- network volumes for Pods mount at `/workspace`
- network volumes for Pods are available only in Secure Cloud
- a network volume must be attached during Pod deployment
- a network volume cannot be attached or detached from an existing Pod without deleting that Pod
- volume location constrains where compatible Pods can be launched

These constraints imply:

- the volume strategy is not a minor implementation detail; it is part of target design
- OpenColab should prefer reusable named targets over disposable one-off Pod definitions
- Pod recreation is acceptable, but it must preserve the expected durable workspace through the volume

## 7. High-Level Architecture

The remote execution flow should become:

`Telegram/CLI -> Active Project -> Active Agent -> Experiment Planner -> Execution Target -> Remote Run -> Artifacts back to Project`

OpenColab remains the control plane.
Runpod is the remote compute backend.

OpenColab owns:

- project state
- target definitions
- run manifests
- run status
- progress relays
- local artifact copies
- operator-facing remediation and safety checks

Runpod owns:

- Pod provisioning
- GPU resources
- attached volume hosting
- remote shell environment

## 8. Core Concepts

### 8.1 Execution Target

An `ExecutionTarget` is a named remote GPU environment available to a project.

It should describe:

- backend identity
- compute defaults
- storage defaults
- connection defaults
- bootstrap defaults
- budget and runtime guardrails

Example identity:

- `runpod-a100`
- `runpod-a40`
- `runpod-4090`
- `runpod-cheap-train`

Execution targets belong at project scope, not inside agent provider config.

### 8.2 Experiment Run

An `ExperimentRun` is one bounded remote execution attempt launched against an execution target.

It should describe:

- who requested the run
- what local snapshot or files were sent
- what command was launched remotely
- what remote resources were allocated
- what happened during execution
- what artifacts were returned

### 8.3 Run Manifest

A `RunManifest` is the immutable record of what OpenColab intended to execute.

It should include:

- run id
- project id
- agent id
- target id
- requested command
- working directory
- environment variable references
- sync include list
- expected artifact paths
- timestamps
- source revision metadata when available

The manifest is the canonical record for reproducibility and debugging.

## 9. State Ownership

The current `AgentConfig.provider` shape should remain focused on reasoning runtime.

Runpod execution should not be bolted onto:

- `provider.name`
- `provider.runtime`
- provider CLI args

Instead, OpenColab should introduce project-level execution-target state.

Suggested additions to `opencolab.json`:

```json
{
  "projects": {
    "default": {
      "id": "default",
      "path": "projects/default",
      "activeAgentId": "professor",
      "agents": {},
      "executionTargets": {
        "runpod-a100": {
          "id": "runpod-a100",
          "backend": "runpod",
          "enabled": true,
          "datacenterId": "US-KS-2",
          "cloudType": "secure",
          "gpuType": "NVIDIA A100 80GB PCIe",
          "gpuCount": 1,
          "volume": {
            "mode": "network_volume",
            "name": "default-runpod-a100",
            "sizeGb": 200
          },
          "ssh": {
            "mode": "public_ip"
          },
          "workspaceRoot": "/workspace",
          "bootstrapProfile": "python-ml",
          "maxRuntimeMinutes": 360,
          "autoStopPolicy": "stop_on_completion"
        },
        "runpod-a40": {
          "id": "runpod-a40",
          "backend": "runpod",
          "enabled": true,
          "datacenterId": "US-KS-2",
          "cloudType": "secure",
          "gpuType": "NVIDIA A40",
          "gpuCount": 1,
          "volume": {
            "mode": "network_volume",
            "name": "default-runpod-a40",
            "sizeGb": 200
          },
          "ssh": {
            "mode": "public_ip"
          },
          "workspaceRoot": "/workspace",
          "bootstrapProfile": "python-ml",
          "maxRuntimeMinutes": 360,
          "autoStopPolicy": "stop_on_completion"
        }
      }
    }
  }
}
```

Secret handling:

- `RUNPOD_API_KEY` must live in `.env.local` or shell env only
- SSH private keys must not be embedded in `opencolab.json`
- state may store non-secret key references or local paths if required later

## 10. Project Filesystem Layout

Remote experiment bookkeeping should live inside the active project.

Suggested layout:

- `projects/<project_id>/experiments/targets/`
- `projects/<project_id>/experiments/runs/<run_id>/manifest.json`
- `projects/<project_id>/experiments/runs/<run_id>/status.json`
- `projects/<project_id>/experiments/runs/<run_id>/logs/`
- `projects/<project_id>/experiments/runs/<run_id>/artifacts/`
- `projects/<project_id>/experiments/runs/<run_id>/sync/`

Suggested semantics:

- `manifest.json` is immutable after launch except for implementation-safe metadata enrichment
- `status.json` is mutable and tracks lifecycle changes
- `logs/` stores fetched stdout, stderr, and OpenColab polling notes
- `artifacts/` stores files copied back from the remote run
- `sync/` stores generated sync lists or packaging metadata, not a duplicate copy of the entire project by default

## 11. Target Shape

The first Runpod target type should be deliberately simple.

Suggested fields:

- `id`
- `backend`
- `enabled`
- `datacenterId`
- `cloudType`
- `gpuType`
- `gpuCount`
- `templateRef` or image/template hint
- `volume.mode`
- `volume.name`
- `volume.sizeGb`
- `workspaceRoot`
- `ssh.mode`
- `bootstrapProfile`
- `maxRuntimeMinutes`
- `idleStopMinutes`
- `autoStopPolicy`
- `maxEstimatedCostUsd`

MVP constraints:

- `backend` must be `runpod`
- `cloudType` must be `secure`
- `volume.mode` must be `network_volume`
- `ssh.mode` must be the one stable SSH path chosen by the implementation

## 12. Run Lifecycle

The Runpod experiment lifecycle should be explicit and inspectable.

### 12.1 States

Suggested run states:

- `draft`
- `validating`
- `provisioning`
- `waiting_for_ssh`
- `syncing`
- `bootstrapping`
- `running`
- `running_unreachable`
- `fetching`
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `cleanup_failed`

### 12.2 Required Flow

1. Create a local run manifest.
2. Validate the selected target and operator prerequisites.
3. Ensure the referenced Runpod network volume exists.
4. Create a Pod or reuse a compatible warm Pod if policy allows.
5. Wait for the Pod to become reachable through SSH.
6. Sync the selected workspace subset to `/workspace`.
7. Run bootstrap steps needed for the selected profile.
8. Launch the experiment as a detached non-interactive batch job.
9. Poll run status and tail or fetch remote logs.
10. Emit bounded OpenColab progress events during meaningful state changes.
11. Fetch declared artifacts and final logs back into the project tree.
12. Stop the Pod, or leave it available only if target policy allows that behavior.
13. Mark the run with a terminal status.

## 13. Sync Model

OpenColab should not blindly sync the entire repository to Runpod for every run.

The sync model should be allowlist-based.

Each run should define:

- local working root
- include paths
- exclude paths
- expected remote working directory
- artifact return paths

MVP rules:

- default to syncing a bounded subset of the active project
- never sync `.env.local`
- never sync `.git/`
- never sync agent memory by default
- never sync large derived artifacts unless explicitly included

Recommended default excludes:

- `.git/`
- `.env.local`
- `.opencolab/`
- `node_modules/`
- `dist/`
- `projects/*/AGENTS/*/memory/`

## 14. Bootstrap Model

Remote runs need predictable environment preparation.

OpenColab should support a small number of named bootstrap profiles rather than free-form setup logic in the first release.

Examples:

- `python-ml`
- `pytorch-cu12`
- `minimal-shell`

A bootstrap profile may define:

- apt package requirements
- python version expectation
- virtualenv or conda setup strategy
- pip dependency install commands
- health checks such as `nvidia-smi` and import probes

Bootstrap output should be recorded in the run logs.

## 15. Launch Model

The MVP launch model should be batch-oriented.

Required properties:

- non-interactive
- detached from the operator terminal
- log-producing
- pollable
- cancelable

Detached launch is mandatory, not optional.
The remote experiment process must not depend on a live SSH session remaining open.
If SSH drops after launch, the intended behavior is that the job continues to run on the Pod.

OpenColab should launch a concrete command in a known remote working directory and record:

- exact command string
- pid or job handle if available
- launch time
- remote log file locations

### 15.1 SSH Interruption and Recovery

SSH interruption must be treated as a transport problem first, not as automatic evidence that the experiment failed.

OpenColab should distinguish at least these cases:

- SSH disconnected, but the Pod still appears alive
- the Pod was terminated or restarted
- the experiment process exited while the Pod remained alive
- log or artifact transfer was interrupted even though the experiment may still be running

Required behavior when SSH is interrupted during a running job:

- do not mark the run as `failed` only because SSH was lost
- transition the run into `running_unreachable` when the Pod still appears alive but SSH or shell access is unavailable
- emit a `warning` progress event that the run is still believed to be active but is temporarily unreachable
- continue checking Pod state through the Runpod control plane
- retry SSH and log access until reconnect, terminal run state, or timeout policy is reached
- when connectivity returns, reconcile remote state, resume log collection, and continue normal lifecycle handling

Failure classification rules:

- SSH loss alone = degraded state and retry path
- Pod termination or restart during the job = run failure unless the workflow explicitly supports resume
- artifact or log fetch interruption = retryable transfer problem, not immediate experiment failure

Recovery records should capture:

- when the connection was lost
- what the last confirmed remote state was
- what checks were attempted during the unreachable window
- when connectivity resumed or when recovery was abandoned

## 16. Progress Reporting

Runpod execution must reuse the existing OpenColab progress model rather than inventing a second event system.

Typical event sequence:

- `started` when validation begins
- `milestone` when provisioning begins
- `milestone` when SSH becomes available
- `progress` during sync when counts are meaningful
- `milestone` when bootstrap starts and completes
- `milestone` when the experiment command is launched
- `warning` for degraded runs, temporary SSH interruption, partial syncs, partial artifact fetches, or weak confidence in remote state
- `completed` when final artifacts and logs have been collected

Progress events are operational, not part of assistant conversation memory.

## 17. Artifact Model

The artifact contract is critical.

Each run should be able to declare expected outputs before launch.

Examples:

- `outputs/train.log`
- `outputs/checkpoints/final.pt`
- `outputs/plots/loss_curve.png`
- `outputs/report/metrics.json`

OpenColab should:

- fetch declared artifacts automatically
- store them under the local run folder
- record missing expected artifacts as warnings or failures depending on strictness

The final user-facing summary should distinguish clearly between:

- command success
- artifact success
- scientific success

These are not the same thing.

## 18. CLI Surface

The first product surface should be operator-first.

User-facing CLI naming should be explicit about GPU infrastructure and future provider expansion.

Internally, OpenColab may still use a provider-neutral `ExecutionTarget` model.
The CLI should prefer clearer operator language.

Suggested command families:

- `opencolab gpu server add --provider runpod`
- `opencolab gpu server list`
- `opencolab gpu server show`
- `opencolab gpu server test`
- `opencolab gpu server remove`
- `opencolab gpu job start`
- `opencolab gpu job status`
- `opencolab gpu job logs`
- `opencolab gpu job fetch`
- `opencolab gpu job cancel`
- `opencolab gpu job list`

Naming rationale:

- `gpu server` is clearer than `target` for operators
- `gpu job` is clearer than a generic `run`
- `--provider` makes the surface extensible for future GPU providers beyond Runpod
- the internal state model can stay provider-neutral even if the CLI is more concrete

Suggested MVP priorities:

1. gpu server add
2. gpu server list
3. gpu server test
4. gpu job start
5. gpu job status
6. gpu job logs
7. gpu job fetch
8. gpu job cancel

Agent-triggered remote runs can come after the operator-facing commands are stable.

### 18.1 `src/ignite.ts` Onboarding Plan

Runpod should also become part of the first-run and update onboarding flow in `src/ignite.ts`.

This should happen after the core `gpu server` and `gpu job` commands are stable enough to be the underlying implementation path.

The `ignite` plan should include an optional Runpod section that:

- detects whether `RUNPOD_API_KEY` is already available
- allows the operator to keep existing Runpod setup, update it, or skip it
- can persist `RUNPOD_API_KEY` in `.env.local`
- can optionally create the first named GPU server for the active project using `--provider runpod`
- offers curated default server settings for the first GPU server, rather than forcing raw low-level Runpod choices
- can optionally run a lightweight server validation or connectivity test
- remains skippable so local-only onboarding still works cleanly

The first curated `ignite` target preset should favor the MVP path described in this document:

- backend: `runpod`
- cloud type: `secure`
- storage mode: `network_volume`
- workspace root: `/workspace`
- access mode: `SSH`
- bootstrap profile: `python-ml`

Responsibility split:

- `src/ignite.ts` should handle setup UX and first GPU server creation
- `gpu server` and `gpu job` lifecycle commands should remain available outside `ignite` for later changes and repeatable operator control

## 19. Agent Integration

Agents should not receive unrestricted remote shell authority by default.

Instead, agents should request bounded remote work through a shared skill or runtime-mediated action.

The first agent-facing integration should:

- choose a named execution target
- specify a command
- specify allowed sync inputs
- specify expected artifacts
- specify runtime limit

The runtime should still decide whether the request is admissible under project policy.

This design keeps the current agent/provider contract intact while making remote execution possible.

## 20. Security Model

The Runpod MVP should assume remote compute is powerful and expensive, and therefore risky if left unconstrained.

Required controls:

- `RUNPOD_API_KEY` stored only in `.env.local` or shell env
- explicit target allowlist per project
- bounded sync paths
- bounded artifact fetch paths
- max runtime per target or run
- stop or cleanup behavior for stale Pods
- clear operator visibility into active remote cost exposure

Security-sensitive defaults:

- never persist raw secrets in project state
- never sync `.env.local`
- never auto-forward all local environment variables to the Pod
- prefer explicit env var allowlists or secret references

## 21. Failure and Recovery

Remote runs will fail in messy ways.

OpenColab must handle at least:

- missing `RUNPOD_API_KEY`
- missing local SSH prerequisites
- invalid target config
- volume not found
- Pod creation failure
- SSH timeout
- partial sync
- bootstrap failure
- remote command exit non-zero
- remote disconnect during run
- partial artifact fetch
- cleanup failure

Required behavior:

- preserve the local run record
- keep the last meaningful stage in `status.json`
- surface a short operator-facing remediation message
- preserve fetched logs even on failure
- distinguish `run failed` from `cleanup failed`

SSH-specific recovery rules:

- if SSH is interrupted after detached launch and the Pod is still alive, the run should remain recoverable
- if SSH is interrupted before launch is confirmed, the run should remain in a non-terminal uncertain state until reconciliation succeeds or timeout policy is reached
- if the Pod is gone, the run should be treated as failed even if some artifacts survive on a preserved network volume
- if artifact fetch fails after the experiment finished, the run result should distinguish experiment completion from artifact collection failure

## 22. Cost and Resource Policy

Cost control is part of the product, not an afterthought.

Each target should be able to express:

- maximum runtime
- idle shutdown behavior
- approximate budget ceiling
- allowed GPU class
- allowed GPU count

The MVP does not need a pricing engine.
It does need operator-visible guardrails.

## 23. Recommended MVP Defaults

The recommended first target profile is:

- backend: `runpod`
- cloud type: `secure`
- gpu count: `1`
- storage: one reusable network volume per target
- workspace root: `/workspace`
- access: SSH
- auto-stop policy: stop the Pod on successful completion
- warm reuse: allowed only when the target configuration is still compatible

The recommended first workflow is:

- prepare code locally
- sync a bounded project subset
- bootstrap a Python ML environment
- run one training or evaluation command
- fetch plots, logs, and metrics
- stop the Pod

## 24. Deferred Features

Defer the following until the MVP is stable:

- multiple volumes per target
- volume replication across datacenters
- Serverless support
- notebook generation or notebook automation
- live interactive remote terminals in Telegram
- multi-node orchestration
- spot or preemptible optimization logic
- automatic image selection
- automatic dataset preloading heuristics
- backend abstraction for Lambda, Vast, or Modal

## 25. Acceptance Criteria For The First Runpod Milestone

The first Runpod milestone is complete when all are true:

- a project can define at least one named Runpod execution target
- target validation can confirm required local and remote prerequisites
- OpenColab can launch a bounded batch run on a Runpod Pod
- OpenColab can use a Pod-attached network volume mounted at `/workspace`
- OpenColab can sync an allowlisted local project subset to the Pod
- OpenColab can bootstrap the remote environment and record the result
- OpenColab can survive temporary SSH interruption after launch without immediately marking the job failed
- OpenColab can stream bounded progress updates during provisioning, sync, bootstrap, run, and artifact fetch
- OpenColab can fetch declared artifacts and logs back into the project tree
- OpenColab can stop the Pod on completion or surface cleanup failure explicitly
- run records remain locally inspectable even when remote execution fails

## 26. Open Questions

These questions should be resolved before promotion into `docs/spec.md`:

- should execution targets be stored only in `opencolab.json`, or partly in project files under `experiments/targets/`
- should target creation prefer raw image selection, Runpod templates, or both
- should warm Pod reuse be in MVP or deferred
- what is the minimum SSH mode and local dependency set required for reliable sync
- should OpenColab use `rsync`, `scp`, tar streaming, or an adapter abstraction for sync
- what exact remote process supervisor pattern should back detached jobs
- what exact detached-launch mechanism should be the MVP default: `tmux`, `nohup`, background wrapper script, or another approach
- should artifact declarations be strict by default or best-effort by default
- how much operator confirmation is needed before a high-cost run starts

## 27. Promotion Path

After this draft is reviewed, the next documentation step should be:

1. promote the accepted execution-target model into `docs/spec.md`
2. update `README.md` to replace the vague remote-GPU placeholder with concrete Runpod-first wording
3. add operator-facing setup guidance for `RUNPOD_API_KEY`
4. define the `src/ignite.ts` onboarding flow for optional Runpod setup and first-target creation
5. define the initial shared skill or CLI affordance for launching bounded remote runs

## 28. References

Primary external references used for this draft:

- Runpod Pods overview: https://docs.runpod.io/pods/overview
- Runpod SSH for Pods: https://docs.runpod.io/pods/configuration/use-ssh
- Runpod network volumes: https://docs.runpod.io/storage/network-volumes
- Runpod API overview: https://docs.runpod.io/api-reference/overview
