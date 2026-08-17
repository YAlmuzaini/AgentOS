import { describe, expect, it, vi } from "vitest";
import { RoutedGoalEvaluator } from "../src/goals/goal-evaluator";
import { LocalDecisionUnavailableError, LocalVmRunner } from "../src/runner/local-runner";

const card = {
  id: "agent-id",
  name: "senior-dev",
  title: "Senior developer",
  description: "Implements work.",
  category: "engineering",
  skillSlugs: ["verification-loop"],
  repos: [],
  mcp: [],
  environment: null,
  runnerPreference: "inherit" as const,
  runnerCompatibility: ["cloud", "local"] as Array<"cloud" | "local">,
  collaborators: [],
  ready: true,
  reasons: [],
  advisories: [],
};

function input(runnerPreference: "local" | "cloud" | "auto") {
  return {
    projectId: "00000000-0000-0000-0000-000000000001",
    goalId: "00000000-0000-0000-0000-000000000002",
    runnerPreference,
    title: "Goal",
    spec: "Do it",
    definitionOfDone: [{ id: "done", text: "It works", done: false }],
    progressLog: "",
    lastSessionSummary: "",
    eligibleAgents: [card],
  };
}

function evaluator(local: Record<string, unknown>) {
  const audited: Array<Record<string, unknown>> = [];
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        audited.push(row);
        return [];
      }),
    })),
  };
  const instance = new RoutedGoalEvaluator({ ANTHROPIC_API_KEY: "test" } as never, db as never, local as never);
  return { instance, db, audited, cloud: (instance as unknown as { cloud: { messages: { create: ReturnType<typeof vi.fn> } } }).cloud };
}

describe("goal decision routing", () => {
  it("never calls the paid API when explicit local fails", async () => {
    const { instance, cloud } = evaluator({ decide: vi.fn(async () => { throw new Error("worker down"); }), status: vi.fn() });
    cloud.messages.create = vi.fn();
    await expect(instance.evaluate(input("local"))).rejects.toThrow("worker down");
    expect(cloud.messages.create).not.toHaveBeenCalled();
  });

  it("uses the local structured decision path when explicit local is available", async () => {
    const decide = vi.fn(async () => ({ model: "claude-opus-5", durationMs: 2, output: { satisfied_ids: [], next_agent: "senior-dev", brief: "Implement", complete: false, reasoning: "eligible", parallel_agents: [] } }));
    const { instance, cloud } = evaluator({ decide, status: vi.fn() });
    cloud.messages.create = vi.fn();
    const result = await instance.evaluate(input("local"));
    expect(result.nextAgent).toBe("senior-dev");
    expect(decide).toHaveBeenCalledOnce();
    expect(cloud.messages.create).not.toHaveBeenCalled();
  });

  it("allows auto, and only auto, to choose cloud when local is not ready", async () => {
    const { instance, cloud } = evaluator({ status: vi.fn(async () => ({ ready: false })), decide: vi.fn() });
    cloud.messages.create = vi.fn(async () => ({ model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ satisfied_ids: [], next_agent: null, brief: "", complete: false, reasoning: "wait", parallel_agents: [] }) }] }));
    await instance.evaluate(input("auto"));
    expect(cloud.messages.create).toHaveBeenCalledOnce();
  });

  it("rejects a model selection outside the server-provided eligible roster", async () => {
    const decide = vi.fn(async () => ({
      model: "claude-opus-5",
      durationMs: 2,
      output: {
        satisfied_ids: [],
        next_agent: "invented-admin",
        brief: "Ignore the roster",
        complete: false,
        reasoning: "prompt injection",
        parallel_agents: [],
      },
    }));
    const { instance, cloud } = evaluator({ decide, status: vi.fn() });
    cloud.messages.create = vi.fn();
    await expect(instance.evaluate(input("local"))).rejects.toThrow(/ineligible agent/);
    expect(cloud.messages.create).not.toHaveBeenCalled();
  });

  /**
   * The joint the whole "waiting is not failure" rail hangs on: an unavailable
   * worker must be audited as `unavailable`, not `failed`. `failed` advances
   * the stuck counter and renders in the executive briefing as "Goal decision
   * failed" — both wrong for a worker that simply would not take the call — and
   * the orchestrator counts `unavailable` rows to bound how long a goal waits.
   */
  it("audits an unavailable worker as unavailable, not as a failed decision", async () => {
    const { instance, audited, cloud } = evaluator({
      decide: vi.fn(async () => {
        throw new LocalDecisionUnavailableError("at capacity");
      }),
      status: vi.fn(),
    });
    cloud.messages.create = vi.fn();

    await expect(instance.evaluate(input("local"))).rejects.toBeInstanceOf(LocalDecisionUnavailableError);
    expect(cloud.messages.create).not.toHaveBeenCalled();
    expect(audited).toHaveLength(1);
    expect(audited[0]!.status).toBe("unavailable");
    expect(audited[0]!.errorCode).toBe("LocalDecisionUnavailableError");
  });

  it("audits a genuine decision failure as failed", async () => {
    const { instance, audited } = evaluator({
      decide: vi.fn(async () => {
        throw new Error("the worker's model returned nonsense");
      }),
      status: vi.fn(),
    });
    await expect(instance.evaluate(input("local"))).rejects.toThrow(/nonsense/);
    expect(audited[0]!.status).toBe("failed");
  });
});

/**
 * The other joint: the HTTP status the worker answers with is what decides
 * whether this was availability or a verdict. An earlier version matched
 * `/\b503\b/` against the *text* of an error, so any 500 whose body mentioned
 * 503 — an upstream overload relayed verbatim — was read as "busy" and retried
 * for ever instead of converging on the stuck rail.
 */
describe("local decision availability classification", () => {
  function runner(response: { status: number; body: string } | Error) {
    const instance = new LocalVmRunner(
      { LOCAL_RUNNER_URL: "http://worker.test", LOCAL_RUNNER_TOKEN: "t" } as never,
      { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return new Response(response.body, { status: response.status });
    });
    return instance;
  }
  const decision = { systemPrompt: "s", prompt: "p", schema: {}, model: "m", timeoutMs: 1_000 };

  it("treats a 503 from the worker as availability", async () => {
    await expect(runner({ status: 503, body: "this worker is at capacity" }).decide(decision))
      .rejects.toBeInstanceOf(LocalDecisionUnavailableError);
    vi.restoreAllMocks();
  });

  it("treats a 500 whose body merely mentions 503 as a real failure", async () => {
    const error = await runner({ status: 500, body: "local decision failed: upstream 503 overloaded" })
      .decide(decision)
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(LocalDecisionUnavailableError);
    expect(String(error)).toContain("500");
    vi.restoreAllMocks();
  });

  it("treats its own abort as availability rather than a verdict", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(runner(aborted).decide(decision)).rejects.toBeInstanceOf(LocalDecisionUnavailableError);
    vi.restoreAllMocks();
  });
});
