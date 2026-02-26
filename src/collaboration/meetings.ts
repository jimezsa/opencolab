import type { Db } from "../db.js";
import type { MeetingType } from "../types.js";
import { newId, nowIso } from "../utils.js";

interface MeetingRow {
  meeting_id: string;
  run_id: string;
  meeting_type: MeetingType;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export class MeetingService {
  constructor(private readonly db: Db) {}

  createMeeting(runId: string, meetingType: MeetingType, title: string, summary?: string): string {
    const meetingId = newId("meeting");
    const now = nowIso();
    this.db.run(
      `INSERT INTO meetings (meeting_id, run_id, meeting_type, title, summary, created_at, updated_at)
       VALUES (:meeting_id, :run_id, :meeting_type, :title, :summary, :created_at, :updated_at)`,
      {
        meeting_id: meetingId,
        run_id: runId,
        meeting_type: meetingType,
        title,
        summary: summary ?? null,
        created_at: now,
        updated_at: now
      }
    );

    return meetingId;
  }

  updateSummary(meetingId: string, summary: string): void {
    this.db.run(
      `UPDATE meetings
       SET summary = :summary,
           updated_at = :updated_at
       WHERE meeting_id = :meeting_id`,
      {
        meeting_id: meetingId,
        summary,
        updated_at: nowIso()
      }
    );
  }

  listMeetings(runId: string): Array<{ meetingId: string; meetingType: MeetingType; title: string; summary: string | null; createdAt: string; updatedAt: string }> {
    return this.db
      .all<MeetingRow>(
        `SELECT meeting_id, run_id, meeting_type, title, summary, created_at, updated_at
         FROM meetings
         WHERE run_id = :run_id
         ORDER BY created_at ASC`,
        { run_id: runId }
      )
      .map((row) => ({
        meetingId: row.meeting_id,
        meetingType: row.meeting_type,
        title: row.title,
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
  }
}
