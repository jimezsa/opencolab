import type { Db } from "./db.js";
import { recordEvent } from "./events.js";
import { newId, nowIso } from "./utils.js";

export function requestApproval(db: Db, runId: string, requestedBy: string, note?: string): void {
  const now = nowIso();
  db.run(
    `INSERT INTO approvals (approval_id, run_id, status, requested_by, note, created_at, updated_at)
     VALUES (:approval_id, :run_id, :status, :requested_by, :note, :created_at, :updated_at)
     ON CONFLICT(run_id) DO UPDATE SET
       status = excluded.status,
       requested_by = excluded.requested_by,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    {
      approval_id: newId("approval"),
      run_id: runId,
      status: "pending",
      requested_by: requestedBy,
      note: note ?? null,
      created_at: now,
      updated_at: now
    }
  );

  setRunStatus(db, runId, "waiting_approval");
  recordEvent(db, runId, "approval.requested", { requestedBy, note: note ?? null });
}

export function setApprovalStatus(db: Db, runId: string, status: "approved" | "rejected", note?: string): void {
  db.run(
    `UPDATE approvals
     SET status = :status,
         note = COALESCE(:note, note),
         updated_at = :updated_at
     WHERE run_id = :run_id`,
    {
      run_id: runId,
      status,
      note: note ?? null,
      updated_at: nowIso()
    }
  );

  recordEvent(db, runId, "approval.updated", { status, note: note ?? null });

  if (status === "approved") {
    setRunStatus(db, runId, "approved");
    setRunStatus(db, runId, "completed");
  }
}

export function setRunStatus(
  db: Db,
  runId: string,
  status:
    | "created"
    | "planning"
    | "running"
    | "review"
    | "waiting_approval"
    | "approved"
    | "paused"
    | "stopped"
    | "completed"
    | "failed"
): void {
  db.run(
    `UPDATE runs
     SET status = :status,
         updated_at = :updated_at
     WHERE run_id = :run_id`,
    {
      run_id: runId,
      status,
      updated_at: nowIso()
    }
  );

  recordEvent(db, runId, "run.status_changed", { status });
}

export function pauseRun(db: Db, runId: string): void {
  setRunStatus(db, runId, "paused");
}

export function stopRun(db: Db, runId: string): void {
  setRunStatus(db, runId, "stopped");
}
