import { describe, expect, it } from "vitest";
import { GoalRuns } from "../src/goals/goal-runs";

describe("goal child cancellation", () => {
  it("fans cancellation out to every active child and not to another goal", () => {
    const runs = new GoalRuns();
    const parent = new AbortController();
    const first = runs.begin("goal-one", parent.signal);
    const second = runs.begin("goal-one", parent.signal);
    const unrelated = runs.begin("goal-two", parent.signal);

    runs.cancel("goal-one");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
    first.release();
    second.release();
    unrelated.release();
  });

  it("inherits an already-revoked lease before a child can start", () => {
    const runs = new GoalRuns();
    const parent = new AbortController();
    parent.abort();
    const child = runs.begin("goal", parent.signal);
    expect(child.signal.aborted).toBe(true);
    child.release();
  });
});
