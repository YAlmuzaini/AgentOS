import { afterEach, describe, expect, it } from "vitest";
import { assertValidJobId } from "../src/queue/session.queue";
import { RunCancellation } from "../src/runner/run-cancellation";
import { clearRegisteredSecrets, registerSecret } from "../src/observability/secret-registry";
import { scrubText } from "../src/observability/scrub";

/**
 * Round-seven findings, all inside round six's own fixes.
 *
 * These are unit-level on purpose: each is a boundary condition that the
 * integration tests structurally cannot reach — a 30-day timer, a credential
 * with a shape nobody listed, a BullMQ id that only collides after the first
 * job has already completed.
 */
describe("round seven", () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  /**
   * `setTimeout` clamps anything above 2^31-1 ms to 1 ms, so a 30-day goal
   * cancelled its very first session immediately instead of a month later.
   */
  it("does not fire a deadline that is further away than a 32-bit timer", () => {
    const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const cancellation = new RunCancellation(thirtyDays, null);
    try {
      expect(cancellation.cancelled).toBe(false);
      expect(cancellation.signal.aborted).toBe(false);
    } finally {
      cancellation.dispose();
    }
  });

  it("still cancels a deadline that has already passed", () => {
    const cancellation = new RunCancellation(new Date(Date.now() - 1_000), null);
    try {
      expect(cancellation.cancelled).toBe(true);
      expect(cancellation.reason).toBe("deadline");
    } finally {
      cancellation.dispose();
    }
  });

  it("is already cancelled when the caller's signal was aborted first", () => {
    const external = new AbortController();
    external.abort();
    const cancellation = new RunCancellation(null, external.signal);
    try {
      expect(cancellation.cancelled).toBe(true);
      expect(cancellation.reason).toBe("revoked");
    } finally {
      cancellation.dispose();
    }
  });

  /**
   * Shape-matching is not a boundary. An operator's granted secrets are
   * arbitrary — a bare GitHub token, a JWT, an MCP server's opaque bearer — and
   * none of them look like anything the patterns know about. They reach error
   * text by an ordinary route: a runner quotes the response that failed.
   */
  it("redacts a granted secret of a shape no pattern would recognise", () => {
    const githubToken = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const opaqueBearer = "zzzz-not-a-known-format-9988776655443322";
    registerSecret(githubToken);
    registerSecret(opaqueBearer);

    const text = scrubText(
      `clone failed for ${githubToken} and the MCP call sent ${opaqueBearer} upstream`,
    );
    expect(text).not.toContain(githubToken);
    expect(text).not.toContain(opaqueBearer);
    expect(text).toContain("<redacted-secret>");
  });

  it("ignores a secret too short to redact safely", () => {
    // Redacting every occurrence of a short value would destroy the report it
    // is meant to make safe.
    registerSecret("abc");
    expect(scrubText("abc is a perfectly ordinary word")).toContain("abc is a perfectly");
  });

  /**
   * The recovery key used to be the goal id alone. BullMQ treats an existing
   * job with that id as a duplicate *even after it has completed*, and
   * completed jobs are retained, so the second recovery of a goal created no
   * work at all while maintenance counted it as recovered.
   */
  it("accepts the recovery key shape as a BullMQ job id", () => {
    // The dedupe behaviour itself is asserted against the real sweep in
    // `round5-recovery.spec.ts`; this only pins the id format, since a key
    // BullMQ rejects would throw *after* the goal had already been logged as
    // recovered.
    const key = `goal-recovery-11111111-2222-3333-4444-555555555555-${Date.now()}`;
    expect(() => assertValidJobId(key)).not.toThrow();
  });

});
