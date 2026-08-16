import type { SessionDto } from "@agentos/shared";
import type { SessionRow } from "./sessions.service";

export function toDto(row: SessionRow): SessionDto {
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
  };
}
