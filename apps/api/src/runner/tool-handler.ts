import {
  authorizeFs,
  type FsOperation,
  TASK_STATUSES,
  type TaskStatus,
} from "@agentos/shared";
import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { CatalogService } from "../resources/catalog.service";
import { FilesService } from "../files/files.service";
import { GoalLogService } from "../goals/goal-log.service";
import { SessionsService } from "../sessions/sessions.service";
import { TasksService } from "../tasks/tasks.service";
import { InboxToolHandler } from "./inbox-tools";
import type { RunnerToolCall } from "./runner.types";
import { deny, type ToolContext, type ToolOutcome } from "./tool-types";
import {
  TOOL_ATTACH_FILE,
  TOOL_FS_DELETE,
  TOOL_FS_LIST,
  TOOL_FS_MKDIR,
  TOOL_FS_READ,
  TOOL_FS_WRITE,
  TOOL_INBOX_ASK,
  TOOL_INBOX_READ,
  TOOL_INBOX_SEND,
  TOOL_READ_SUBTASK,
  TOOL_RECORD_COMMIT,
  TOOL_SPAWN,
  TOOL_TASK_NOTE,
  TOOL_TASK_UPDATE,
} from "./tools";
import { CollaborationService } from "./collaboration";

/** Re-exported so existing callers keep importing from the handler. */
export type { ToolContext, ToolOutcome } from "./tool-types";

const FS_TOOLS: Record<string, FsOperation> = {
  [TOOL_FS_LIST]: "list",
  [TOOL_FS_READ]: "read",
  [TOOL_FS_WRITE]: "write",
  [TOOL_FS_MKDIR]: "mkdir",
  [TOOL_FS_DELETE]: "delete",
};

/**
 * Executes the AgentOS and Inbox tool calls on the container's behalf. Every
 * call is authorised here, in the control plane — the container never holds a
 * credential that could bypass this.
 */
@Injectable()
export class AgentToolHandler {
  private readonly logger = new Logger(AgentToolHandler.name);

  constructor(
    private readonly tasks: TasksService,
    private readonly inbox: InboxToolHandler,
    private readonly files: FilesService,
    private readonly goalLog: GoalLogService,
    private readonly collaboration: CollaborationService,
    private readonly catalog: CatalogService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * @param signal cancellation for the run this call belongs to. A tool that
   * waits — spawning collaborators does — must stop waiting when the goal's
   * deadline or lease revocation ends the session around it.
   */
  async handle(
    ctx: ToolContext,
    call: RunnerToolCall,
    signal?: AbortSignal | null,
  ): Promise<ToolOutcome> {
    try {
      const fsOperation = FS_TOOLS[call.name];
      if (fsOperation) {
        return await this.filesystem(ctx, fsOperation, call.input);
      }

      switch (call.name) {
        case TOOL_TASK_UPDATE:
          return await this.updateTask(ctx, call.input);
        case TOOL_TASK_NOTE:
          return await this.addNote(ctx, call.input);
        case TOOL_ATTACH_FILE:
          return await this.attachFile(ctx, call.input);
        case TOOL_RECORD_COMMIT:
          return await this.recordCommit(ctx, call.input);
        case TOOL_INBOX_SEND:
          return await this.inbox.send(ctx, call.input);
        case TOOL_INBOX_ASK:
          return await this.inbox.ask(ctx, call);
        case TOOL_INBOX_READ:
          return await this.inbox.read(ctx);
        case TOOL_SPAWN:
          return { kind: "result", text: await this.collaboration.spawn(ctx, call.input, signal) };
        case TOOL_READ_SUBTASK:
          return { kind: "result", text: await this.collaboration.readSubtask(ctx, call.input) };
        default:
          return deny(`unknown tool "${call.name}"`);
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        // Surfaced back to the agent verbatim so it adapts instead of retrying.
        return deny(String((error.getResponse() as { message?: string })?.message ?? error.message));
      }
      this.logger.error(`tool ${call.name} failed: ${String(error)}`);
      return deny(`tool failed: ${String(error)}`);
    }
  }

  /**
   * Every filesystem call is authorised against the agent's folder grants
   * before it reaches storage; the refusal is returned to the agent as text so
   * it can adapt rather than crash (SPEC §7).
   */
  private async filesystem(
    ctx: ToolContext,
    operation: FsOperation,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path) {
      return deny("path is required");
    }
    const result = await this.files.runAsAgent(
      ctx.projectId,
      { agentSlug: ctx.agentSlug, grants: ctx.filesystemGrants },
      operation,
      path,
      {
        content: typeof input.content === "string" ? input.content : undefined,
        mime: typeof input.mime === "string" ? input.mime : undefined,
      },
    );
    return { kind: "result", text: result.text };
  }

  private async updateTask(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    if (!ctx.taskId) {
      return deny("this session is not attached to a task");
    }
    const status = String(input.status ?? "");
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      return deny(`status must be one of ${TASK_STATUSES.join(", ")}`);
    }

    await this.tasks.setStatusFromAgent(ctx.taskId, status as TaskStatus);

    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note) {
      await this.tasks.addActivity({
        taskId: ctx.taskId,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        body: note,
      });
    }
    return { kind: "result", text: `task status is now "${status}"` };
  }

  /**
   * Progress goes to whichever shared surface this session has: a task's
   * activity feed, or the goal's append-only progress log, which is what the
   * next specialist and the orchestrator both read (SPEC §11).
   */
  private async addNote(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (!note) {
      return deny("note is empty");
    }
    if (ctx.goalId) {
      // The one call that counts as progress for the stuck rail: an agent
      // saying, in its own tool call, that it did something.
      await this.goalLog.appendProgress(ctx.goalId, ctx.agentSlug, note, { marksProgress: true });
      return { kind: "result", text: "progress recorded on the goal log" };
    }
    if (!ctx.taskId) {
      return deny("this session is attached to neither a task nor a goal");
    }
    await this.tasks.addActivity({
      taskId: ctx.taskId,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      body: note,
    });
    return { kind: "result", text: "activity recorded" };
  }

  /**
   * Attaches a file the agent wrote to the task it is working (SPEC §4).
   *
   * Authorised as a read of that path: an agent may only attach a file it
   * could read anyway, so this cannot be used to hand the next step something
   * out of a folder this agent was never granted.
   */
  private async attachFile(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    if (!ctx.taskId) {
      return deny("this session is not attached to a task");
    }
    const path = typeof input.path === "string" ? input.path.trim() : "";
    if (!path) {
      return deny("path is required");
    }
    const decision = authorizeFs({
      agentSlug: ctx.agentSlug,
      grants: ctx.filesystemGrants,
      operation: "read",
      path,
    });
    if (!decision.allowed) {
      return deny(decision.reason);
    }
    const file = await this.files.idForPath(ctx.projectId, decision.path);
    const attachments = await this.tasks.attach(ctx.taskId, file.id);
    return {
      kind: "result",
      text: `attached ${file.path} (${attachments.length} attachment(s) on this task)`,
    };
  }

  /**
   * Records a commit the agent says it made (SPEC §6).
   *
   * Attested, not observed: the cloud runtime owns the checkout and there is
   * no moment after the run where AgentOS could go and look. A backend that
   * *can* look — the local worker — is read separately at teardown, and the
   * two are merged, so an honest agent and a verified workspace agree.
   */
  private async recordCommit(
    ctx: ToolContext,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome> {
    if (ctx.writableRepoIds.length === 0) {
      return deny("this agent has no git-write grant, so it has no commits to record");
    }
    const sha = typeof input.sha === "string" ? input.sha.trim() : "";
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      return deny("sha must be a git object id (7–40 hex characters)");
    }
    // The repository has to be one this agent may write. Recording a sha
    // against an arbitrary label is a claim about somebody else's repository,
    // and the session row is where the operator goes to believe it.
    const claimed = typeof input.repo === "string" ? input.repo.trim() : "";
    const writable = (await this.catalog.listRepos(ctx.projectId))
      .filter((repo) => ctx.writableRepoIds.includes(repo.id))
      .map((repo) => repo.name);
    if (!writable.includes(claimed)) {
      return deny(
        `"${claimed}" is not a repository you hold git-write on (${writable.join(", ") || "none"})`,
      );
    }
    const repo = claimed.slice(0, 200);
    const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 300) : "";

    const shas = await this.sessions.recordCommits(ctx.sessionId, [sha]);
    const line = `commit ${sha.slice(0, 12)}${repo ? ` in ${repo}` : ""}${subject ? `: ${subject}` : ""}`;
    if (ctx.taskId) {
      await this.tasks.addActivity({
        taskId: ctx.taskId,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        body: line,
      });
    } else if (ctx.goalId) {
      await this.goalLog.appendProgress(ctx.goalId, ctx.agentSlug, line, { marksProgress: true });
    }
    return { kind: "result", text: `recorded ${shas.length} commit(s) on this session` };
  }

}
