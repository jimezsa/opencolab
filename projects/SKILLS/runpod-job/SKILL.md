---
name: runpod-job
description: Launch bounded Runpod GPU jobs through the OpenColab CLI. Reuse or create a project-scoped GPU server, validate live availability, start detached jobs with bounded sync and artifacts, inspect status and logs, and fetch or cancel runs when needed.
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

Use this skill for bounded Runpod work through OpenColab's CLI: setup, launch, inspect, fetch, and cancel.

Do not use raw Runpod APIs unless the user is explicitly fixing OpenColab itself. Prefer:

- `opencolab gpu server ...`
- `opencolab gpu job ...`

## Core Rules

- Use the OpenColab CLI, not the raw Runpod REST API.
- Use the installed `opencolab` command from `PATH`; if it is missing, stop and report that prerequisite.
- Prefer an existing server target before creating a new one.
- When creating a new default or curated target without a user override, prefer ordered fallback locations with a single GPU choice: `NVIDIA A100 80GB PCIe`.
- Only broaden the GPU list beyond that single A100 when the user explicitly asks for broader availability, lower cost, or different hardware.
- For default or curated targets, prefer `--bootstrap-profile pytorch-cu12` and `--auto-stop-policy keep_warm`.
- When current stock, datacenter choice, or GPU choice matters, run `opencolab gpu server availability --server-id <id>` before launch.
- Treat availability as a live snapshot, not a reservation. A later launch can still fail if capacity changes.
- Pay attention to availability warnings such as `pod-api incompatible` or `storage failed`; do not present those candidates as healthy launch options without explanation.
- Keep sync allowlist-based. Include only the files or directories the remote command really needs.
- Never blindly forward all environment variables. Use `--env` only for the specific names the remote job requires.
- Declare expected artifacts up front with `--artifact` whenever the user expects outputs back.
- Treat remote jobs as detached batch jobs, not interactive shells.
- Launch jobs with `opencolab gpu job start --wait false` only; never use `--wait true` in this skill.
- Return the `run_id` promptly after launch and do not sit in a polling loop by default.
- Before reporting on a run, always refresh it with `opencolab gpu job status --run-id <run_id>` so the latest remote log snapshots are downloaded locally.
- When summarizing a run, always review all four local log streams: `bootstrap`, `stdout`, `stderr`, and `poller`.
- When direct Pod inspection is needed after launch, prefer `opencolab gpu job exec --run-id <id> --command "<remote command>"` over exposing raw SSH details.
- Inspect status or logs after launch only when the user explicitly asks about the run, asks to monitor it, or asks for fetched outputs.
- When a `keep_warm` run reaches a terminal state and the Pod is still available, ask the user whether they want to keep the Pod running for reuse or cancel it now.
- If `OPENCOLAB_PROGRESS_FILE` is available and the run is long enough to justify updates, emit bounded progress events for target setup, validation, launch, polling, degraded runs, and final delivery.
- When a run fails, times out, or degrades, notify the user clearly and propose the next useful action instead of stopping at the raw failure state.

## Progress Helper

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
emit_progress '{"kind":"milestone","stage":"gpu_launch","slot":"runpod","message":"Launching Runpod GPU job on target runpod-a100."}'
```

Useful updates:

- existing target selected
- new target created
- target validation started, passed, or degraded
- detached launch returned a run id
- local log snapshots refreshed
- warning states such as `running_unreachable`, `cleanup_failed`, or missing artifacts

## Workflow

### 1. Inspect the project and existing targets

```bash
opencolab project show
opencolab gpu server list
```

If the user named a specific server id, inspect it too:

```bash
opencolab gpu server show --server-id <server_id>
```

### 2. Create a target only when needed

For the default curated target, use a short ordered location list and the single curated A100 GPU:

```bash
opencolab gpu server add \
  --provider runpod \
  --server-id runpod-a100 \
  --location US-KS-2,US-TX-3,US-CA-2,US-WA-1,CA-MTL-1,CA-MTL-2 \
  --gpu-type "NVIDIA A100 80GB PCIe" \
  --gpu-count 1 \
  --volume-name runpod-a100 \
  --volume-size-gb 200 \
  --workspace-root /workspace \
  --bootstrap-profile pytorch-cu12 \
  --max-runtime-minutes 360 \
  --auto-stop-policy keep_warm
```

Creation notes:

- Reuse the user's requested server id when provided.
- Reuse the user's requested location or GPU constraints when provided.
- If the user wants "any available GPU", prefer an ordered list from fastest to cheaper acceptable GPUs instead of one exact GPU.
- Keep the target bounded and practical. Do not create many nearly-identical targets unless the user asked for that.

### 3. Validate before launch

```bash
opencolab gpu server test --server-id <server_id>
opencolab gpu server availability --server-id <server_id>
```

Interpret the result carefully:

- `gpu server test` checks local prerequisites and visible Runpod resources
- `gpu server availability` checks the current matching datacenter and GPU stock in launch order
- Proceed only when the target is ready and availability shows at least one healthy candidate.
- Stop and explain missing prerequisites such as `RUNPOD_API_KEY`.
- A missing network volume warning is usually acceptable because OpenColab can create it on first job start.
- If availability shows `pod-api incompatible`, treat that candidate as not launchable even if stock appears live.
- If availability shows `storage failed`, prefer another datacenter.
- If no healthy candidate is available, explain that clearly and either adjust the target or wait instead of launching blindly.
- Remind the user that availability can change between the snapshot and actual launch.

### 4. Plan sync, env, and artifacts

Before launching, define the minimal:

- `--include`: only the minimal repo-relative paths needed by the remote command
- `--exclude`: additional heavy or irrelevant paths if needed
- `--env`: only the exact env vars needed remotely
- `--artifact`: outputs the user expects fetched back

Notes:

- For project-local code, usually include the active project path and any shared code the command imports.
- If the command writes `outputs/train.log`, declare `--artifact outputs/train.log`.
- Artifact paths are relative to the remote working directory on the Pod.
- Do not rely on implicit secret forwarding or a full-repo copy.

### 5. Launch in detached mode

Launch detached and capture the run id:

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

After launch, return the `run_id` instead of staying in a monitoring loop. If the user wants follow-up, launch detached first and inspect later with explicit commands.

For bounded direct Pod inspection after launch:

```bash
opencolab gpu job exec --run-id <run_id> --command "<remote_command>"
```

Treat this as a bounded remote command runner, not an interactive shell.

### 6. Inspect, fetch, or cancel later

Status:

```bash
opencolab gpu job status --run-id <run_id>
```

Direct Pod command:

```bash
opencolab gpu job exec --run-id <run_id> --command "nvidia-smi"
```

Logs:

```bash
opencolab gpu job logs --run-id <run_id> --stream bootstrap
opencolab gpu job logs --run-id <run_id> --stream poller
opencolab gpu job logs --run-id <run_id> --stream stdout
opencolab gpu job logs --run-id <run_id> --stream stderr
```

Inspection guidance:

- Always run `opencolab gpu job status --run-id <run_id>` before reading log streams so the local snapshots are refreshed first.
- Review `bootstrap`, `stdout`, `stderr`, and `poller` before concluding the run has no useful log evidence.
- Prefer `stdout` and `stderr` for the most relevant new findings, use `bootstrap` when environment setup is suspect, and use `poller` when state transitions need clarification.
- Use `gpu job exec` for one-off remote inspection when the user needs current Pod state that is not already visible in the stored logs.
- Do not dump a huge full log unless the user explicitly asks for raw logs. Summarize the important new lines.
- Treat `running_unreachable` as degraded but still active; mention it clearly instead of calling the run failed.
- If `gpu job exec` reports that the run is not yet SSH-usable, explain the current run state rather than pretending direct Pod access exists already.
- If the user asks to keep watching, it is reasonable to poll again. Otherwise inspect once, answer, and stop.
- When the run reaches a terminal state, fetch outputs if needed and summarize the final state plus the most relevant log findings.
- If the target uses `keep_warm` and a terminal run leaves the Pod available, ask whether the user wants to keep it running for reuse or cancel it.
- If the run failed, timed out, or degraded, propose the next useful action such as inspecting `stderr`, fetching artifacts, adjusting includes or env vars, rerunning on another target, or cancelling the run.
- If launch fails right after a healthy availability snapshot, explain that the snapshot did not reserve capacity and that the next useful action is usually another availability check or a different candidate target.
- If the run reaches `bootstrapping`, explain that Pod provisioning and SSH already succeeded and the problem is now bootstrap or remote setup time rather than GPU discovery.

Fetch outputs:

```bash
opencolab gpu job fetch --run-id <run_id>
```

Cancel:

```bash
opencolab gpu job cancel --run-id <run_id>
```

State hints:

- `running` means the detached remote process is alive
- `running_unreachable` means the Pod still exists but SSH is temporarily unavailable
- `completed` means the command exited successfully and artifact handling did not cause failure
- On `keep_warm` targets, `completed` can still leave a reusable Pod running until it is cancelled.
- `failed` means the remote command failed or strict artifact expectations failed
- `cleanup_failed` means the command completed but Pod cleanup did not finish cleanly

## Final Reply

Include:

- whether an existing server was reused or a new one was created
- target id
- run id
- command or task summary
- current or final state
- whether the latest local log snapshots were refreshed successfully
- important log findings or failure reason
- fetched artifacts and missing artifacts
- whether the Pod is still running because of `keep_warm`, plus a direct question about keeping it running or cancelling it when applicable
- next step if the run is still active, degraded, or failed
