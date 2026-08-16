import { type Database, inboxMessages, sessions } from "@agentos/db";
import type {
  InboxChoice,
  InboxQuestion,
  InboxKind,
  InboxMessageDto,
  InboxStatus,
  ReplyInboxInput,
} from "@agentos/shared";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE } from "../db/db.module";
import { normaliseAnswers, renderAnswers } from "./inbox-answers";
import { inboxContext, type InboxRow, toDto } from "./inbox-dto";
import { ERROR_REPORTER, type ErrorReporter } from "../observability/error-reporter";
import { PushService } from "../push/push.service";
import { SessionQueue } from "../queue/session.queue";
import { SessionsService } from "../sessions/sessions.service";

export type { InboxRow };

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: SessionQueue,
    private readonly push: PushService,
    private readonly sessions: SessionsService,
    @Inject(ERROR_REPORTER) private readonly errors: ErrorReporter,
  ) {}

  /**
   * The operator's queue for one project.
   *
   * `projectId` was previously accepted by the controller and used only to
   * resolve a thread, so the flat list quietly returned every project's
   * questions — which is how a second workspace showed the first one's inbox.
   */
  async list(projectId?: string, status?: InboxStatus): Promise<InboxMessageDto[]> {
    const filters = [
      projectId ? eq(inboxMessages.projectId, projectId) : undefined,
      status ? eq(inboxMessages.status, status) : undefined,
    ].filter((filter) => filter !== undefined);

    const rows = await this.db
      .select()
      .from(inboxMessages)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(inboxMessages.createdAt))
      .limit(200);
    const context = await inboxContext(this.db, rows);
    return rows.map((row) => toDto(row, context));
  }

  /**
   * The thread one task or goal has with the operator (SPEC §12, §20).
   *
   * Scoped by subject rather than by session on purpose: a goal's thread is
   * shared across every specialist that works it, so the next one can read
   * what the operator already told the last one instead of asking again.
   */
  async thread(input: {
    projectId: string;
    taskId?: string | null;
    goalId?: string | null;
    limit?: number;
  }): Promise<InboxMessageDto[]> {
    const subject = input.goalId
      ? eq(inboxMessages.goalId, input.goalId)
      : input.taskId
        ? eq(inboxMessages.taskId, input.taskId)
        : null;
    if (!subject) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(inboxMessages)
      .where(and(eq(inboxMessages.projectId, input.projectId), subject))
      .orderBy(desc(inboxMessages.createdAt))
      .limit(input.limit ?? 50);
    const context = await inboxContext(this.db, rows);
    return rows.reverse().map((row) => toDto(row, context));
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
    /** Set when the agent asked more than one thing in one park. */
    questions?: InboxQuestion[];
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
        questions: input.questions ?? [],
        runtimeToolUseId: input.runtimeToolUseId,
        status: "open",
      })
      .returning();

    // The interrupt only works if it reaches the operator, so this is the one
    // place AgentOS pushes (SPEC §12).
    await this.push.send({
      title:
        input.kind === "multiple-choice"
          ? (input.questions?.length ?? 0) > 1
            ? `An agent needs ${input.questions!.length} decisions`
            : "An agent needs a decision"
          : "An agent left you a message",
      body: input.body.slice(0, 180),
      // Deep-linked: a push that lands on the top of a list makes the operator
      // find the question again on a phone, at the hour they least want to.
      url: `/inbox?id=${row!.id}`,
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
    // A message that asked several things is answered in full or not at all;
    // one that asked a single thing keeps the older single-choice check.
    const answers = normaliseAnswers(message, input);
    if (message.kind === "multiple-choice" && message.questions.length === 0) {
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
          answers,
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
      // Both halves of the answer have to come back, not just one.
      //
      // The claim moved the session to `running`; left there it is invisible to
      // the reaper and untouchable by a retry. And if the row committed as
      // `answered` before the enqueue failed, the guard at the top of this
      // method refuses every later attempt — so the park would be
      // unanswerable, and its container would sit billing until the timeout (or
      // forever, where the operator disabled it).
      if (parked && message.sessionId) {
        await this.rollback(id, message.body, message.sessionId);
      }
      throw error;
    }
  }

  /**
   * Undoes an answer whose resume could not be handed to the queue.
   *
   * Both halves in one transaction, because either alone is a trap. A message
   * left `answered` beside a parked session refuses every retry as already
   * answered; a session left `running` beside an open message is invisible to
   * the reaper and fails every resume claim. Both end the same way: a container
   * billing with nothing able to reach it.
   *
   * A rollback that itself fails is reported rather than logged — it is the one
   * outcome nothing downstream can repair.
   */
  private async rollback(id: string, originalBody: string, sessionId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(inboxMessages)
          .set({ status: "open", selectedChoiceId: null, body: originalBody, answeredAt: null })
          .where(and(eq(inboxMessages.id, id), eq(inboxMessages.status, "answered")));
        await tx
          .update(sessions)
          .set({ status: "waiting-inbox", parkedAt: new Date() })
          .where(and(eq(sessions.id, sessionId), eq(sessions.status, "running")));
      });
    } catch (rollbackError) {
      this.errors.capture(rollbackError, {
        scope: "inbox.rollback",
        tags: { inboxMessageId: id, sessionId },
      });
    }
  }

  /** The answer text the runner feeds back into the parked tool call. */
  answerText(row: InboxRow): string {
    // Several questions: the agent gets them paired with their answers, in the
    // order it asked, rather than one label with no idea which it belongs to.
    if (row.questions.length > 0 && row.answers.length > 0) {
      return renderAnswers(row.questions, row.answers);
    }
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
