import { describe, expect, it } from "vitest";
import type { Flags } from "../src/client";
import { inboxChoice } from "../src/inbox-choice";

/**
 * SPEC §5.1 on a command line: a capability is stated, and the three ways to
 * fail to state one are missing, contradictory, and assumed.
 */
describe("inbox choice", () => {
  const flags = (...present: string[]): Flags =>
    Object.fromEntries(present.map((name) => [name, ""])) as Flags;

  it("takes either explicit choice", () => {
    expect(inboxChoice(flags("inbox"), true)).toBe(true);
    expect(inboxChoice(flags("no-inbox"), true)).toBe(false);
  });

  it("refuses to guess when neither flag is given and one is required", () => {
    expect(() => inboxChoice(flags(), true)).toThrow(/pass --inbox/);
  });

  it("leaves an update alone when neither flag is given", () => {
    expect(inboxChoice(flags(), false)).toBeUndefined();
  });

  /**
   * The one a script produces: flags assembled in a loop, both appended. It
   * used to grant the inbox, because only `--inbox` was ever read.
   */
  it("refuses contradictory flags rather than picking one", () => {
    expect(() => inboxChoice(flags("inbox", "no-inbox"), true)).toThrow(/contradict/);
    expect(() => inboxChoice(flags("inbox", "no-inbox"), false)).toThrow(/contradict/);
  });
});
