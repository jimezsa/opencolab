---
name: runpod-job
description: Default Runpod workflow for user-managed Pods. Ask the human to create a Pod with the desired GPU, get the `pod_id` and SSH access details, and use bounded direct SSH. Use OpenColab `gpu server` and `gpu job` only when the user explicitly wants managed provisioning or `run_id` tracking.
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

Default path: the human manually creates a Runpod Pod with the desired GPU, gives the agent the `pod_id`, and the agent works against that Pod directly over SSH. This is a capacity-driven default: the OpenColab-managed Runpod CLI path still works, but live GPU stock is often unavailable when the agent tries to provision on demand.

Do not use raw Runpod APIs unless the user is explicitly fixing OpenColab itself.

Preferred execution paths:

- default: direct SSH to a user-managed Pod identified by `pod_id`
- optional: `opencolab gpu server ...` and `opencolab gpu job ...` only when the user explicitly wants OpenColab-managed provisioning, detached `run_id` tracking, or the managed CLI lifecycle

## Core Rules

- Default to the manual user-managed Pod workflow.
- If the user has not yet created a Pod, ask them to create one manually with the desired GPU type and then send the `pod_id`.
- Do not start by checking Runpod capacity or creating OpenColab server targets unless the user explicitly wants the OpenColab-managed path.
- Treat a user-supplied `pod_id` as a manual path outside the normal OpenColab `run_id` lifecycle.
- Do not invent a `run_id` for a manual Pod.
- Do not claim that `opencolab gpu job exec` works against a raw `pod_id`; it does not.
- When the user wants recurring direct access to the same manual Pod, prefer saving a project-scoped profile with `opencolab gpu ssh profile save ...` and then use `opencolab gpu ssh session start|read|write|stop` instead of repeatedly reconstructing raw SSH commands.
- Ask for the SSH connection details needed to reach the Pod if they are not already available locally.
- Keep commands bounded and task-focused. This skill is for concrete remote work, not open-ended interactive shells.
- Prefer minimal `rsync`, `scp`, or one small uploaded script over broad workspace copies.
- Never blindly forward all environment variables or secrets.
- If a manual Pod task fails, explain the failure clearly, call out any missing tracking or SSH limitations, and propose the next useful step.
- If `OPENCOLAB_PROGRESS_FILE` is available and the task is long enough to justify updates, emit bounded progress events for waiting on the user-managed Pod, confirming SSH reachability, syncing files, starting the remote command, copying outputs back, and blocked states.
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
emit_progress '{"kind":"milestone","stage":"manual_pod","slot":"runpod","message":"Connected to the user-managed Runpod Pod and starting the remote command."}'
```

Useful updates:

- waiting for `pod_id`
- waiting for SSH host, port, username, or key path
- Pod reachable
- files synced
- remote command started
- outputs copied back
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
- SSH host or public IP
- SSH port
- SSH username
- authentication method available in the local environment, such as a key path or an existing SSH config entry

If any of these are missing, stop and ask for them instead of guessing.

### 2. State the operating mode clearly

Tell the user that:

- you are using a direct SSH path to a user-managed Pod
- this is outside the normal OpenColab `gpu job` and `run_id` lifecycle
- OpenColab may not automatically track status, logs, artifacts, or cleanup for this path

If the user wants the agent to work on the same manual Pod more than once, prefer this saved-profile path:

```bash
opencolab gpu ssh profile save \
  --profile-id <profile_id> \
  --pod-id <pod_id> \
  --ssh-command "ssh -p <ssh_port> <ssh_user>@<ssh_host>" \
  --set-default true

opencolab gpu ssh session start --profile-id <profile_id>
opencolab gpu ssh session read --session-id <session_id>
opencolab gpu ssh session write --session-id <session_id> --stdin "nvidia-smi"
opencolab gpu ssh session stop --session-id <session_id>
```

Notes:

- the saved profile is project-scoped and may also be set as the default for the active agent
- the live session is explicit opt-in and transcript-backed
- `session read` returns machine-readable output slices so the agent can follow live shell output over multiple steps

### 3. Stage only what is needed

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

### 4. Run a bounded remote command

Use direct SSH with an explicit remote command.

Example:

```bash
ssh -p <ssh_port> <ssh_user>@<ssh_host> \
  'cd /workspace/<remote_dir> && <remote_command>'
```

Treat this as a bounded batch command, not an invitation to open a long interactive shell.

When helpful, first run a lightweight validation command such as:

```bash
ssh -p <ssh_port> <ssh_user>@<ssh_host> 'nvidia-smi'
```

### 5. Fetch only the outputs the user asked for

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

### 6. Summarize the result

For the manual path, include:

- that you used a user-managed Pod over direct SSH
- the `pod_id`
- the command or task summary
- whether the command succeeded
- key stdout/stderr findings or the most relevant failure
- which files were copied back, if any
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

- `user-managed Pod over SSH`, or
- `OpenColab-managed gpu job`

For the manual path, include:

- `pod_id`
- command or task summary
- success or failure status
- key output or failure reason
- copied-back outputs, if any
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
