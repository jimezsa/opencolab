import type { Db } from "./db.js";
import type { EventType } from "./types.js";
import { newId, nowIso, toJson } from "./utils.js";

export function recordEvent(
  db: Db,
  runId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  taskId?: string
): void {
  db.run(
    `INSERT INTO events (event_id, run_id, task_id, event_type, payload_json, created_at)
     VALUES (:event_id, :run_id, :task_id, :event_type, :payload_json, :created_at)`,
    {
      event_id: newId("evt"),
      run_id: runId,
      task_id: taskId ?? null,
      event_type: eventType,
      payload_json: toJson(payload),
      created_at: nowIso()
    }
  );
}
