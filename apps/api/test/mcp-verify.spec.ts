import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { McpVerifier } from "../src/resources/mcp-verifier";

/**
 * The MCP handshake, against fake servers this test owns.
 *
 * Nothing here touches the network: an ordinary unit run must not depend on
 * GitHub or Apify being up, and must never spend anything. Live verification
 * against a real endpoint is the operator pressing the button in the UI.
 *
 * The verifier refuses plain http and private addresses, which is exactly what
 * a loopback test server is — so the SSRF guard is exercised directly, and the
 * protocol behaviour is exercised through the private `rpc` path by pointing a
 * relaxed instance at the fake. Splitting it this way keeps the guard honest
 * rather than adding a test-only bypass to the real class.
 */
describe("MCP verification", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  /**
   * A verifier whose *policy* guard is relaxed so a loopback fake can answer.
   *
   * This does not disable the address check that matters: the connect-time
   * lookup guard is inside the transport and still applies to every name it
   * resolves. What is bypassed here is only "https, and not a literal private
   * address", so the protocol behaviour can be exercised over loopback http.
   * The guard itself is tested on the real class below.
   */
  class LoopbackVerifier extends McpVerifier {
    protected async refuseUnsafeUrl(): Promise<string | null> {
      return null;
    }
  }

  function serve(handler: (body: string) => { status?: number; type?: string; body: string }) {
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      request.on("end", () => {
        const answer = handler(raw);
        response.writeHead(answer.status ?? 200, {
          "content-type": answer.type ?? "application/json",
          "mcp-session-id": "sess-1",
        });
        response.end(answer.body);
      });
    });
    servers.push(server);
    return new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),
      );
    });
  }

  /** Answers initialize and tools/list the way a compliant server would. */
  function compliant(tools: string[]) {
    return (raw: string) => {
      const call = JSON.parse(raw) as { id: number; method: string };
      if (call.method === "initialize") {
        return {
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              serverInfo: { name: "fake", version: "9.9" },
            },
          }),
        };
      }
      return {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          result: { tools: tools.map((name) => ({ name, description: "x" })) },
        }),
      };
    };
  }

  it("reports the server identity and its tool names, and calls no tool", async () => {
    const called: string[] = [];
    const url = await serve((raw) => {
      const call = JSON.parse(raw) as { id: number; method: string };
      called.push(call.method);
      return compliant(["search", "fetch"])(raw);
    });

    const result = await new LoopbackVerifier().verify(url, null);

    expect(result.ok).toBe(true);
    expect(result.tools).toEqual(["search", "fetch"]);
    expect(result.server).toBe("fake @ 9.9");
    // The whole safety property of this feature, asserted directly.
    expect(called).toEqual(["initialize", "tools/list"]);
    expect(called).not.toContain("tools/call");
  });

  it("reads a streamable-HTTP reply framed as server-sent events", async () => {
    const url = await serve((raw) => {
      const answer = compliant(["only_tool"])(raw);
      return { type: "text/event-stream", body: `event: message\ndata: ${answer.body}\n\n` };
    });

    const result = await new LoopbackVerifier().verify(url, null);

    expect(result.ok).toBe(true);
    expect(result.tools).toEqual(["only_tool"]);
  });

  it("sends the credential as a bearer token and nothing else", async () => {
    let seen: string | undefined;
    const server = createServer((request, response) => {
      seen = request.headers.authorization;
      let raw = "";
      request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(compliant([])(raw).body);
      });
    });
    servers.push(server);
    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),
      );
    });

    await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(seen).toBe("Bearer s3cret-token");
  });

  it("reports a rejected credential as such, without echoing it", async () => {
    const url = await serve(() => ({ status: 401, body: '{"error":"bad token s3cret-token"}' }));

    const result = await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rejected the credential/);
    expect(result.error).not.toContain("s3cret-token");
  });

  /** An HTML login page is the most common "wrong URL" and must read as one. */
  it("says the URL is not an MCP endpoint when the answer is not JSON", async () => {
    const url = await serve(() => ({ type: "text/html", body: "<html>Sign in</html>" }));

    const result = await new LoopbackVerifier().verify(url, null);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not the MCP endpoint/);
  });

  /**
   * Following a redirect would deliver this connection's bearer token to
   * whatever the server nominated — the classic way an approved URL becomes a
   * request to somewhere else entirely.
   */
  it("refuses to follow a redirect rather than carrying the credential to it", async () => {
    const url = await serve(() => ({
      status: 302,
      body: "",
      type: "text/plain",
    }));

    const result = await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirected/);
    expect(result.error).not.toContain("s3cret-token");
  });

  it("passes a JSON-RPC error from the server through, capped", async () => {
    const url = await serve((raw) => {
      const call = JSON.parse(raw) as { id: number };
      return {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          error: { code: -32600, message: "unsupported protocol version" },
        }),
      };
    });

    const result = await new LoopbackVerifier().verify(url, null);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unsupported protocol version");
  });

  /* ── The URL guard, on the real class ────────────────────────────────── */

  it("refuses http, embedded credentials, and private addresses", async () => {
    const verifier = new McpVerifier();

    expect((await verifier.verify("http://example.com/mcp", null)).error).toMatch(/only https/);
    expect((await verifier.verify("https://u:p@example.com/mcp", null)).error).toMatch(
      /credential in it/,
    );
    expect((await verifier.verify("https://127.0.0.1/mcp", null)).error).toMatch(/private/);
    expect((await verifier.verify("https://169.254.169.254/latest", null)).error).toMatch(
      /private/,
    );
    expect((await verifier.verify("https://[::1]/mcp", null)).error).toMatch(/private/);
    expect((await verifier.verify("not-a-url", null)).error).toMatch(/not a URL this can parse/);
  });

  /**
   * The rebinding case, which the previous design could not stop: the name is
   * resolved for the check and resolved again for the request, and it can
   * answer differently the second time. `localtest.me` and its relatives
   * resolve to loopback, so a name that passed a syntax check still lands on
   * 127.0.0.1 — and the connect-time guard is what refuses it.
   */
  it("refuses a hostname that resolves to loopback, not just a literal one", async () => {
    // The policy guard is bypassed deliberately, so the only thing that can
    // refuse this is the lookup inside the transport.
    const result = await new LoopbackVerifier().verify("http://localtest.me:1/mcp", "s3cret-token");

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("s3cret-token");
  });

  it("refuses the whole link-local range and hex IPv4-mapped addresses", async () => {
    const verifier = new McpVerifier();

    // fe80::/10, not the literal `fe80:` prefix.
    expect((await verifier.verify("https://[fe90::1]/mcp", null)).error).toMatch(/private/);
    // fc00::/7 unique-local.
    expect((await verifier.verify("https://[fd00::1]/mcp", null)).error).toMatch(/private/);
    // ::ffff:7f00:1 is 127.0.0.1 written in hex.
    expect((await verifier.verify("https://[::ffff:7f00:1]/mcp", null)).error).toMatch(/private/);
    expect((await verifier.verify("https://[::ffff:127.0.0.1]/mcp", null)).error).toMatch(/private/);
    // …and a public one is still allowed past the guard.
    expect((await verifier.verify("https://[2606:4700::1111]/mcp", null)).error).not.toMatch(
      /private/,
    );
  });

  /**
   * A server that hands the credential back — a diagnostic endpoint echoing the
   * request, or a hostile one doing it on purpose. Storing that would put a
   * live token in the database and on the screen.
   */
  it("never stores a credential the server echoed back at it", async () => {
    const url = await serve((raw) => {
      const call = JSON.parse(raw) as { id: number };
      return {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          error: { code: -32000, message: "you sent Authorization: Bearer s3cret-token" },
        }),
      };
    });

    const result = await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("s3cret-token");
    expect(result.error).toContain("<redacted>");
  });

  /**
   * Codex round two, blocker: the success path carries server-controlled text
   * too. A tool *name* is written by the server, and that server was handed the
   * credential — so `verified_tools` could hold a live token, which the API and
   * the UI both display.
   */
  it("never stores a credential a server hid in a tool name", async () => {
    const url = await serve((raw) => {
      const call = JSON.parse(raw) as { id: number; method: string };
      if (call.method === "initialize") {
        return {
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            result: { serverInfo: { name: "leaky s3cret-token", version: "1" } },
          }),
        };
      }
      return {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          result: { tools: [{ name: "search" }, { name: "echo s3cret-token" }] },
        }),
      };
    });

    const result = await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(result.ok).toBe(true);
    expect(result.tools.join(" ")).not.toContain("s3cret-token");
    expect(result.tools.join(" ")).toContain("<redacted>");
    expect(result.server ?? "").not.toContain("s3cret-token");
  });

  /** A short credential is still a credential; nothing enforces a minimum length. */
  it("redacts a token too short for the old length floor", async () => {
    const url = await serve(() => ({ status: 500, body: '{"error":"nope"}' }));
    const result = await new LoopbackVerifier().verify(url, "abc");
    expect(result.error).not.toContain("abc");

    const echoed = await serve((raw) => {
      const call = JSON.parse(raw) as { id: number };
      return {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          error: { code: -1, message: "invalid key abc" },
        }),
      };
    });
    const second = await new LoopbackVerifier().verify(echoed, "abc");
    expect(second.error).not.toMatch(/\babc\b/);
    expect(second.error).toContain("<redacted>");
  });

  /**
   * A 200 whose socket resets mid-body used to leave the promise unresolved,
   * or surface as an unhandled error that took the API process with it.
   */
  it("settles rather than hanging when the server resets mid-response", async () => {
    const server = createServer((request, response) => {
      request.on("data", () => {});
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json", "content-length": "200" });
        response.write('{"jsonrpc":"2.0","id":1,"result":{');
        // Kill the connection before the body is complete.
        response.socket?.destroy();
      });
    });
    servers.push(server);
    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),
      );
    });

    const result = await new LoopbackVerifier().verify(url, "s3cret-token");

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("s3cret-token");
  });

  it("never reports ok for a refused URL", async () => {
    const verifier = new McpVerifier();
    const result = await verifier.verify("https://10.0.0.5/mcp", "s3cret-token");
    expect(result.ok).toBe(false);
    expect(result.tools).toEqual([]);
    expect(result.error).not.toContain("s3cret-token");
  });
});

/**
 * Codex round six: `timeout` on an http request is an inactivity timeout. A
 * server that dribbles a byte just often enough never trips it, and the call
 * stays open — holding a socket and an HTTP handler — until the body cap is
 * reached, which at that rate is not a duration anyone would wait for.
 */
describe("MCP verification deadline", () => {
  const open: Server[] = [];

  afterEach(async () => {
    for (const server of open.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("settles on a total deadline, not only on inactivity", async () => {
    const server = createServer((request, response) => {
      request.on("data", () => {});
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        // Never completes, but never goes quiet either.
        const tick = setInterval(() => response.write(" "), 200);
        response.on("close", () => clearInterval(tick));
      });
    });
    open.push(server);
    const url = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),
      );
    });

    class Fast extends McpVerifier {
      protected async refuseUnsafeUrl(): Promise<string | null> {
        return null;
      }
    }

    const started = Date.now();
    const result = await Fast.prototype.verify.call(new Fast(), url, null);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    // The documented ceiling is 10s; the point is that it settles at all
    // rather than waiting for a 2MB body at one byte per 200ms.
    expect(elapsed).toBeLessThan(30_000);
  }, 40_000);
});
