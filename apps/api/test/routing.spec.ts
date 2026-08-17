import { describe, expect, it } from "vitest";
import type { AgentRow } from "../src/agents/agents.service";
import type { LocalVmRunner } from "../src/runner/local-runner";
import { LocalRunnerUnavailableError, RunnerRouter } from "../src/runner/runner-router";
import type { Runner } from "../src/runner/runner.types";
import type { SettingsService } from "../src/settings/settings.service";
import type { DefaultRunner } from "@agentos/shared";

/** Phase 7 done-when (SPEC §21) and the routing table in SPEC §16. */
describe("runner routing", () => {
  const cloud = { name: "cloud" } as Runner;

  /**
   * @param projectDefault what the operator chose on the settings screen. An
   *   agent that inherits follows this, which is the whole point of the switch.
   */
  function router(
    localHealthy: boolean,
    projectDefault: DefaultRunner = "auto",
    // Configured-but-unhealthy and not-configured-at-all are different
    // operator mistakes and get different sentences, so they are separable here.
    configured: boolean = localHealthy,
    draining: boolean = false,
  ): RunnerRouter {
    const local = {
      name: "local",
      configured,
      healthy: async () => localHealthy,
      status: async () => ({
        configured,
        healthy: localHealthy,
        ready: localHealthy && !draining,
        url: configured ? "http://localhost:4001" : null,
        activeSessions: 0,
        capacity: 2,
        draining,
        workerId: configured ? "test-worker" : null,
        version: configured ? "test" : null,
        location: configured ? ("local-computer" as const) : null,
        capabilities: configured ? ["sessions", "decisions"] : [],
      }),
      endpointForDisplay: () => (configured ? "http://localhost:4001" : null),
    } as unknown as LocalVmRunner;
    const settings = {
      read: async () => ({ defaultRunner: projectDefault }),
    } as unknown as SettingsService;
    return new RunnerRouter(cloud, local, settings);
  }

  function agent(preference: AgentRow["runnerPreference"]): AgentRow {
    return { runnerPreference: preference } as AgentRow;
  }

  it("sends a cloud-pinned agent to the cloud even when local is healthy", async () => {
    const picked = await router(true).pick({ agent: agent("cloud") });
    expect(picked.name).toBe("cloud");
  });

  it("sends a local-pinned agent to the local runner", async () => {
    const picked = await router(true).pick({ agent: agent("local") });
    expect(picked.name).toBe("local");
  });

  /**
   * The cost rail, and the reason it is a hard failure.
   *
   * The local worker runs under a flat-fee subscription; cloud is billed per
   * token. An unreachable worker is transient and unattended — a reboot, a
   * dropped tunnel — so falling back "just this once" turns a five-minute
   * outage into unbounded spend nobody is watching. `local` means local.
   */
  it("refuses rather than billing the cloud when a pinned local runner is down", async () => {
    await expect(router(false, "auto", true).pick({ agent: agent("local") })).rejects.toThrow(
      LocalRunnerUnavailableError,
    );
  });

  it("refuses when local is pinned and no worker is configured at all", async () => {
    await expect(router(false, "auto", false).pick({ agent: agent("local") })).rejects.toThrow(
      /no worker is configured/,
    );
  });

  /** The refusal has to say why, or the operator reads it as a generic crash. */
  it("explains that the run was not sent to the cloud, and how to allow it", async () => {
    await expect(router(false, "auto", true).pick({ agent: agent("local") })).rejects.toThrow(
      /not sent to the cloud/,
    );
    await expect(router(false, "auto", true).pick({ agent: agent("local") })).rejects.toThrow(
      /`auto`/,
    );
  });

  it("prefers the cheap runner on auto when it is healthy", async () => {
    const picked = await router(true).pick({ agent: agent("inherit") });
    expect(picked.name).toBe("local");
  });

  it("uses cloud on auto when there is no local runner", async () => {
    const picked = await router(false).pick({ agent: agent("inherit") });
    expect(picked.name).toBe("cloud");
  });

  /**
   * The switch on the settings screen. Every seeded agent inherits, and this
   * used to fall through to a hardcoded "auto" — so an operator who chose
   * `cloud` or `local` was ignored, and every run billed wherever `auto` landed.
   */
  it("follows the project's default runner for an agent that inherits", async () => {
    const pinnedCloud = await router(true, "cloud").pick({ agent: agent("inherit") });
    expect(pinnedCloud.name).toBe("cloud");

    const pinnedLocal = await router(true, "local").pick({ agent: agent("inherit") });
    expect(pinnedLocal.name).toBe("local");
  });

  /** An inherited `local` is still an explicit `local`, and refuses the same way. */
  it("refuses when the project default is local but nothing is there", async () => {
    await expect(
      router(false, "local", true).pick({ agent: agent("inherit") }),
    ).rejects.toThrow(LocalRunnerUnavailableError);
  });

  /** An agent's own choice still beats the project default. */
  it("lets an agent override the project default", async () => {
    const picked = await router(true, "local").pick({ agent: agent("cloud") });
    expect(picked.name).toBe("cloud");
  });

  it("lets a goal's preference override the agent's", async () => {
    const localPinnedAgent = agent("local");
    const picked = await router(true).pick({
      agent: localPinnedAgent,
      goalPreference: "cloud",
    });
    expect(picked.name).toBe("cloud");
  });

  /**
   * The whole table, stated once, so a future change to `runnerFor` cannot
   * quietly re-open the fallback for one combination while the individual
   * cases above still pass.
   *
   * `local` is the only row that refuses, and it refuses in every position the
   * preference can be set from: the goal, the agent, and the project default.
   */
  it("never selects cloud for an explicit local, from any preference source", async () => {
    const sources: Array<{ label: string; call: (r: RunnerRouter) => Promise<Runner> }> = [
      { label: "goal", call: (r) => r.pick({ agent: agent("inherit"), goalPreference: "local" }) },
      { label: "agent", call: (r) => r.pick({ agent: agent("local") }) },
      { label: "project default", call: (r) => r.pick({ agent: agent("inherit") }) },
    ];

    for (const source of sources) {
      // Healthy: it runs locally.
      const healthy = await source.call(router(true, "local", true));
      expect(healthy.name, `${source.label} / healthy`).toBe("local");

      // Down: it refuses. It must never answer "cloud".
      await expect(source.call(router(false, "local", true)), source.label).rejects.toThrow(
        LocalRunnerUnavailableError,
      );
    }
  });

  /** `auto` is the only effective preference allowed to spend money on a fallback. */
  /**
   * Drain means "this worker takes no new work". Routing to it anyway produced
   * a `503 this worker is draining` that surfaced as a session failure rather
   * than as the state the operator deliberately set. It still does not fall
   * back to cloud — explicit local never does — it fails with the real reason.
   */
  it("refuses a drained worker under explicit local, and says so", async () => {
    await expect(router(true, "local", true, true).pick({ agent: agent("inherit") })).rejects.toThrow(/draining/);
    await expect(router(true, "local", true, true).pick({ agent: agent("inherit") })).rejects.toThrow(/not sent to the cloud/);
  });

  /**
   * At capacity is *not* drain. The worker queues admissions FIFO, so refusing
   * here would defeat the queue — which is why routing tests `!draining`
   * rather than `ready`.
   */
  it("still routes to a busy-but-not-draining worker under explicit local", async () => {
    const local = {
      name: "local",
      configured: true,
      healthy: async () => true,
      status: async () => ({
        configured: true,
        healthy: true,
        // At capacity: ready is false, draining is false.
        ready: false,
        draining: false,
        url: "http://localhost:4001",
        activeSessions: 2,
        capacity: 2,
        workerId: "busy",
        version: "test",
        location: "local-computer" as const,
        capabilities: ["sessions"],
      }),
      endpointForDisplay: () => "http://localhost:4001",
    } as unknown as LocalVmRunner;
    const settings = { read: async () => ({ defaultRunner: "local" as DefaultRunner }) } as unknown as SettingsService;
    const picked = await new RunnerRouter(cloud, local, settings).pick({ agent: agent("inherit") });
    expect(picked.name).toBe("local");
  });

  it("degrades to cloud only when the effective preference is auto", async () => {
    const effectivelyAuto = await router(false, "auto", true).pick({ agent: agent("inherit") });
    expect(effectivelyAuto.name).toBe("cloud");
  });

  /**
   * A goal set to `auto` does not *widen* an agent pinned to local.
   *
   * `auto` on a goal means "no opinion", not "cloud is allowed" — `preferenceFor`
   * skips it and falls through to the agent. So the agent's `local` still holds
   * and still refuses, which is the conservative reading and the one that keeps
   * the cost rail intact.
   */
  it("does not let an auto goal widen an agent pinned to local", async () => {
    await expect(
      router(false, "cloud", true).pick({ agent: agent("local"), goalPreference: "auto" }),
    ).rejects.toThrow(LocalRunnerUnavailableError);
  });
});
