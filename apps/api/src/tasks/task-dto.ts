import type { taskActivity, tasks } from "@agentos/db";
import type { TaskActivityDto, TaskDto } from "@agentos/shared";

type TaskRow = typeof tasks.$inferSelect;

/** Row → DTO. Kept beside the service rather than inside it, for size. */
export function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    status: row.status,
    assigneeType: row.assigneeType,
    assigneeAgentId: row.assigneeAgentId,
    attachmentIds: row.attachmentIds,
    approvalGate: row.approvalGate,
    chainId: row.chainId,
    chainIndex: row.chainIndex,
    templateId: row.templateId,
    parentTaskId: row.parentTaskId,
    spawnedByAgentId: row.spawnedByAgentId,
    spawnDepth: row.spawnDepth,
    scheduleKind: row.scheduleKind,
    runAt: row.runAt?.toISOString() ?? null,
    cron: row.cron,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function activityToDto(row: typeof taskActivity.$inferSelect): TaskActivityDto {
  return {
    id: row.id,
    taskId: row.taskId,
    sessionId: row.sessionId,
    agentId: row.agentId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
