import { Injectable, Logger } from "@nestjs/common";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/**
 * Asks an MCP server whether it is really there.
 *
 * This is the only thing in AgentOS that turns "cataloged" into "verified". It
 * performs the MCP initialize handshake and one `tools/list`, and that is the
 * whole of what it is allowed to do — **it never calls a tool**, because a tool
 * on a catalogued server can charge money (Apify), mutate a real system
 * (Stripe), or take an action in public (GitHub). A connectivity check that
 * might issue a refund is not a connectivity check.
 *
 * It is opt-in and operator-triggered. Nothing here runs on a schedule, on
 * install, or as part of provisioning a session: a verify is a request to reach
 * out from the control plane to a third party carrying the operator's
 * credential, and that is a decision rather than a background convenience.
 */
export interface VerifyResult {
  ok: boolean;
  /** Names only. Never schemas, never arguments, never results. */
  tools: string[];
  /** `name @ version`, when the server volunteers it. */
  server: string | null;
  /** Credential-free by construction: see `describe`. */
  error: string | null;
}

/** One handshake gets this long in total, including DNS and redirects. */
const TIMEOUT_MS = 10_000;
/** A tools/list on a large server is still small; anything huge is a wrong URL. */
const MAX_BODY_BYTES = 2_000_000;

@Injectable()
export class McpVerifier {
  private readonly logger = new Logger(McpVerifier.name);

  async verify(url: string, token: string | null): Promise<VerifyResult> {
    const guard = await this.refuseUnsafeUrl(url);
    if (guard) {
      return { ok: false, tools: [], server: null, error: guard };
    }

    try {
      const initialize = await this.rpc(url, token, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          // Truthful, and deliberately capability-free: we are not going to
          // sample, subscribe, or accept anything back.
          capabilities: {},
          clientInfo: { name: "agentos-verifier", version: "1" },
        },
      });
      if (initialize.error) {
        return { ok: false, tools: [], server: null, error: describe(initialize.error, token) };
      }

      // Server-controlled text, so it is sanitised at the point it is built
      // rather than at each of the three places it is returned — the
      // `tools/list` failure path returned it raw and uncapped.
      const info = initialize.result?.serverInfo as { name?: string; version?: string } | undefined;
      const server = info?.name
        ? scrub(`${info.name}${info.version ? ` @ ${info.version}` : ""}`, token).slice(0, 200)
        : null;

      const listed = await this.rpc(
        url,
        token,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        // The session header a streamable-HTTP server hands back on initialize;
        // servers that use one reject the second call without it.
        initialize.sessionId,
      );
      if (listed.error) {
        return { ok: false, tools: [], server, error: describe(listed.error, token) };
      }

      // Tool names are server-controlled text, and this server was handed the
      // credential — so the success path can carry it back just as easily as
      // the error path. Scrubbed and bounded for exactly that reason: a name
      // is an identifier, and anything long enough to hide a token in is not
      // one we need to store.
      const tools = Array.isArray(listed.result?.tools)
        ? (listed.result!.tools as Array<{ name?: unknown }>)
            .map((tool) => (typeof tool.name === "string" ? tool.name : null))
            .filter((name): name is string => Boolean(name))
            // Scrub first, then cap. The other order cuts a long credential in
            // half and stores the first 120 characters of it — redaction that
            // runs after truncation is redaction looking for a string that is
            // no longer there.
            .map((name) => scrub(name, token).slice(0, 120))
        : [];

      return { ok: true, tools, server, error: null };
    } catch (error) {
      return { ok: false, tools: [], server: null, error: describe(error, token) };
    }
  }

  /**
   * One JSON-RPC call over streamable HTTP.
   *
   * `node:https` rather than `fetch`, for one reason: it accepts a `lookup`,
   * and that is the only place a DNS answer can be checked *at the moment it
   * is used*. Validating the hostname first and then letting the HTTP client
   * resolve it again is a rebinding hole — a name answers with a public
   * address for the check and `169.254.169.254` for the request, and the
   * bearer token goes to the metadata service. Here every address the resolver
   * returns is refused at connect time, on every attempt, including redirects
   * we do not follow anyway.
   */
  private rpc(
    url: string,
    token: string | null,
    body: Record<string, unknown>,
    sessionId?: string | null,
  ): Promise<{
    result?: Record<string, unknown>;
    error?: unknown;
    sessionId: string | null;
  }> {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    // The transport speaks whichever protocol the URL names; the *policy* that
    // only https may be verified lives in `refuseUnsafeUrl`, which runs first.
    // Keeping them apart means a test can exercise the protocol handling over
    // loopback http without a subclass that disables the security guard.
    const send = target.protocol === "http:" ? httpRequest : httpsRequest;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: {
        result?: Record<string, unknown>;
        error?: unknown;
        sessionId: string | null;
      }) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      const request = send(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === "http:" ? 80 : 443),
          path: `${target.pathname}${target.search}`,
          method: "POST",
          // The whole call, DNS included — the previous timer started after
          // resolution, so a stalled resolver outlived the advertised limit.
          timeout: TIMEOUT_MS,
          lookup: guardedLookup,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "content-length": Buffer.byteLength(payload),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(sessionId ? { "mcp-session-id": sessionId } : {}),
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const header = response.headers["mcp-session-id"];
          const nextSessionId =
            (Array.isArray(header) ? header[0] : header) ?? sessionId ?? null;

          // A 302 is how an approved URL becomes a request somewhere else, and
          // the redirect target would receive this connection's credential. It
          // is reported rather than chased.
          if (status >= 300 && status < 400) {
            response.resume();
            finish({
              error: new Error(
                `the server redirected (${status}); AgentOS does not follow redirects for MCP, ` +
                  "because the destination would receive this connection's credential. Use the " +
                  "final URL.",
              ),
              sessionId: nextSessionId,
            });
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            finish({
              error: new Error(
                status === 401 || status === 403
                  ? `the server rejected the credential (${status})`
                  : `the server answered ${status}`,
              ),
              sessionId: nextSessionId,
            });
            return;
          }

          const type = String(response.headers["content-type"] ?? "");
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > MAX_BODY_BYTES) {
              response.destroy();
              finish({
                error: new Error(
                  "the server sent more than this can read; that is not an MCP endpoint",
                ),
                sessionId: nextSessionId,
              });
              return;
            }
            chunks.push(chunk);
          });
          // A server can answer 200, send half a body, and reset the socket.
          // Node emits that on the response stream, and with no listener it
          // becomes an unhandled error that takes the API process down.
          response.on("error", (error) => finish({ error, sessionId: nextSessionId }));
          response.on("aborted", () =>
            finish({
              error: new Error("the server closed the connection before finishing its response"),
              sessionId: nextSessionId,
            }),
          );
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const json = type.includes("text/event-stream") ? lastDataFrame(text) : text;
            if (!json) {
              finish({
                error: new Error("the server sent no JSON-RPC response"),
                sessionId: nextSessionId,
              });
              return;
            }
            try {
              const parsed = JSON.parse(json) as {
                result?: Record<string, unknown>;
                error?: unknown;
              };
              finish({ ...parsed, sessionId: nextSessionId });
            } catch {
              finish({
                error: new Error(
                  `the server did not answer with JSON (content-type ${type || "unset"}) — this ` +
                    "is usually an HTML login page, which means the URL is not the MCP endpoint",
                ),
                sessionId: nextSessionId,
              });
            }
          });
        },
      );

      // Two clocks, because `timeout` is an *inactivity* timeout: a server
      // that dribbles one byte every nine seconds never trips it, and the call
      // stays open until the body cap is reached — which at that rate is
      // months, with the request, the socket and the HTTP handler all held.
      // The deadline below is the one the documentation actually promises.
      request.on("timeout", () => {
        request.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000}s`));
      });
      const deadline = setTimeout(() => {
        request.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000}s`));
        finish({
          error: new Error(`no answer within ${TIMEOUT_MS / 1000}s`),
          sessionId: sessionId ?? null,
        });
      }, TIMEOUT_MS);
      // Never keeps the process alive on its own account.
      deadline.unref?.();
      request.on("close", () => clearTimeout(deadline));
      request.on("error", (error) => finish({ error, sessionId: sessionId ?? null }));
      request.end(payload);
    });
  }

  /**
   * Refuses a URL the control plane should not be made to fetch.
   *
   * The operator supplies this URL, so this is not an untrusted-input boundary
   * in the usual sense — but the control plane holds every project's secrets and
   * sits wherever it is deployed, so "fetch this and send the token" is worth a
   * guard even against a typo. https only, no credentials in the URL, and no
   * loopback, link-local or private address.
   */
  protected async refuseUnsafeUrl(raw: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return "that is not a URL this can parse";
    }
    if (url.protocol !== "https:") {
      return "only https MCP endpoints can be verified — an http endpoint would send the credential in the clear";
    }
    if (url.username || url.password) {
      return "the URL carries a credential in it; put the credential in a secret reference instead";
    }
    // A literal address can be judged here and now. A *name* deliberately is
    // not: resolving it here and trusting that answer later is the rebinding
    // hole this class had. The binding check lives in `guardedLookup`, which
    // runs at connect time on every address the resolver actually returns.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host)) {
      return `${url.hostname} is a private or loopback address, which the control plane will not fetch`;
    }
    return null;
  }
}

/**
 * The DNS answer, checked at the moment it is used.
 *
 * `node:https` calls this instead of `dns.lookup`, so every address a name
 * resolves to is judged on the attempt it will be connected on. That closes
 * rebinding: there is no window between "we checked" and "it connected" for
 * the answer to change, because they are the same event.
 */
function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const refused = addresses.find((entry) => isPrivateAddress(entry.address));
    if (refused) {
      callback(
        Object.assign(
          new Error(
            `the server resolves to ${refused.address}, a private or loopback address, which ` +
              "the control plane will not fetch",
          ),
          { code: "EACCES" },
        ) as NodeJS.ErrnoException,
        "",
        0,
      );
      return;
    }
    const all = Boolean((options as { all?: boolean } | undefined)?.all);
    if (all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
}

/**
 * Turns anything thrown into a sentence that cannot contain a credential.
 *
 * Only messages this file constructs are passed through; everything else is
 * reduced to its error name plus a fixed hint. `fetch` failures quote the URL,
 * and a URL can carry a token in a query parameter — Exa and Firecrawl both
 * document that shape — so a raw message is not safe to store or display.
 */
function describe(error: unknown, token: string | null): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return `no answer within ${TIMEOUT_MS / 1000}s`;
    }
    if (error.message.startsWith("the server") || error.message.startsWith("that is not")) {
      return scrub(error.message, token);
    }
    return `${error.name}: the request did not complete (network, DNS, or TLS)`;
  }
  if (error && typeof error === "object" && "message" in error) {
    // A JSON-RPC error object, written by the server — and that server was
    // handed the `Authorization` header, so it can hand it straight back.
    // A diagnostic endpoint that echoes the request, or a hostile one that
    // does it on purpose, would otherwise put a live credential in
    // `verify_error`, from where the API and the UI would both display it.
    // Same order as the tool names, for the same reason.
    return scrub(String((error as { message: unknown }).message), token).slice(0, 300);
  }
  return "the request failed";
}

/**
 * Removes the credential from anything about to be stored or displayed.
 *
 * Two passes, because there are two ways it gets in: verbatim, from a server
 * that echoed the header back, and shaped, from any `Bearer <something>` a
 * message happens to contain. Neither is expected; both are cheap to prevent
 * and expensive to discover later in a screenshot.
 */
function scrub(text: string, token: string | null): string {
  let safe = text;
  // Any non-empty credential, at any length. The previous four-character floor
  // was there to stop a trivial string blanking half a message, which is a
  // cosmetic worry standing in front of a real one: a short token is still a
  // token, and nothing validates that an operator's secret is long.
  if (token) {
    safe = safe.split(token).join("<redacted>");
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer <redacted>");
}

/** Streamable HTTP frames the reply as SSE; the JSON is the last `data:` line. */
function lastDataFrame(text: string): string | null {
  const frames = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return frames.at(-1) ?? null;
}

/** Reads the body, refusing to buffer an unbounded one. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("the server sent more than this can read; that is not an MCP endpoint");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * Loopback, link-local, unique-local and the RFC1918 ranges, for v4 and v6.
 *
 * The previous version had two holes, both of which reach loopback:
 * `fe80:` was matched as a literal prefix although link-local is `fe80::/10`
 * (so `fe90::1` passed), and an IPv4-mapped address written in hex —
 * `::ffff:7f00:1` — was handed back to this function as `7f00:1`, which looks
 * like IPv6 and answered false. Both are parsed properly now.
 */
function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().split("%")[0]!;

  if (!value.includes(":")) {
    return isPrivateV4(value);
  }

  if (value === "::1" || value === "::") {
    return true;
  }

  // An IPv4-mapped address, in either notation: `::ffff:127.0.0.1` and
  // `::ffff:7f00:1` are the same address and must reach the same answer.
  const mapped = /^::ffff:(.+)$/.exec(value);
  if (mapped) {
    const rest = mapped[1]!;
    if (rest.includes(".")) {
      return isPrivateV4(rest);
    }
    const groups = rest.split(":");
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0]!, 16);
      const low = Number.parseInt(groups[1]!, 16);
      if (!Number.isNaN(high) && !Number.isNaN(low)) {
        return isPrivateV4(
          [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join("."),
        );
      }
    }
    return true;
  }

  const firstGroup = Number.parseInt(value.split(":")[0] || "0", 16);
  if (Number.isNaN(firstGroup)) {
    return true;
  }
  // fe80::/10 — link-local is the whole fe80..febf range, not the fe80 prefix.
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) {
    return true;
  }
  // fc00::/7 — unique local.
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) {
    return true;
  }
  return false;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    // Unparseable is refused: an address this cannot judge is not one to fetch.
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a >= 224
  );
}
