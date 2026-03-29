---
name: runpod-job
description: Launch and manage bounded Runpod GPU jobs through the OpenColab CLI. Create or reuse a project-scoped GPU server, validate it, start a remote job with bounded sync and artifact paths, monitor status and logs, fetch outputs, and cancel runs when needed.
metadata:
  {
    "opencolab":
      {
        "emoji": "🚀",
        "os": ["linux", "darwin"],
      },
  }
---

# Runpod Job Skill

Use this skill when the user wants to run code, training, evaluation, or another bounded experiment on Runpod through OpenColab's CLI.

Typical use cases:

- create the first Runpod GPU server for the current project
- reuse an existing OpenColab Runpod server target
- launch a bounded remote GPU job
- inspect status, logs, and fetched artifacts
- cancel a stuck or unnecessary GPU run

Do not use this skill for direct Runpod API work unless the user is explicitly fixing OpenColab itself. Prefer the OpenColab control plane:

- `opencolab gpu server ...`
- `opencolab gpu job ...`

## Mission

1. Use the installed `opencolab` CLI command available in the current environment.
2. Reuse an existing GPU server when possible; create one only when needed.
3. Validate the target before launching expensive work.
4. Start a bounded remote GPU job with minimal include paths, explicit artifact paths, and explicit env forwarding.
5. Poll status, inspect logs, fetch outputs, or cancel the run as needed.
6. Return a concise summary with the server id, run id, state, important logs, and fetched artifacts.

## Hard Requirements

- Use the OpenColab CLI, not the raw Runpod REST API.
- Prefer an existing server target before creating a new one.
- When creating a new general-purpose target, prefer ordered fallback locations and GPU candidates instead of a single rigid datacenter or GPU whenever that matches the user's intent.
- Keep sync allowlist-based. Include only the files or directories the remote command really needs.
- Never blindly forward all environment variables. Use `--env` only for the specific names the remote job requires.
- Declare expected artifacts up front with `--artifact` whenever the user expects outputs back.
- Treat remote jobs as detached batch jobs, not interactive shells.
- When creating a new general-purpose Runpod target without a user override, prefer `--bootstrap-profile pytorch-cu12`.
- For longer jobs, prefer `opencolab gpu job start --wait false`, return the `run_id` promptly, and do not sit in a polling loop by default.
- Inspect status or logs after launch only when the user explicitly asks about the run, asks to monitor it, or asks for fetched outputs.
- If `OPENCOLAB_PROGRESS_FILE` is available and the run is long enough to justify updates, emit bounded progress events for target setup, validation, launch, polling, degraded runs, and final delivery.
- Final answers must include the run id, target id, current or final state, and whether artifacts were fetched successfully.
- When a run fails, times out, or degrades, notify the user clearly and propose the next useful action instead of stopping at the raw failure state.

## OpenColab Progress Helper

```bash
emit_progress() {
  if [ -z "${OPENCOLAB_PROGRESS_FILE:-}" ]; then
    return 0
  fi
  printf '%s\n' "$1" >> "$OPENCOLAB_PROGRESS_FILE"
}
```

Example:

```bash
emit_progress '{"kind":"milestone","stage":"gpu_launch","slot":"runpod","message":"Launching Runpod GPU job on target runpod-flex."}'
```

Useful update categories for this skill:

- existing target selected
- new target created
- target validation started or degraded
- detached launch with a run id
- later status, log, or artifact inspection when the user asks
- warning states such as `running_unreachable`, `cleanup_failed`, or missing artifacts

## Workflow

### 1. Resolve the OpenColab CLI

This skill assumes `opencolab` is already installed and available in `PATH`.

If `opencolab` is missing, stop and report that prerequisite instead of trying to build the CLI from source inside this skill.

### 2. Inspect the active project and existing GPU servers

Start with:

```bash
opencolab project show
opencolab gpu server list
```

If the user named a specific server id, inspect that target:

```bash
opencolab gpu server show --server-id <server_id>
```

### 3. Create a server only when needed

If no suitable target exists, create one.

For a flexible general-purpose server, prefer a short ordered location list and a short ordered GPU list. Example:

```bash
opencolab gpu server add \
  --provider runpod \
  --server-id runpod-flex \
  --location US-KS-2,US-TX-3,US-CA-2,US-WA-1,CA-MTL-1,CA-MTL-2 \
  --gpu-type "NVIDIA A100 80GB PCIe,NVIDIA GeForce RTX 4090,NVIDIA RTX A5000,NVIDIA RTX A4500,NVIDIA RTX A4000" \
  --gpu-count 1 \
  --volume-name runpod-flex \
  --volume-size-gb 200 \
  --workspace-root /workspace \
  --bootstrap-profile pytorch-cu12 \
  --max-runtime-minutes 360 \
  --auto-stop-policy stop_on_completion
```

Creation guidance:

- Reuse the user's requested server id when provided.
- Reuse the user's requested location or GPU constraints when provided.
- If the user wants "any available GPU", prefer an ordered list from fastest to cheaper acceptable GPUs instead of one exact GPU.
- Keep the target bounded and practical. Do not create many nearly-identical targets unless the user asked for that.

### 4. Validate the target before launch

```bash
opencolab gpu server test --server-id <server_id>
```

Read the result carefully:

- proceed when the target is ready or only has acceptable warnings
- stop and explain missing prerequisites such as `RUNPOD_API_KEY`
- if the warning is only about a missing network volume, that is normally acceptable because OpenColab can create it on first job start

### 5. Plan bounded sync, env, and artifacts

Before launching, define:

- `--include`: only the minimal repo-relative paths needed by the remote command
- `--exclude`: additional heavy or irrelevant paths if needed
- `--env`: only the exact env vars needed remotely
- `--artifact`: outputs the user expects fetched back

Guidance:

- For project-local code, usually include the active project path and any shared code the command imports.
- If the command writes `outputs/train.log`, declare `--artifact outputs/train.log`.
- Artifact paths are relative to the remote working directory on the Pod.
- Do not rely on implicit secret forwarding or a full-repo copy.

### 6. Start the remote GPU job

For very short jobs where blocking is acceptable:

```bash
opencolab gpu job start \
  --server-id <server_id> \
  --command "<remote_command>" \
  --include <path1,path2> \
  --artifact <artifact1,artifact2> \
  --env <ENV1,ENV2> \
  --wait true
```

For longer jobs, launch detached and capture the run id. This should be the default choice whenever the job is expected to take more than a brief setup window:

```bash
start_output="$(
  opencolab gpu job start \
    --server-id <server_id> \
    --command "<remote_command>" \
    --include <path1,path2> \
    --artifact <artifact1,artifact2> \
    --env <ENV1,ENV2> \
    --wait false
)"
printf '%s\n' "$start_output"
run_id="$(printf '%s\n' "$start_output" | awk -F': ' '/^Run ID:/ {print $2}')"
```

If `run_id` is empty, stop and report the launch output instead of pretending the job started correctly.

After detached launch, return the `run_id` to the user instead of staying in a monitoring loop. The user can come back later and ask about the run, and then you can inspect it with the commands below.

### 7. Inspect, fetch, or cancel later

Status:

```bash
opencolab gpu job status --run-id <run_id>
```

Logs:

```bash
opencolab gpu job logs --run-id <run_id> --stream poller
opencolab gpu job logs --run-id <run_id> --stream stdout
opencolab gpu job logs --run-id <run_id> --stream stderr
```

When the user later asks how a running job is doing, inspect the existing run by `run_id`. A typical follow-up sequence is:

```bash
opencolab gpu job status --run-id <run_id>
opencolab gpu job logs --run-id <run_id> --stream poller
opencolab gpu job logs --run-id <run_id> --stream stdout
opencolab gpu job logs --run-id <run_id> --stream stderr
```

Inspection guidance:

- Prefer `stdout` and `stderr` for the most relevant new findings; use `poller` when state transitions need clarification.
- Do not dump a huge full log unless the user explicitly asks for raw logs. Summarize the important new lines.
- Treat `running_unreachable` as degraded but still active; mention it clearly instead of calling the run failed.
- If the user asks to keep watching, then it is reasonable to poll again. Otherwise inspect once, answer, and stop.
- When the run reaches a terminal state, fetch outputs if needed and summarize the final state plus the most relevant log findings.
- If the run failed, timed out, or degraded, propose the next useful action such as inspecting `stderr`, fetching artifacts, adjusting includes or env vars, rerunning on another target, or cancelling the run.

Fetch outputs:

```bash
opencolab gpu job fetch --run-id <run_id>
```

Cancel:

```bash
opencolab gpu job cancel --run-id <run_id>
```

Interpretation guidance:

- `running` means the detached remote process is alive
- `running_unreachable` means the Pod still exists but SSH is temporarily unavailable
- `completed` means the command exited successfully and artifact handling did not cause failure
- `failed` means the remote command failed or strict artifact expectations failed
- `cleanup_failed` means the command completed but Pod cleanup did not finish cleanly

### 8. Return a concise final summary

The final user-facing reply should include:

- whether an existing server was reused or a new one was created
- target id
- run id
- command or task summary
- current or final state
- important log findings or failure reason
- fetched artifacts and missing artifacts
- next step if the run is still active, degraded, or failed

## Output Contract

When you use this skill well, the user should come away with:

- a valid project-scoped Runpod server target, or a clear reason why setup failed
- a concrete GPU `run_id` when launch succeeded
- fetched artifacts and log visibility when available
- a concise explanation of the run outcome and the next useful action, especially when the run failed or degraded
