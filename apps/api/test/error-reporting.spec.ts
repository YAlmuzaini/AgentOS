import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GlitchTipReporter } from "../src/observability/glitchtip-reporter";

/**
 * What actually goes over the wire.
 *
 * `scrub.spec.ts` proves the redaction functions are correct. This proves they
 * are *wired in* — that Sentry's `beforeSend` really runs before the envelope
 * leaves the process. Those are different failures: a scrubber that works
 * perfectly and is never called leaks everything, and no unit test of the
 * scrubber would notice.
 *
 * So this stands up an HTTP server pretending to be GlitchTip and reads the
 * bytes it receives.
 */
describe("error reporting over the wire", () => {
  const received: string[] = [];
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" }).end('{"id":"test"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends a scrubbed envelope", async () => {
    process.env.AGENTOS_OPERATOR_TOKEN = "abcdef0123456789abcdef0123456789";
    const reporter = new GlitchTipReporter(`http://publickey@127.0.0.1:${port}/1`, "test", "v0");

    reporter.capture(
      new Error("provision failed: 401 invalid x-api-key sk-ant-api03-LEAKME-1234567890"),
      { scope: "session.destroy", tags: { sessionId: "sesn_1", runner: "cloud" } },
    );
    await reporter.flush(5_000);

    const sent = received.join("\n");
    // It has to actually reach the collector, or none of the rest matters.
    expect(received.length).toBeGreaterThan(0);

    // The credential must not be on the wire, in any form.
    expect(sent).not.toContain("sk-ant-api03-LEAKME-1234567890");
    expect(sent).toContain("sk-ant-<redacted>");
    expect(sent).not.toContain("abcdef0123456789abcdef0123456789");

    // And the report must still be worth reading afterwards.
    expect(sent).toContain("session.destroy");
    expect(sent).toContain("sesn_1");
  }, 20_000);
});
