import {
  type FilesystemGrant,
  type FsOperation,
  type InboxChoice,
  TASK_STATUSES,
  type TaskStatus,
} from "@agentos/shared";
import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { FilesService } from "../files/files.service";
import { GoalLogService } from "../goals/goal-log.service";
import { InboxService } from "../inbox/inbox.service";
import { TasksService } from "../tasks/tasks.service";
import type { RunnerToolCall } from "./runner.types";
import {
  TOOL_FS_DELETE,
  TOOL_FS_LIST,
  TOOL_FS_MKDIR,
  TOOL_FS_READ,
  TOOL_FS_WRITE,
  TOOL_INBOX_ASK,
  TOOL_INBOX_SEND,
  TOOL_TASK_NOTE,
  TOOL_TASK_UPDATE,
} from "./tools";

export interface ToolContext {
  sessionId: string;
  projectId: string;
  agentId: string;
  agentSlug: string;
  taskId: string | null;
  goalId: string | null;
  /** Grants — an ungranted tool is refused even if the container calls it. */
  inboxAccess: boolean;
  filesystemGrants: FilesystemGrant[];
}

const FS_TOOLS: Record<string, FsOperation> = {
  [TOOL_FS_LIST]: "list",
  [TOOL_FS_READ]: "read",
  [TOOL_FS_WRITE]: "write",
  [TOOL_FS_MKDIR]: "mkdir",
  [TOOL_FS_DELETE]: "delete",
};

export type ToolOutcome =
  | { kind: "result"; text: string }
  | { kind: "park"; inboxMessageId: string; text: null };

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
    private readonly inbox: InboxService,
    private readonly files: FilesService,
    private readonly goalLog: GoalLogService,
  ) {}

  async handle(ctx: ToolContext, call: RunnerToolCall): Promise<ToolOutcome> {
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
        case TOOL_INBOX_SEND:
          return await this.inboxSend(ctx, call.input);
        case TOOL_INBOX_ASK:
          return await this.inboxAsk(ctx, call);
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
      await this.goalLog.appendProgress(ctx.goalId, ctx.agentSlug, note);
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

  private async inboxSend(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutcome> {
    if (!ctx.inboxAccess) {
      return deny("this agent has no inbox access");
    }
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) {
      return deny("body is empty");
    }
    await this.inbox.createFromAgent({
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      goalId: ctx.goalId,
      kind: "text",
      body,
      runtimeToolUseId: null,
    });
    return { kind: "result", text: "message delivered to the operator inbox" };
  }

  /** Parks the session: no tool result is sent until the operator answers. */
  private async inboxAsk(ctx: ToolContext, call: RunnerToolCall): Promise<ToolOutcome> {
    if (!ctx.inboxAccess) {
      return deny("this agent has no inbox access");
    }
    const question = typeof call.input.question === "string" ? call.input.question.trim() : "";
    const choices = normaliseChoices(call.input.choices);
    if (!question) {
      return deny("question is empty");
    }
    if (choices.length < 2) {
      return deny("offer at least two choices");
    }

    const message = await this.inbox.createFromAgent({
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      goalId: ctx.goalId,
      kind: "multiple-choice",
      body: question,
      choices,
      runtimeToolUseId: call.toolUseId,
    });

    return { kind: "park", inboxMessageId: message.id, text: null };
  }
}

function deny(reason: string): ToolOutcome {
  return { kind: "result", text: `refused: ${reason}` };
}

function normaliseChoices(raw: unknown): InboxChoice[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const candidate = entry as { id?: unknown; label?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") {
      return [];
    }
    return [{ id: candidate.id, label: candidate.label }];
  });
}
