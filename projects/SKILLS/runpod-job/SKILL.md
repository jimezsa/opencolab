---
name: runpod-job
description: Default Runpod workflow for user-managed Pods. Ask the human to create a Pod with the desired GPU, get the `pod_id` and SSH access details, save a manual Pod profile, and use `opencolab gpu ssh` sessions as the default control path. Use OpenColab `gpu server` and `gpu job` only when the user explicitly wants managed provisioning or `run_id` tracking.
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

Use this skill for bounded Runpod work.

Default path: the human manually creates a Runpod Pod with the desired GPU, gives the agent the `pod_id`, and the agent works against that Pod through a saved `opencolab gpu ssh` profile plus transcript-backed `gpu ssh session` commands. This is a capacity-driven default: the OpenColab-managed Runpod CLI path still works, but live GPU stock is often unavailable when the agent tries to provision on demand, and the `gpu ssh` session flow avoids leaving the agent parked inside a raw interactive `ssh` shell.

Do not use raw Runpod APIs unless the user is explicitly fixing OpenColab itself.

Preferred execution paths:

- default: saved `opencolab gpu ssh` profile plus `opencolab gpu ssh session start|read|write|stop` for a user-managed Pod identified by `pod_id`
- bounded helpers: `opencolab gpu ssh profile test`, plus narrow `scp`, `rsync`, or one-shot `ssh` only when file transfer or an explicit user request requires them
- optional: `opencolab gpu server ...` and `opencolab gpu job ...` only when the user explicitly wants OpenColab-managed provisioning, detached `run_id` tracking, or the managed CLI lifecycle

## Core Rules

- Default to the manual user-managed Pod workflow through `opencolab gpu ssh`.
- If the user has not yet created a Pod, ask them to create one manually with the desired GPU type and then send the `pod_id`.
- Do not start by checking Runpod capacity or creating OpenColab server targets unless the user explicitly wants the OpenColab-managed path.
- Treat a user-supplied `pod_id` as a manual path outside the normal OpenColab `run_id` lifecycle.
- Do not invent a `run_id` for a manual Pod.
- Do not claim that `opencolab gpu job exec` works against a raw `pod_id`; it does not.
- Save or update a project-scoped manual SSH profile with `opencolab gpu ssh profile save ...` once the user provides enough details, and prefer `--set-default true` when the active agent is likely to reuse that Pod.
- Prefer `opencolab gpu ssh profile test ...` before starting a session so host and port can be refreshed from Runpod Pod metadata when local Runpod auth is available and SSH reachability is validated before real work starts.
- Ask for the SSH connection details needed to save the profile if they are not already available locally.
- Use `opencolab gpu ssh session start|read|write|stop` as the default command and inspection path for manual Pods rather than opening a raw interactive `ssh` shell.
- Keep commands bounded and task-focused. This skill is for concrete remote work, not open-ended interactive shells.
- Do not leave a manual SSH session sitting at a shell prompt or endless stream unless the user explicitly wants that. Stop it explicitly when you have the output you need.
- Prefer minimal `rsync`, `scp`, or one small uploaded script over broad workspace copies when files need to move. Those are bounded helpers, not the default control path.
- Never blindly forward all environment variables or secrets.
- If a manual Pod task fails, explain the failure clearly, call out any missing tracking or session limitations, and propose the next useful step.
- If `OPENCOLAB_PROGRESS_FILE` is available and the task is long enough to justify updates, emit bounded progress events for waiting on the user-managed Pod, saving the manual SSH profile, validating the profile, starting the manual SSH session, syncing files, sending the remote command, reading transcript output, copying outputs back, stopping the session, and blocked states.
- Only use the OpenColab-managed CLI path when the user explicitly asks for it or explicitly wants a `run_id` and OpenColab-managed status/log/artifact tracking.
- On the optional managed path, launch with `opencolab gpu job start --wait false`, return the `run_id` promptly, refresh the run with `opencolab gpu job status --run-id <run_id>` before reading logs, and review `bootstrap`, `stdout`, `stderr`, and `poller` when summarizing the run.

## Progress Helper

```bash
emit_progress() {
  if [ -z "${OPENCOLAB_PROGRESS_FILE:-}" ]; then
    return 0
  fi
  printf '%s\n' "$1" >> "$OPENCOLAB_PROGRESS_FILE"
}
```

Examples:

```bash
emit_progress '{"kind":"milestone","stage":"manual_pod","slot":"runpod","message":"Waiting for the user-managed Runpod Pod id."}'
emit_progress '{"kind":"milestone","stage":"manual_pod","slot":"runpod","message":"Saved the manual Pod profile and started a transcript-backed gpu ssh session."}'
```

Useful updates:

- waiting for `pod_id`
- waiting for SSH host, port, username, or key path
- manual SSH profile saved
- manual SSH profile validated
- manual SSH session started
- files synced
- remote command sent
- transcript inspected
- outputs copied back
- manual SSH session stopped
- manual path blocked
- managed CLI run launched
- managed CLI logs refreshed

## Default Manual Pod Workflow

This is the default workflow for almost all Runpod requests.

### 1. Ask the human to create the Pod

If the user has not already created one, ask them to:

- create a Runpod Pod manually with the desired GPU type
- wait until the Pod is actually running
- send the `pod_id`
- send or confirm the SSH details needed to reach it

Minimum details you need before execution:

- `pod_id`
- either a full SSH command that can be normalized with `--ssh-command`, or structured SSH details such as host or public IP, port, username, and authentication material available in the local environment
- an authentication method available in the local environment, such as a key path or an existing SSH config entry

If local Runpod auth is already configured, `opencolab gpu ssh profile test` may refresh host and port from the `pod_id`, but do not assume that path will work. If required SSH details are still missing, stop and ask for them instead of guessing.

### 2. Save and validate a manual SSH profile

Tell the user that:

- you are using `opencolab gpu ssh` against a user-managed Pod
- this is outside the normal OpenColab `gpu job` and `run_id` lifecycle
- OpenColab may not automatically track status, logs, artifacts, or cleanup for this path

Preferred default manual path:

```bash
opencolab gpu ssh profile save \
  --profile-id <profile_id> \
  --pod-id <pod_id> \
  --ssh-command "ssh -p <ssh_port> <ssh_user>@<ssh_host>" \
  --set-default true

opencolab gpu ssh profile test --profile-id <profile_id>
```

Notes:

- the saved profile is project-scoped and may also be set as the default for the active agent
- `profile test` can refresh host and port from Runpod Pod metadata when local Runpod auth is available
- interactive access defaults to `opt_in`, which is what the session workflow needs
- if any required SSH detail is still missing after `profile test`, stop and ask for it instead of guessing

### 3. Start a transcript-backed session

```bash
session_output="$(
  opencolab gpu ssh session start --profile-id <profile_id>
)"
printf '%s\n' "$session_output"
session_id="$(printf '%s\n' "$session_output" | awk -F': ' '/^Session ID:/ {print $2}')"
```

If `session_id` is empty, stop and report the session start output instead of pretending the session is ready.

Quick validation example:

```bash
opencolab gpu ssh session write --session-id <session_id> --stdin "nvidia-smi"
opencolab gpu ssh session read --session-id <session_id>
```

Notes:

- the live session is explicit opt-in and transcript-backed
- `session read` returns machine-readable output slices so the agent can follow live shell output over multiple steps
- keep the `session_id` and use incremental reads when the remote command produces more than one chunk of output

### 4. Stage only what is needed

Use narrow uploads. Prefer `rsync` when syncing a small tree, or `scp` for one or two files.

Example:

```bash
rsync -az \
  --exclude '.git' \
  --exclude 'node_modules' \
  <local_path_or_dir> \
  <ssh_user>@<ssh_host>:/workspace/<remote_dir>/
```

If only a single file is needed:

```bash
scp -P <ssh_port> <local_file> <ssh_user>@<ssh_host>:/workspace/<remote_dir>/
```

Keep staging bounded:

- only upload the files the task really needs
- avoid full-repo copies by default
- do not silently copy secrets

These are bounded helpers. They do not replace the default `opencolab gpu ssh session` control path.

### 5. Run bounded remote commands through the session

Use `opencolab gpu ssh session write` for concrete remote commands and `session read` for output inspection.

Example:

```bash
opencolab gpu ssh session write \
  --session-id <session_id> \
  --stdin "cd /workspace/<remote_dir> && <remote_command>"

opencolab gpu ssh session read --session-id <session_id>
opencolab gpu ssh session read --session-id <session_id> --offset <next_offset>
```

Treat this as a bounded command-and-read loop, not an invitation to sit in a long raw shell.

Guidance:

- prefer one concrete shell command per `session write`
- if remote work must continue after you disconnect, launch it in a bounded detached form and then stop the session once you have the PID, log path, or start confirmation you need
- do not leave the session open longer than necessary

### 6. Fetch only the outputs the user asked for

Use `scp` or `rsync` to copy back declared outputs.

Example:

```bash
scp -P <ssh_port> \
  <ssh_user>@<ssh_host>:/workspace/<remote_dir>/<artifact_path> \
  <local_destination>
```

Notes:

- keep downloads bounded and specific
- if the output path is large or unclear, ask the user before recursively copying a whole directory
- if the command produced no output files, report that plainly instead of implying artifact tracking exists

### 7. Stop the session and summarize the result

Stop the live session once you have what you need:

```bash
opencolab gpu ssh session stop --session-id <session_id>
```

For the manual path, include:

- that you used `opencolab gpu ssh` against a user-managed Pod
- the `pod_id`
- whether the saved profile was created or reused and whether `profile test` refreshed the endpoint
- the command or task summary
- whether the command succeeded
- key transcript findings or the most relevant failure
- which files were copied back, if any
- any bounded `scp`, `rsync`, or one-shot `ssh` helper that was needed
- any limitation from using the manual path, such as missing automatic run tracking or cleanup ownership

## Optional OpenColab-Managed Workflow

Use this only when the user explicitly wants the OpenColab-managed CLI lifecycle.

This path still exists, but it is no longer the default.

### 1. Inspect existing targets

```bash
opencolab project show
opencolab gpu server list
```

If the user named a specific server id, inspect it too:

```bash
opencolab gpu server show --server-id <server_id>
```

### 2. Create a target only when needed

For a curated default target, use a short ordered location list and a single A100 GPU:

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

Managed-path notes:

- reuse the user's requested server id when provided
- reuse the user's requested location or GPU constraints when provided
- only broaden the GPU list beyond a single A100 when the user explicitly asks for broader availability, lower cost, or different hardware
- when current stock, datacenter choice, or GPU choice matters, run `opencolab gpu server availability --server-id <id>` before launch
- treat availability as a live snapshot, not a reservation
- if availability shows `pod-api incompatible` or `storage failed`, explain that clearly instead of pretending the target is healthy

### 3. Plan sync, env, and artifacts

Before launching, define the minimal:

- `--include`: only the repo-relative paths the remote command really needs
- `--exclude`: heavy or irrelevant paths when needed
- `--env`: only the exact env vars required remotely
- `--artifact`: outputs the user expects fetched back

### 4. Launch in detached mode

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

If `run_id` is empty, stop and report the launch output instead of pretending the job started.

Return the `run_id` promptly. Do not sit in a monitoring loop unless the user explicitly asks to monitor the run.

For bounded direct Pod inspection after launch:

```bash
opencolab gpu job exec --run-id <run_id> --command "<remote_command>"
```

### 5. Inspect, fetch, or cancel later

Status:

```bash
opencolab gpu job status --run-id <run_id>
```

Logs:

```bash
opencolab gpu job logs --run-id <run_id> --stream bootstrap
opencolab gpu job logs --run-id <run_id> --stream poller
opencolab gpu job logs --run-id <run_id> --stream stdout
opencolab gpu job logs --run-id <run_id> --stream stderr
```

Fetch outputs:

```bash
opencolab gpu job fetch --run-id <run_id>
```

Cancel:

```bash
opencolab gpu job cancel --run-id <run_id>
```

Managed-path guidance:

- always run `opencolab gpu job status --run-id <run_id>` before reading log streams so local snapshots are refreshed first
- review `bootstrap`, `stdout`, `stderr`, and `poller` before concluding the run has no useful evidence
- do not dump huge raw logs unless the user explicitly asks for them
- if `gpu job exec` says the run is not SSH-usable yet, explain the current state rather than pretending direct access exists
- when a `keep_warm` run reaches a terminal state and the Pod is still available, ask whether the user wants to keep it running for reuse or cancel it

## Final Reply

Always include the correct mode:

- `user-managed Pod via opencolab gpu ssh`, or
- `OpenColab-managed gpu job`

For the manual path, include:

- `pod_id`
- whether the saved profile was created or reused and whether `profile test` refreshed the endpoint
- command or task summary
- success or failure status
- key transcript output or failure reason
- copied-back outputs, if any
- any bounded raw helper that was needed, such as `scp`, `rsync`, or one-shot `ssh`
- any limitations from bypassing OpenColab `run_id` tracking

For the managed path, include:

- target id
- `run_id`
- current or final state
- whether local log snapshots were refreshed
- important log findings or failure reason
- fetched artifacts and missing artifacts
- whether a `keep_warm` Pod is still running and whether the user wants to keep it or cancel it

In both modes:

- propose the next useful step if the task is blocked, degraded, or incomplete
