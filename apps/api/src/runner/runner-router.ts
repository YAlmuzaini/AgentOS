import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AgentRow } from "../agents/agents.service";
import { LocalVmRunner } from "./local-runner";
import type { RunnerStatusDto } from "@agentos/shared";
import { SettingsService } from "../settings/settings.service";
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
    private readonly settings: SettingsService,
  ) {}

  /**
   * What each backend can take right now, for the settings screen.
   *
   * The switch is a preference, not a promise: choosing `local` while no worker
   * is reachable silently bills every run to the cloud. The screen has to be
   * able to say so.
   */
  async status(): Promise<RunnerStatusDto> {
    const configured = this.local.configured;
    return {
      cloud: { configured: true },
      local: {
        configured,
        healthy: configured ? await this.local.healthy() : false,
        url: this.local.endpointForDisplay(),
      },
    };
  }

  async pick(request: RoutingRequest): Promise<Runner> {
    return (await this.resolve(request)).runner;
  }

  /**
   * The backend *and* the preference that chose it.
   *
   * The caller needs both, because what to do when the local worker refuses a
   * session depends on why it was picked. Under `auto`, falling back to cloud
   * is the whole point. Under an explicit `local`, falling back is the opposite
   * of what the operator asked for — they moved off cloud deliberately, usually
   * because it costs money they no longer want to spend.
   */
  async resolve(
    request: RoutingRequest,
  ): Promise<{ runner: Runner; preference: "cloud" | "local" | "auto" }> {
    const preference = await this.preferenceFor(request);
    return { runner: await this.runnerFor(preference), preference };
  }

  private async runnerFor(preference: "cloud" | "local" | "auto"): Promise<Runner> {

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

  /**
   * Precedence, most specific first: an explicit goal preference, then the
   * agent's, then the project's own setting.
   *
   * That last step is what makes the settings screen mean anything. An agent
   * that inherits used to fall through to a hardcoded `auto`, so every seeded
   * agent ignored the operator's choice entirely.
   */
  private async preferenceFor(request: RoutingRequest): Promise<"cloud" | "local" | "auto"> {
    if (request.goalPreference && request.goalPreference !== "auto") {
      return request.goalPreference;
    }
    if (request.agent.runnerPreference !== "inherit") {
      return request.agent.runnerPreference as "cloud" | "local";
    }
    return (await this.settings.read(request.agent.projectId)).defaultRunner;
  }
}
