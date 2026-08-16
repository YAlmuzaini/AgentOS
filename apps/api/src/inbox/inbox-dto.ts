import { agents, type Database, goals, inboxMessages, tasks } from "@agentos/db";
import type { InboxMessageDto } from "@agentos/shared";
import { inArray } from "drizzle-orm";

export type InboxRow = typeof inboxMessages.$inferSelect;

/** Who asked and what about, resolved once for a whole page of messages. */
export interface InboxContext {
  agentNames: Map<string, string>;
  taskNames: Map<string, string>;
  goalTitles: Map<string, string>;
}

const EMPTY: InboxContext = {
  agentNames: new Map(),
  taskNames: new Map(),
  goalTitles: new Map(),
};

/**
 * Resolves the names behind the ids on a set of messages.
 *
 * Three batched lookups rather than one join per row: the inbox is polled
 * every few seconds, and a message carries at most one agent, one task and one
 * goal. Without this the screen can only say "an agent is waiting on you",
 * which is the one thing the operator already knows.
 */
export async function inboxContext(db: Database, rows: InboxRow[]): Promise<InboxContext> {
  if (rows.length === 0) {
    return EMPTY;
  }
  const agentIds = unique(rows.map((row) => row.agentId));
  const taskIds = unique(rows.map((row) => row.taskId));
  const goalIds = unique(rows.map((row) => row.goalId));

  const [agentRows, taskRows, goalRows] = await Promise.all([
    agentIds.length
      ? db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds))
      : [],
    taskIds.length
      ? db.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds))
      : [],
    goalIds.length
      ? db.select({ id: goals.id, title: goals.title }).from(goals).where(inArray(goals.id, goalIds))
      : [],
  ]);

  return {
    agentNames: new Map(agentRows.map((row) => [row.id, row.name])),
    taskNames: new Map(taskRows.map((row) => [row.id, row.name])),
    goalTitles: new Map(goalRows.map((row) => [row.id, row.title])),
  };
}

export function toDto(row: InboxRow, context: InboxContext = EMPTY): InboxMessageDto {
  return {
    id: row.id,
    projectId: row.projectId,
    from: row.from,
    agentId: row.agentId,
    sessionId: row.sessionId,
    taskId: row.taskId,
    goalId: row.goalId,
    kind: row.kind,
    body: row.body,
    choices: row.choices,
    selectedChoiceId: row.selectedChoiceId,
    questions: row.questions,
    answers: row.answers,
    status: row.status,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    agentName: row.agentId ? (context.agentNames.get(row.agentId) ?? null) : null,
    subject: subjectOf(row, context),
  };
}

/**
 * What the message is about. A goal wins over a task when a message somehow
 * carries both: the goal is the longer-lived thing, and the one the operator
 * is tracking.
 */
function subjectOf(row: InboxRow, context: InboxContext): InboxMessageDto["subject"] {
  if (row.goalId) {
    return { kind: "goal", id: row.goalId, name: context.goalTitles.get(row.goalId) ?? "a goal" };
  }
  if (row.taskId) {
    return { kind: "task", id: row.taskId, name: context.taskNames.get(row.taskId) ?? "a task" };
  }
  return null;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
