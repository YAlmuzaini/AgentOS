import { type Database } from "@agentos/db";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

export interface ActivityEntryDto {
  id: string;
  kind: "task-activity" | "session" | "inbox" | "goal";
  at: string;
  title: string;
  detail: string;
  taskId: string | null;
  sessionId: string | null;
  goalId: string | null;
}

/**
 * The global feed (SPEC §13).
 *
 * Derived from the domain tables rather than written to a separate log: a feed
 * that can disagree with the thing it describes is worse than no feed, and
 * every row here already has a home.
 */
@Injectable()
export class ActivityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async recent(projectId: string, limit = 100): Promise<ActivityEntryDto[]> {
    const rows = await this.db.execute<{
      id: string;
      kind: ActivityEntryDto["kind"];
      at: Date;
      title: string;
      detail: string;
      task_id: string | null;
      session_id: string | null;
      goal_id: string | null;
    }>(sql`
      SELECT * FROM (
        SELECT ta.id,
               'task-activity'::text AS kind,
               ta.created_at         AS at,
               t.name                AS title,
               ta.body               AS detail,
               ta.task_id, ta.session_id, NULL::uuid AS goal_id
        FROM task_activity ta
        JOIN tasks t ON t.id = ta.task_id
        WHERE t.project_id = ${projectId}

        UNION ALL

        SELECT s.id,
               'session'::text,
               COALESCE(s.ended_at, s.started_at),
               a.name || ' session ' || s.status,
               COALESCE(s.error, ''),
               s.task_id, s.id, s.goal_id
        FROM sessions s
        JOIN agents a ON a.id = s.agent_id
        WHERE s.project_id = ${projectId}

        UNION ALL

        SELECT i.id,
               'inbox'::text,
               i.created_at,
               CASE WHEN i.kind = 'multiple-choice' THEN 'question for you' ELSE 'message for you' END,
               i.body,
               i.task_id, i.session_id, i.goal_id
        FROM inbox_messages i
        WHERE i.project_id = ${projectId}

        UNION ALL

        SELECT g.id,
               'goal'::text,
               g.updated_at,
               'goal ' || g.status || ': ' || g.title,
               COALESCE(g.stopped_reason, ''),
               NULL::uuid, NULL::uuid, g.id
        FROM goals g
        WHERE g.project_id = ${projectId}
      ) feed
      ORDER BY at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      at: new Date(row.at).toISOString(),
      title: row.title,
      detail: row.detail,
      taskId: row.task_id,
      sessionId: row.session_id,
      goalId: row.goal_id,
    }));
  }
}
