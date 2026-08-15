import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AgentRow } from "../agents/agents.service";
import { LocalVmRunner } from "./local-runner";
import { type Runner, RUNNER_CLOUD } from "./runner.types";

export interface RoutingRequest {
  agent: AgentRow;
  /** A goal's own preference wins over the agent's (SPEC §16). */
  goalPreference?: "cloud" | "local" | "auto" | null;
}

/**
 * Picks the backend for one session (SPEC §16).
 *
 * Precedence, most specific first: an explicit goal preference, then the
 * agent's, then `auto`. `auto` prefers the cheap local runner when it is
 * healthy and falls back to cloud, so losing the VM degrades cost rather than
 * availability.
 */
@Injectable()
export class RunnerRouter {
  private readonly logger = new Logger(RunnerRouter.name);

  constructor(
    @Inject(RUNNER_CLOUD) private readonly cloud: Runner,
    private readonly local: LocalVmRunner,
  ) {}

  async pick(request: RoutingRequest): Promise<Runner> {
    const preference =
      request.goalPreference && request.goalPreference !== "auto"
        ? request.goalPreference
        : request.agent.runnerPreference !== "inherit"
          ? request.agent.runnerPreference
          : (request.goalPreference ?? "auto");

    if (preference === "cloud") {
      return this.cloud;
    }

    if (preference === "local") {
      if (await this.local.healthy()) {
        return this.local;
      }
      // Pinned to local but local is down: say so loudly and use cloud rather
      // than failing the run.
      this.logger.warn("local runner was requested but is not healthy; using cloud");
      return this.cloud;
    }

    return (await this.local.healthy()) ? this.local : this.cloud;
  }
}
