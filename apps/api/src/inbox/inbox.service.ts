import { type Database, inboxMessages } from "@agentos/db";
import type {
  InboxChoice,
  InboxKind,
  InboxMessageDto,
  InboxStatus,
  ReplyInboxInput,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { PushService } from "../push/push.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionsService } from "../sessions/sessions.service";

export type InboxRow = typeof inboxMessages.$inferSelect;

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: SessionQueue,
    private readonly push: PushService,
    private readonly sessions: SessionsService,
  ) {}

  async list(status?: InboxStatus): Promise<InboxMessageDto[]> {
    const rows = await this.db
      .select()
      .from(inboxMessages)
      .where(status ? eq(inboxMessages.status, status) : undefined)
      .orderBy(desc(inboxMessages.createdAt))
      .limit(200);
    return rows.map(toDto);
  }

  /**
   * Called by the session orchestrator when an agent uses an inbox tool.
   * `runtimeToolUseId` is the handle the runner replies to in order to unblock
   * the parked session (SPEC §12).
   */
  async createFromAgent(input: {
    projectId: string;
    agentId: string;
    sessionId: string;
    taskId: string | null;
    goalId?: string | null;
    kind: InboxKind;
    body: string;
    choices?: InboxChoice[];
    runtimeToolUseId: string | null;
  }): Promise<InboxRow> {
    const [row] = await this.db
      .insert(inboxMessages)
      .values({
        projectId: input.projectId,
        from: "agent",
        agentId: input.agentId,
        sessionId: input.sessionId,
        taskId: input.taskId,
        goalId: input.goalId ?? null,
        kind: input.kind,
        body: input.body,
        choices: input.choices ?? [],
        runtimeToolUseId: input.runtimeToolUseId,
        status: "open",
      })
      .returning();

    // The interrupt only works if it reaches the operator, so this is the one
    // place AgentOS pushes (SPEC §12).
    await this.push.send({
      title: input.kind === "multiple-choice" ? "An agent needs a decision" : "An agent left you a message",
      body: input.body.slice(0, 180),
      url: "/inbox",
    });
    return row!;
  }

  /** Answering an open message resumes the waiting session. */
  async reply(id: string, input: ReplyInboxInput): Promise<InboxMessageDto> {
    const message = await this.require(id);
    if (message.status !== "open") {
      throw new BadRequestException(`inbox message ${id} is already ${message.status}`);
    }
    // Validation first. The claim below moves the session out of
    // `waiting-inbox`, and a rejected answer must not leave it there: parked is
    // the only state the reaper and the resume path both understand.
    if (message.kind === "multiple-choice") {
      const valid = message.choices.some((choice) => choice.id === input.selectedChoiceId);
      if (!valid) {
        throw new BadRequestException("selectedChoiceId is not one of the offered choices");
      }
    }

    // Only a message that actually parked a session needs claiming — a note
    // from `inbox_send` is one-way, and its session is long finished by the
    // time anyone replies. For a real question the reaper may be reaping this
    // very session: whichever writes first wins, and the loser is told so
    // rather than leaving an answered message attached to a dead container.
    const parked = Boolean(message.sessionId && message.runtimeToolUseId);
    if (parked && !(await this.sessions.claimForResume(message.sessionId!))) {
      throw new BadRequestException(
        `the session for message ${id} has already ended; its question can no longer be answered`,
      );
    }

    try {
      const [row] = await this.db
        .update(inboxMessages)
        .set({
          status: "answered",
          selectedChoiceId: input.selectedChoiceId ?? null,
          body: input.body?.trim() ? `${message.body}\n\n> ${input.body.trim()}` : message.body,
          answeredAt: new Date(),
        })
        .where(eq(inboxMessages.id, id))
        .returning();

      if (parked && row?.sessionId) {
        await this.queue.enqueueResume(row.sessionId, row.id);
      }
      return toDto(row!);
    } catch (error) {
      // The claim already moved the session to `running`. Left there, it is
      // invisible to the reaper and untouchable by a retry — a container with
      // no way back. Put it where it was and let the operator try again.
      if (parked && message.sessionId) {
        await this.sessions
          .returnToPark(message.sessionId)
          .catch((restoreError: unknown) =>
            this.logger.error(
              `session ${message.sessionId} is stuck as running after a failed reply: ${String(restoreError)}`,
            ),
          );
      }
      throw error;
    }
  }

  /** The answer text the runner feeds back into the parked tool call. */
  answerText(row: InboxRow): string {
    if (row.selectedChoiceId) {
      const choice = row.choices.find((candidate) => candidate.id === row.selectedChoiceId);
      return choice?.label ?? row.selectedChoiceId;
    }
    const parts = row.body.split("\n\n> ");
    return parts.length > 1 ? parts[parts.length - 1]! : row.body;
  }

  /**
   * Closes an open question whose session is gone.
   *
   * The question text is kept and the reason appended: what an agent wanted to
   * know is usually still worth reading, and an answer box on a message nobody
   * can answer is worse than none.
   */
  async closeForSession(sessionId: string, reason: string): Promise<void> {
    const open = await this.findOpenForSession(sessionId);
    if (!open) {
      return;
    }
    await this.db
      .update(inboxMessages)
      .set({ status: "closed", body: `${open.body}\n\n_${reason}_` })
      .where(eq(inboxMessages.id, open.id));
  }

  async findOpenForSession(sessionId: string): Promise<InboxRow | undefined> {
    return this.db.query.inboxMessages.findFirst({
      where: and(eq(inboxMessages.sessionId, sessionId), eq(inboxMessages.status, "open")),
    });
  }

  async require(id: string): Promise<InboxRow> {
    const row = await this.db.query.inboxMessages.findFirst({
      where: eq(inboxMessages.id, id),
    });
    if (!row) {
      throw new NotFoundException(`inbox message ${id} not found`);
    }
    return row;
  }
}

export function toDto(row: InboxRow): InboxMessageDto {
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
    status: row.status,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
