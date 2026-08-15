import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { CloudPublisher } from "./cloud-publisher";
import { asManagedAgents, type MaEvent, type ManagedAgentsApi } from "./managed-agents.api";
import { sessionBody } from "./cloud-session-body";
import type {
  ProvisionInput,
  Runner,
  RunnerEvent,
  RunnerHandle,
  RuntimeSessionSummary,
} from "./runner.types";

/**
 * Cloud backend: Anthropic Managed Agents. Anthropic runs the agent loop and
 * provisions one sandbox container per session; AgentOS owns the policy, the
 * task/inbox semantics, and the record of what happened.
 *
 * Reconciling AgentOS state with the runtime's persistent objects lives in
 * CloudPublisher; this class only deals with one session's lifetime.
 */
@Injectable()
export class CloudManagedAgentsRunner implements Runner {
  readonly name = "cloud" as const;

  private readonly logger = new Logger(CloudManagedAgentsRunner.name);
  private readonly api: ManagedAgentsApi;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly publisher: CloudPublisher,
  ) {
    const client = new Anthropic(
      config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {},
    );
    this.api = asManagedAgents(client.beta);
  }

  async provision(input: ProvisionInput): Promise<RunnerHandle> {
    const environmentId = await this.publisher.ensureEnvironment(this.api, input.environment);
    const { agentId, version } = await this.publisher.ensureAgent(this.api, input);
    const vaultIds = await this.publisher.ensureVault(this.api, input);

    // Recorded before the runtime session exists. A crash after `create` but
    // before the handle comes back would otherwise leave a vault nothing knows
    // about — not the row, not the sweep, not a later destroy.
    await input.onVaultsCreated?.(vaultIds);

    try {
      const session = await this.api.sessions.create(
        sessionBody(input, { environmentId, agentId, version, vaultIds }),
      );
      return {
        runtimeSessionId: session.id,
        traceUrl: `https://platform.claude.com/workspaces/${this.config.ANTHROPIC_WORKSPACE}/sessions/${session.id}`,
        vaultIds,
      };
    } catch (error) {
      // The vault exists but no handle was ever returned, so nothing downstream
      // knows it is there: not the session row, not the orphan sweep. This is
      // the only moment it can still be found.
      for (const vaultId of vaultIds) {
        await this.api.vaults
          .delete(vaultId)
          .catch((cleanupError: unknown) =>
            this.logger.error(
              `vault ${vaultId} leaked after a failed provision: ${String(cleanupError)}`,
            ),
          );
      }
      throw error;
    }
  }

  /**
   * Consumes runtime events until the session goes idle for a reason other
   * than "waiting on us", or terminates. `seenEventIds` carries across
   * reconnects so a resumed session never re-processes a tool call.
   */
  async *streamEvents(handle: RunnerHandle, seenEventIds: Set<string>): AsyncIterable<RunnerEvent> {
    const stream = await this.api.sessions.events.stream(handle.runtimeSessionId);

    for await (const event of stream as AsyncIterable<MaEvent>) {
      const eventId = typeof event.id === "string" ? event.id : null;
      if (eventId && seenEventIds.has(eventId)) {
        continue;
      }
      if (eventId) {
        seenEventIds.add(eventId);
      }

      if (event.type === "agent.custom_tool_use" && eventId) {
        yield {
          kind: "tool-call",
          eventId,
          call: {
            toolUseId: eventId,
            name: String(event.name ?? ""),
            input: (event.input ?? {}) as Record<string, unknown>,
          },
        };
        continue;
      }

      if (event.type === "session.status_terminated") {
        yield { kind: "terminated" };
        return;
      }

      if (event.type === "session.error") {
        yield { kind: "error", message: event.error?.message ?? "runtime session error" };
        continue;
      }

      if (event.type === "session.status_idle") {
        const stopReason = event.stop_reason?.type ?? "end_turn";
        yield { kind: "idle", stopReason };
        // `requires_action` means the container is blocked on a tool result we
        // still owe it; anything else is the run coming to rest.
        if (stopReason !== "requires_action") {
          return;
        }
        continue;
      }

      yield {
        kind: "log",
        eventId,
        type: event.type,
        name: typeof event.name === "string" ? event.name : null,
        summary: summarize(event),
      };
    }
  }

  async injectToolResult(handle: RunnerHandle, toolUseId: string, result: string): Promise<void> {
    await this.api.sessions.events.send(handle.runtimeSessionId, {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: toolUseId,
          content: [{ type: "text", text: result }],
        },
      ],
    });
  }

  async readCost(handle: RunnerHandle): Promise<number | null> {
    try {
      const session = await this.api.sessions.retrieve(handle.runtimeSessionId);
      const amount = session.usage?.list_cost?.amount;
      // Minor units (cents) as an integer string.
      return amount ? Number(amount) / 100 : null;
    } catch (error) {
      this.logger.warn(`could not read cost for ${handle.runtimeSessionId}: ${String(error)}`);
      return null;
    }
  }

  /**
   * Archiving ends the run and frees the container. We keep the runtime record
   * (read-only) so the Console trace stays inspectable; nothing writable
   * survives, which is what SPEC §6 requires.
   */
  async destroy(handle: RunnerHandle): Promise<void> {
    // Vaults first. Archiving the session frees the container but leaves its
    // vaults — and a vault holds resolved secret values, so a missed delete
    // strands a live credential at the provider indefinitely.
    //
    // Every vault is attempted, then the archive happens regardless — freeing
    // the container is never worth skipping — but a failed delete is *rethrown*
    // afterwards. Swallowing it here made `destroy()` resolve, which told the
    // caller cleanup had succeeded and removed the session from the listing
    // that would otherwise have retried it.
    const failures: string[] = [];
    for (const vaultId of handle.vaultIds ?? []) {
      try {
        await this.api.vaults.delete(vaultId);
      } catch (error) {
        failures.push(`${vaultId} (${String(error)})`);
      }
    }
    // A session that is still running cannot be archived — the call fails and
    // the container keeps going, which is the one outcome destroy exists to
    // prevent. Interrupt first, then archive.
    await this.interrupt(handle.runtimeSessionId);
    await this.api.sessions.archive(handle.runtimeSessionId);
    if (failures.length > 0) {
      throw new Error(
        `these vaults still hold this session's credentials: ${failures.join("; ")}`,
      );
    }
  }

  async deleteVaults(vaultIds: string[]): Promise<void> {
    for (const vaultId of vaultIds) {
      await this.api.vaults.delete(vaultId);
    }
  }

  /**
   * Stops an in-flight turn so the session can be archived.
   *
   * Best effort by design: a session that is already idle has nothing to
   * interrupt, and failing here must not stop the archive that actually frees
   * the container.
   */
  private async interrupt(runtimeSessionId: string): Promise<void> {
    try {
      await this.api.sessions.events.send(runtimeSessionId, {
        events: [{ type: "user.interrupt" }],
      });
    } catch (error) {
      this.logger.warn(`interrupt before archive failed for ${runtimeSessionId}: ${String(error)}`);
    }
  }

  /**
   * Containers the runtime still has open, for the orphan sweep.
   *
   * A session whose `created_at` cannot be read is reported as starting *now*,
   * which puts it inside the sweep's grace period. Erring towards "too young to
   * touch" is the only safe direction: the cost of skipping an orphan for one
   * cycle is a few cents, and the cost of archiving a live session is an
   * agent's work.
   */
  async listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
    const open: RuntimeSessionSummary[] = [];
    // `statuses`, plural, and only idle/running/rescheduling/terminated are
    // accepted — anything else is a 400. Archived sessions drop out of the
    // listing entirely, which is what the sweep wants: they hold no container.
    for await (const session of this.api.sessions.list({ statuses: LIVE_STATUSES })) {
      const created = session.created_at ? new Date(session.created_at) : null;
      open.push({
        runtimeSessionId: session.id,
        startedAt: created && !Number.isNaN(created.getTime()) ? created : new Date(),
        projectId: session.metadata?.agentos_project ?? null,
      });
    }
    return open;
  }
}

/** The session states that still hold a container. Verified against the API. */
const LIVE_STATUSES = ["idle", "running", "rescheduling"] as const;

function summarize(event: MaEvent): string {
  if (event.type === "agent.message" && Array.isArray(event.content)) {
    const text = event.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join(" ")
      .trim();
    return text.length > 280 ? `${text.slice(0, 277)}...` : text;
  }
  if (typeof event.name === "string") {
    return event.name;
  }
  return "";
}
