import { agents, type Database, handoffs, sessions } from "@agentos/db";
import {
  type CreateHandoffInput,
  createHandoffSchema,
  HANDOFF_LIMITS,
  type HandoffDto,
} from "@agentos/shared";
import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { FilesService } from "../files/files.service";
import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class HandoffsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly files: FilesService,
  ) {}

  async createForSession(sessionId: string, raw: unknown): Promise<HandoffDto> {
    const parsed = createHandoffSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "invalid handoff");
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new BadRequestException("session not found");
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, session.agentId), eq(agents.projectId, session.projectId)),
    });
    if (!agent) throw new ForbiddenException("session agent is unavailable");
    if (parsed.data.recommendedNextRole) {
      if (!agent.collaborationList.includes(parsed.data.recommendedNextRole)) {
        throw new ForbiddenException(`recommended role ${parsed.data.recommendedNextRole} is not an authorised collaborator`);
      }
      const target = await this.db.query.agents.findFirst({
        where: and(eq(agents.projectId, session.projectId), eq(agents.name, parsed.data.recommendedNextRole)),
      });
      if (!target) throw new ForbiddenException(`recommended role ${parsed.data.recommendedNextRole} is unavailable`);
    }
    const paths = await this.files.pathsByIds(session.projectId, parsed.data.fileIds);
    if (paths.length !== parsed.data.fileIds.length) {
      throw new ForbiddenException("one or more handoff files do not belong to this project");
    }
    const [row] = await this.db.insert(handoffs).values({
      projectId: session.projectId,
      taskId: session.taskId,
      goalId: session.goalId,
      sessionId,
      fromAgentId: session.agentId,
      payload: parsed.data,
    }).returning();
    return toDto(row!);
  }

  async list(projectId: string, scope?: { taskId?: string; goalId?: string }): Promise<HandoffDto[]> {
    await this.projects.require(projectId);
    const rows = await this.db.select().from(handoffs).where(and(
      eq(handoffs.projectId, projectId),
      scope?.taskId ? eq(handoffs.taskId, scope.taskId) : undefined,
      scope?.goalId ? eq(handoffs.goalId, scope.goalId) : undefined,
    )).orderBy(handoffs.createdAt);
    return rows.map(toDto);
  }

  /**
   * The handoffs a new session should read, newest last.
   *
   * Over-reads and then keeps one row per session. `ensureForSession` is
   * find-then-insert with no unique index behind it, and there are two callers
   * for one session — the goal orchestrator and the resumer, after an operator
   * answers an inbox question. A duplicate is otherwise not inert: this list is
   * what the next specialist reads, so the same handoff would be quoted twice
   * and crowd out an older one that still mattered.
   */
  async latestFor(projectId: string, taskId: string | null, goalId: string | null): Promise<HandoffDto[]> {
    if (!taskId && !goalId) return [];
    const rows = await this.db.select().from(handoffs).where(and(
      eq(handoffs.projectId, projectId),
      taskId ? eq(handoffs.taskId, taskId) : undefined,
      goalId ? eq(handoffs.goalId, goalId) : undefined,
    )).orderBy(desc(handoffs.createdAt)).limit(HANDOFF_LIMITS.records * 2);
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      if (seen.has(row.sessionId)) return false;
      seen.add(row.sessionId);
      return true;
    });
    return unique.slice(0, HANDOFF_LIMITS.records).reverse().map(toDto);
  }

  /**
   * The orchestrator's own closing handoff, when the agent did not write one.
   *
   * The outcome here is machine-generated — a session summary that is one line
   * per agent message and per tool call, with no ceiling of its own — so it is
   * **clamped** to the schema limit rather than validated against it. Rejecting
   * it was a real failure: any implementation turn of ordinary length exceeded
   * the cap, `createForSession` threw, and the throw propagated out of the
   * goal's dispatch and killed the whole iteration *before* the stuck rail was
   * advanced, so the goal retried the same doomed turn until the spend cap or
   * the iteration ceiling stopped it. Nothing is lost by truncating: the full
   * summary is already in the goal's progress log.
   */
  async ensureForSession(sessionId: string, outcome: string): Promise<HandoffDto> {
    const existing = await this.db.query.handoffs.findFirst({ where: eq(handoffs.sessionId, sessionId) });
    if (existing) return toDto(existing);
    // A NUL byte is legal in a JS string and illegal in a Postgres `jsonb`
    // value, and agent output is where one arrives. Stripped rather than
    // escaped: the alternative is an insert that throws on text nobody can
    // see.
    const cleaned = outcome.replace(/\u0000/g, "").trim();
    return this.createForSession(sessionId, {
      outcome: clampText(cleaned || "The session ended without a narrative summary.", HANDOFF_LIMITS.outcome),
    });
  }
}

/**
 * Truncates without splitting a surrogate pair.
 *
 * A plain `slice` at the limit can cut an emoji in half and leave a lone
 * surrogate, which `jsonb` refuses outright ("Unicode low surrogate must follow
 * a high surrogate") — so the insert threw on text whose only crime was ending
 * in the wrong character.
 */
function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  const code = value.charCodeAt(end - 1);
  // A high surrogate immediately before the cut has lost its partner.
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

function toDto(row: typeof handoffs.$inferSelect): HandoffDto {
  return { id: row.id, projectId: row.projectId, taskId: row.taskId, goalId: row.goalId, sessionId: row.sessionId, fromAgentId: row.fromAgentId, ...row.payload, createdAt: row.createdAt.toISOString() };
}
