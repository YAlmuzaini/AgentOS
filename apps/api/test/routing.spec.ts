import { describe, expect, it } from "vitest";
import type { AgentRow } from "../src/agents/agents.service";
import type { LocalVmRunner } from "../src/runner/local-runner";
import { RunnerRouter } from "../src/runner/runner-router";
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
  function router(localHealthy: boolean, projectDefault: DefaultRunner = "auto"): RunnerRouter {
    const local = {
      name: "local",
      configured: localHealthy,
      healthy: async () => localHealthy,
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

  it("falls back to cloud rather than failing when a pinned local runner is down", async () => {
    const picked = await router(false).pick({ agent: agent("local") });
    expect(picked.name).toBe("cloud");
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

  /** A project pinned to local still falls back rather than failing the run. */
  it("falls back to cloud when the project default is local but nothing is there", async () => {
    const picked = await router(false, "local").pick({ agent: agent("inherit") });
    expect(picked.name).toBe("cloud");
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
});
