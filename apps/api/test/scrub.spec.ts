import { afterEach, describe, expect, it } from "vitest";
import { scrubEvent, scrubText } from "../src/observability/scrub";

/**
 * The last gate before anything leaves this machine.
 *
 * Error reports from this app are unusually dangerous to ship raw: a session's
 * tool-call log carries task text and agent messages, and a provisioning
 * failure quotes the one request that carried resolved secrets. If this file is
 * wrong, the feature meant to help you debug is the feature that leaks your
 * credentials to a server.
 */
describe("error report scrubbing", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("redacts Anthropic keys and setup tokens wherever they appear", () => {
    const text = scrubText(
      "Error: 401 invalid x-api-key sk-ant-api03-AbCdEf123456_xyz-789 while provisioning",
    );
    expect(text).not.toContain("sk-ant-api03-AbCdEf123456_xyz-789");
    expect(text).toContain("sk-ant-<redacted>");
    expect(scrubText("token sk-ant-oat01-Zzz999")).not.toContain("oat01-Zzz999");
  });

  it("redacts credentials embedded in a URL", () => {
    // Git remotes and database URLs both carry credentials this way.
    const text = scrubText("fatal: could not read https://x-access-token:ghp_secret@github.com/a/b");
    expect(text).not.toContain("ghp_secret");
    expect(text).toContain("//<redacted>@");
  });

  it("redacts a database URL even when it has no password", () => {
    expect(scrubText("connect postgres://agentos@db:5432/agentos failed")).not.toContain("db:5432");
  });

  it("redacts the value of any known secret env var by exact match", () => {
    process.env.AGENTOS_OPERATOR_TOKEN = "abcdef0123456789abcdef0123456789";
    const text = scrubText("request had authorization abcdef0123456789abcdef0123456789 attached");
    expect(text).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("ignores a short env value rather than redacting half the report", () => {
    // A 4-character secret would match everywhere and destroy the report.
    process.env.RELEASE = "v1";
    expect(scrubText("v1 of the runner failed")).toContain("v1 of the runner failed");
  });

  it("drops narrative fields instead of trying to pattern-match prose", () => {
    const event = scrubEvent({
      extra: {
        taskId: "abc",
        description: "Refund the invoice for Acme Corp, contact jane@acme.example",
        summary: "the agent said something about a customer",
      },
    });
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain("Acme Corp");
    expect(serialised).not.toContain("jane@acme.example");
    // Non-narrative metadata survives, or the report is useless.
    expect(serialised).toContain("abc");
  });

  it("scrubs nested structures and arrays", () => {
    const event = scrubEvent({
      exception: { values: [{ value: "failed with sk-ant-api03-LEAKME" }] },
    });
    expect(JSON.stringify(event)).not.toContain("LEAKME");
  });

  it("does not hang on a deeply nested event", () => {
    let nested: Record<string, unknown> = { value: "sk-ant-api03-DEEP" };
    for (let index = 0; index < 40; index += 1) {
      nested = { nested };
    }
    // Bounded depth: the point is that it returns at all.
    expect(() => scrubEvent(nested)).not.toThrow();
    expect(JSON.stringify(scrubEvent(nested))).toContain("truncated");
  });

  it("leaves an ordinary message intact", () => {
    const message = "session sesn_123 could not be destroyed: 500 upstream error";
    expect(scrubText(message)).toBe(message);
  });
});
