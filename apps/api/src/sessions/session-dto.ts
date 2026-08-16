import type { SessionDto } from "@agentos/shared";
import type { SessionRow } from "./sessions.service";

/**
 * @param agentName joined by the caller. A session that names only an agent id
 * makes the operator open another screen to learn who ran.
 */
export function toDto(row: SessionRow, agentName: string | null = null): SessionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    taskId: row.taskId,
    goalId: row.goalId,
    runner: row.runner,
    status: row.status,
    runtimeHandle: row.runtimeHandle,
    traceUrl: row.traceUrl,
    toolCallLog: row.toolCallLog,
    commitShas: row.commitShas,
    costUsd: row.costUsd != null ? Number(row.costUsd) : null,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    access: row.access ?? null,
    agentName,
  };
}
