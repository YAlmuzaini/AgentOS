import { type Database, sessions as sessionsTable, tasks as tasksTable } from "@agentos/db";
import { TERMINAL_SESSION_STATUSES, type TaskDto } from "@agentos/shared";
import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import { AgentsService } from "../agents/agents.service";
import { DATABASE } from "../db/db.module";
import { FilesService } from "../files/files.service";
import { TasksService } from "../tasks/tasks.service";
import type { ToolContext } from "./tool-handler";

/**
 * The collaboration list, made real (SPEC §5.10, §10 step 3).
 *
 * A coordinator spawns its specialists as subtasks, each in its own container
 * with its own grants, and waits for their reports. Three rails bound it: the
 * target must be on the spawning agent's own list, one session may spawn only
 * so many, and a spawned card may not spawn indefinitely deeper.
 *
 * **What the rails here are, and are not.** A spawned subtask runs as a task
 * session, so its spend is recorded on its own session row and is *not* booked
 * against a goal's spend cap when the spawner was a goal specialist. The count
 * and depth ceilings below are what bound that: at most
 * `MAX_SPAWNS_PER_SESSION` per session, at most `MAX_SPAWN_DEPTH` deep, and
 * only agents the operator put on a collaboration list — which by default is
 * the review coordinator and nobody else.
 */
export const MAX_SPAWNS_PER_SESSION = 8;
export const MAX_SPAWN_DEPTH = 2;
const DEFAULT_WAIT_MINUTES = 20;
const MAX_WAIT_MINUTES = 60;
const POLL_MS = 3_000;

interface CollaboratorRequest {
  agent: string;
  name: string;
  brief: string;
}

interface SpawnedSubtask {
  request: CollaboratorRequest;
  task: TaskDto;
}

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly agents: AgentsService,
    private readonly files: FilesService,
  ) {}

  /**
   * Spawns every requested collaborator, then waits for all of them.
   *
   * They are created before any waiting starts, so four reviewers run in
   * parallel rather than one after another. The wait is bounded and returns
   * what it has: a coordinator that gets three of four reports can still
   * consolidate and say what is missing.
   */
  async spawn(
    ctx: ToolContext,
    input: Record<string, unknown>,
    signal?: AbortSignal | null,
  ): Promise<string> {
    if (ctx.collaborationList.length === 0) {
      throw new ForbiddenException("this agent has no collaboration list, so it may not spawn");
    }
    // A goal grows by orchestrator dispatch, and only by that: every specialist
    // it runs is counted against the spend, time and stuck rails before it
    // starts. A spawned subtask is an ordinary task session — no budget, no
    // deadline, and it outlives a goal that stops — so eight of them per turn,
    // two deep, would be dozens of sessions no rail can see. The goal asks for
    // the next specialist through its own loop instead.
    if (ctx.goalId) {
      throw new ForbiddenException(
        "a goal session may not spawn collaborators: its rails only count specialists the goal " +
          "orchestrator dispatches. Record what you need in the progress log and finish; the " +
          "orchestrator will dispatch the next specialist.",
      );
    }
    const requests = parseRequests(input.collaborators);
    if (requests.length === 0) {
      throw new ForbiddenException("collaborators must be a non-empty list of {agent, name, brief}");
    }

    const parent = ctx.taskId ? await this.tasks.requireById(ctx.taskId) : null;
    const depth = (parent?.spawnDepth ?? 0) + 1;
    if (depth > MAX_SPAWN_DEPTH) {
      throw new ForbiddenException(
        `spawn depth ${depth} exceeds the ceiling of ${MAX_SPAWN_DEPTH}; do this work yourself`,
      );
    }
    const already = await this.tasks.countSpawnedBySession(ctx.sessionId);
    if (already + requests.length > MAX_SPAWNS_PER_SESSION) {
      throw new ForbiddenException(
        `this session may spawn ${MAX_SPAWNS_PER_SESSION} collaborators in total and has already spawned ${already}`,
      );
    }

    // Every request is checked before *any* card exists. Validating inside the
    // creation loop meant a list of four with one bad name left two
    // collaborators already running, spending, and unreported — the refusal
    // reached the coordinator, the containers did not.
    //
    // The list check is here rather than trusted from the tool schema: the
    // schema is what the model sees, this is what decides.
    const targets = new Map<string, string>();
    for (const request of requests) {
      if (!ctx.collaborationList.includes(request.agent)) {
        throw new ForbiddenException(
          `"${request.agent}" is not on your collaboration list (${ctx.collaborationList.join(", ")})`,
        );
      }
      if (!targets.has(request.agent)) {
        targets.set(request.agent, (await this.agents.requireByName(ctx.projectId, request.agent)).id);
      }
    }

    const spawned: SpawnedSubtask[] = [];
    for (const request of requests) {
      const targetId = targets.get(request.agent)!;
      const task = await this.tasks.createSpawned(
        ctx.projectId,
        {
          name: request.name,
          description: request.brief,
          assigneeType: "agent",
          assigneeAgentId: targetId,
          // The parent's attachments travel with the brief: a plan reviewer
          // that cannot see the plan is a reviewer of nothing.
          attachmentIds: parent?.attachmentIds ?? [],
          approvalGate: false,
          scheduleKind: "now",
          runAt: null,
          cron: null,
          timezone: null,
        },
        {
          parentTaskId: ctx.taskId,
          spawnedByAgentId: ctx.agentId,
          spawnedBySessionId: ctx.sessionId,
          spawnDepth: depth,
        },
      );
      spawned.push({ request, task });
    }

    const waitMinutes = clampWait(input.waitMinutes);
    this.logger.log(
      `session ${ctx.sessionId} spawned ${spawned.length} collaborator(s): ` +
        `${spawned.map((entry) => entry.request.agent).join(", ")}`,
    );
    const finishedBy = Date.now() + waitMinutes * 60_000;
    await this.waitForAll(
      spawned.map((entry) => entry.task.id),
      finishedBy,
      signal,
    );
    return this.report(ctx.projectId, spawned);
  }

  /** One subtask's current state, for a coordinator whose wait ran out. */
  async readSubtask(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
    const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
    if (!taskId) {
      throw new ForbiddenException("taskId is required");
    }
    const task = await this.tasks.requireById(taskId).catch(() => null);
    // Lineage is the authorisation: an agent may read a card it spawned, and
    // nothing else. Otherwise this is a project-wide task reader.
    if (!task || task.spawnedBySessionId !== ctx.sessionId) {
      throw new ForbiddenException(`no subtask ${taskId} was spawned by this session`);
    }
    const agent = task.assigneeAgentId
      ? await this.agents.requireById(task.assigneeAgentId).catch(() => null)
      : null;
    return this.describe(ctx.projectId, task.name, agent?.name ?? "unassigned", task.id);
  }

  /** Polls until every subtask has ended, the wait expires, or the run is cut off. */
  private async waitForAll(
    taskIds: string[],
    finishedBy: number,
    signal?: AbortSignal | null,
  ): Promise<void> {
    while (Date.now() < finishedBy && !signal?.aborted) {
      const outstanding = await this.unfinished(taskIds);
      if (outstanding.length === 0) {
        return;
      }
      const slept = await sleep(Math.min(POLL_MS, finishedBy - Date.now()), signal);
      if (!slept) {
        return;
      }
    }
  }

  /**
   * Which of these subtasks are still going.
   *
   * A card that reached `review` or `done` is finished. So is one whose every
   * session has ended without it: an agent that crashed leaves a card in
   * `doing` for ever, and waiting twenty minutes for a container that no
   * longer exists helps nobody.
   */
  private async unfinished(taskIds: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: tasksTable.id, status: tasksTable.status })
      .from(tasksTable)
      .where(inArray(tasksTable.id, taskIds));
    const open = rows
      .filter((row) => row.status !== "done" && row.status !== "review")
      .map((row) => row.id);
    if (open.length === 0) {
      return [];
    }

    const runs = await this.db
      .select({ taskId: sessionsTable.taskId, status: sessionsTable.status })
      .from(sessionsTable)
      .where(inArray(sessionsTable.taskId, open));

    const live = new Set(
      runs
        .filter((row) => !TERMINAL_SESSION_STATUSES.includes(row.status))
        .map((row) => row.taskId),
    );
    const everRan = new Set(runs.map((row) => row.taskId));
    // A card with no session at all is still starting: the queue has not
    // picked it up yet, so it counts as outstanding.
    return open.filter((id) => live.has(id) || !everRan.has(id));
  }

  private async report(projectId: string, spawned: SpawnedSubtask[]): Promise<string> {
    const parts: string[] = [];
    for (const entry of spawned) {
      parts.push(await this.describe(projectId, entry.request.name, entry.request.agent, entry.task.id));
    }
    return parts.join("\n\n");
  }

  /** One subtask rendered for the coordinator: status, notes, attachments. */
  private async describe(
    projectId: string,
    name: string,
    agentName: string,
    taskId: string,
  ): Promise<string> {
    const task = await this.tasks.requireById(taskId);
    const activity = await this.tasks.listActivity(taskId);
    const attachments = await this.files.pathsByIds(projectId, task.attachmentIds);
    const notes = activity.length
      ? activity.map((entry) => `- ${entry.body}`).join("\n")
      : "- (it recorded no notes)";
    const files = attachments.length ? `attachments: ${attachments.join(", ")}` : "attachments: none";
    return [
      `## ${name} — ${agentName} — status "${task.status}" (task ${taskId})`,
      notes,
      files,
    ].join("\n");
  }
}

function parseRequests(raw: unknown): CollaboratorRequest[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const candidate = entry as { agent?: unknown; name?: unknown; brief?: unknown };
    const agent = typeof candidate.agent === "string" ? candidate.agent.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const brief = typeof candidate.brief === "string" ? candidate.brief.trim() : "";
    if (!agent || !name || !brief) {
      return [];
    }
    return [{ agent, name, brief }];
  });
}

function clampWait(raw: unknown): number {
  const requested = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_WAIT_MINUTES;
  return Math.min(MAX_WAIT_MINUTES, Math.max(1, requested));
}

/** Resolves false when the run was cut off rather than the timer firing. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
