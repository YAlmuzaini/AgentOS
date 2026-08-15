import { describe, expect, it } from "vitest";
import type { AgentRow } from "../src/agents/agents.service";
import type { LocalVmRunner } from "../src/runner/local-runner";
import { RunnerRouter } from "../src/runner/runner-router";
import type { Runner } from "../src/runner/runner.types";

/** Phase 7 done-when (SPEC §21) and the routing table in SPEC §16. */
describe("runner routing", () => {
  const cloud = { name: "cloud" } as Runner;

  function router(localHealthy: boolean): RunnerRouter {
    const local = {
      name: "local",
      configured: localHealthy,
      healthy: async () => localHealthy,
    } as unknown as LocalVmRunner;
    return new RunnerRouter(cloud, local);
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

  it("lets a goal's preference override the agent's", async () => {
    const localPinnedAgent = agent("local");
    const picked = await router(true).pick({
      agent: localPinnedAgent,
      goalPreference: "cloud",
    });
    expect(picked.name).toBe("cloud");
  });
});
