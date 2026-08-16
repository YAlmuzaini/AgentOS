import {
  agents,
  type Database,
  environments,
  mcpConnections,
  repos,
  sessions,
  skills,
} from "@agentos/db";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../db/db.module";

/**
 * Removing a grantable resource, and everything that pointed at it.
 *
 * Deleting is not symmetric with creating here, because an agent holds its
 * grants as **jsonb** — `repoAccess`, `mcpConnectionIds`, `skillIds`,
 * `collaborationList`. The database cannot cascade through those, so a plain
 * `DELETE` leaves ids behind that name a row which no longer exists.
 *
 * Nothing insecure follows from a stale id: `manifest.ts` resolves every grant
 * by `(id, projectId)` and a missing row simply resolves to nothing. But the
 * agent's own screen would keep listing a repository that is gone, and an
 * operator reading that list is being told something untrue about what an agent
 * can reach. So each removal strips its own references in the same transaction.
 */
@Injectable()
export class DeletionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Agents are the one resource that can refuse.
   *
   * `sessions.agent_id` is `RESTRICT`, deliberately: a session is the record of
   * what an agent did, what it cost and what it touched, and deleting the agent
   * would either destroy that history or leave it unattributable. An agent that
   * has run is therefore kept, and the operator is told why in a sentence
   * rather than by a foreign-key error.
   */
  async removeAgent(projectId: string, id: string): Promise<void> {
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.projectId, projectId), eq(agents.id, id)),
    });
    if (!agent) {
      throw new NotFoundException(`agent ${id} not found`);
    }

    const [ran] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.agentId, id));
    if ((ran?.count ?? 0) > 0) {
      throw new ConflictException(
        `${agent.name} has ${ran!.count} session${ran!.count === 1 ? "" : "s"} on record and cannot ` +
          "be deleted without losing that history. Remove its grants instead, or delete the " +
          "sessions first if they are test runs.",
      );
    }

    await this.db.transaction(async (tx) => {
      // Other agents may list this one as a collaborator they may spawn.
      await tx
        .update(agents)
        .set({
          collaborationList: sql`${agents.collaborationList} - ${agent.name}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.projectId, projectId),
            sql`${agents.collaborationList} ? ${agent.name}`,
          ),
        );
      // Triggers cascade in the schema; the confirm dialog says so.
      await tx.delete(agents).where(eq(agents.id, id));
    });
  }

  async removeRepo(projectId: string, id: string): Promise<void> {
    await this.require(repos, projectId, id, "repo");
    await this.db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({
          // `repoAccess` is an array of objects, so the id is removed by
          // filtering the array rather than by key subtraction.
          repoAccess: sql`(
            SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
            FROM jsonb_array_elements(${agents.repoAccess}) AS entry
            WHERE entry->>'repoId' <> ${id}
          )`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agents.projectId, projectId),
            sql`${agents.repoAccess} @> ${JSON.stringify([{ repoId: id }])}::jsonb`,
          ),
        );
      await tx.delete(repos).where(eq(repos.id, id));
    });
  }

  async removeMcp(projectId: string, id: string): Promise<void> {
    await this.require(mcpConnections, projectId, id, "MCP connection");
    await this.removeIdGrant(projectId, id, "mcpConnectionIds", mcpConnections);
  }

  async removeSkill(projectId: string, id: string): Promise<void> {
    await this.require(skills, projectId, id, "skill");
    await this.removeIdGrant(projectId, id, "skillIds", skills);
  }

  /**
   * An environment is the network wall, so an agent losing one is not a
   * cosmetic change: `agents.environment_id` is `SET NULL`, and an agent with
   * no environment resolves no environment variables at all. That is the safe
   * direction — it loses reach rather than gaining it — and the confirm dialog
   * says which agents are affected.
   */
  async removeEnvironment(projectId: string, id: string): Promise<void> {
    await this.require(environments, projectId, id, "environment");
    await this.db.delete(environments).where(eq(environments.id, id));
  }

  /** How many agents would lose their environment. Read before confirming. */
  async agentsInEnvironment(projectId: string, id: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.projectId, projectId), eq(agents.environmentId, id)));
    return rows.map((row) => row.name);
  }

  /**
   * Shared by the two grants that are plain arrays of ids.
   *
   * Both statements run on `tx`. An earlier version opened a transaction and
   * then issued both through `this.db`, which put them on pool connections
   * outside it: the strip and the delete could commit separately, so a failed
   * delete left every agent's grant already gone, and each transaction held one
   * connection while waiting for another.
   */
  private async removeIdGrant(
    projectId: string,
    id: string,
    grant: "skillIds" | "mcpConnectionIds",
    table: typeof mcpConnections | typeof skills,
  ): Promise<void> {
    const column = grant === "skillIds" ? agents.skillIds : agents.mcpConnectionIds;
    await this.db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({
          [grant]: sql`(
            SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
            FROM jsonb_array_elements_text(${column}) AS value
            WHERE value <> ${id}
          )`,
          updatedAt: new Date(),
        })
        .where(and(eq(agents.projectId, projectId), sql`${column} ? ${id}`));
      await tx.delete(table).where(eq(table.id, id));
    });
  }

  private async require(
    table: typeof repos | typeof mcpConnections | typeof skills | typeof environments,
    projectId: string,
    id: string,
    label: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.projectId, projectId), eq(table.id, id)));
    if (!row) {
      throw new NotFoundException(`${label} ${id} not found`);
    }
  }
}
