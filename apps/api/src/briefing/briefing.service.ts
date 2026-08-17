import { type Database, goalDecisions, goals, inboxMessages, preflightChecks, sessions, tasks } from "@agentos/db";
import type { BriefingItem, ExecutiveBriefingDto } from "@agentos/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class BriefingService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly projects: ProjectsService) {}

  async get(projectId: string, since?: Date): Promise<ExecutiveBriefingDto> {
    await this.projects.require(projectId);
    const from = since ?? new Date(Date.now() - 24 * 60 * 60_000);
    const longBefore = new Date(Date.now() - 60 * 60_000);
    const [openInbox, stoppedGoals, completedTasks, completedGoals, reviewTasks, longSessions, failedSessions, failedDecisions, failedPreflights, recentSessions, activeGoals] = await Promise.all([
      this.db.select().from(inboxMessages).where(and(eq(inboxMessages.projectId, projectId), eq(inboxMessages.status, "open"))).orderBy(desc(inboxMessages.createdAt)),
      this.db.select().from(goals).where(and(eq(goals.projectId, projectId), inArray(goals.status, ["stopped-spend", "stopped-time", "stopped-stuck"]))),
      this.db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, "done"), gte(tasks.updatedAt, from))),
      this.db.select().from(goals).where(and(eq(goals.projectId, projectId), eq(goals.status, "completed"), gte(goals.updatedAt, from))),
      this.db.select().from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, "review"))),
      this.db.select().from(sessions).where(and(eq(sessions.projectId, projectId), notInArray(sessions.status, ["failed", "destroyed"]), lt(sessions.startedAt, longBefore))),
      this.db.select().from(sessions).where(and(eq(sessions.projectId, projectId), eq(sessions.status, "failed"), gte(sessions.startedAt, from))),
      this.db.select().from(goalDecisions).where(and(eq(goalDecisions.projectId, projectId), eq(goalDecisions.status, "failed"), gte(goalDecisions.createdAt, from))),
      this.db.select().from(preflightChecks).where(and(eq(preflightChecks.projectId, projectId), eq(preflightChecks.ready, "blocked"), gte(preflightChecks.checkedAt, from))),
      this.db.select().from(sessions).where(and(eq(sessions.projectId, projectId), gte(sessions.startedAt, from))),
      this.db.select().from(goals).where(and(eq(goals.projectId, projectId), eq(goals.status, "active"))),
    ]);
    const item = (id: string, title: string, detail: string, at: Date, href: string): BriefingItem => ({ id, title, detail, at: at.toISOString(), href });
    const failures = [
      ...failedSessions.map((row) => item(row.id, "Session failed", row.error ?? "No error detail was recorded.", row.endedAt ?? row.startedAt, `/sessions?id=${row.id}`)),
      ...failedDecisions.map((row) => item(row.id, "Goal decision failed", `${row.backend} evaluator: ${row.errorCode ?? "unknown error"}`, row.createdAt, `/goals/${row.goalId}`)),
      ...failedPreflights.map((row) => item(row.id, `${row.subjectType} failed preflight`, row.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message).join(" ").slice(0, 600), row.checkedAt, row.subjectType === "goal" && row.subjectId ? `/goals/${row.subjectId}` : "/project")),
      ...recentSessions.filter((row) => row.publish?.retainedWorkspace).map((row) => item(row.id, "Local publish needs recovery", row.publish!.retainedWorkspace!, row.endedAt ?? row.startedAt, `/sessions?id=${row.id}`)),
    ];
    const cloud = recentSessions.filter((row) => row.runner === "cloud");
    const local = recentSessions.filter((row) => row.runner === "local");
    return {
      projectId,
      since: from.toISOString(),
      generatedAt: new Date().toISOString(),
      decisions: openInbox.map((row) => item(row.id, "Decision waiting", row.body.slice(0, 300), row.createdAt, `/inbox?id=${row.id}`)),
      blocked: [
        ...stoppedGoals.map((row) => item(row.id, row.title, row.stoppedReason ?? row.status, row.updatedAt, `/goals/${row.id}`)),
      ],
      completed: [
        ...completedTasks.map((row) => item(row.id, row.name, "Task completed", row.updatedAt, `/tasks?id=${row.id}`)),
        ...completedGoals.map((row) => item(row.id, row.title, "Goal completed", row.updatedAt, `/goals/${row.id}`)),
      ].sort((a, b) => b.at.localeCompare(a.at)),
      readyForReview: reviewTasks.map((row) => item(row.id, row.name, "Task or branch is ready for operator review.", row.updatedAt, `/tasks?id=${row.id}`)),
      unusuallyLong: longSessions.map((row) => item(row.id, `Session running unusually long`, `Started ${row.startedAt.toISOString()} on ${row.runner}.`, row.startedAt, `/sessions?id=${row.id}`)),
      failures,
      continueWithoutMe: activeGoals.map((row) => item(row.id, row.title, "Active goal has no open operator decision.", row.updatedAt, `/goals/${row.id}`)).filter((entry) => !openInbox.some((message) => message.goalId === entry.id)),
      execution: {
        cloudSessions: cloud.length,
        cloudCostUsd: cloud.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
        localSessions: local.length,
        localSubscriptionSessions: local.filter((row) => row.billingMode === "subscription").length,
        localMeteredSessions: local.filter((row) => row.billingMode === "metered-api").length,
        localUnknownSessions: local.filter((row) => row.billingMode === "unknown").length,
      },
    };
  }
}
