import { connect as netConnect, type Socket } from "node:net";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A per-session egress wall for the local runner (SPEC §5.5, §16).
 *
 * The cloud runtime enforces its allowlist in the network fabric. A plain VM
 * has no such fabric, so this is the strongest thing a userland worker can do:
 * a loopback proxy that only opens connections to allow-listed hosts, handed
 * to the child through `HTTP_PROXY`/`HTTPS_PROXY`, which every ordinary client
 * on the machine honours — curl, git, node's undici, pip, npm.
 *
 * **This is a wall, not a cage, and the difference is the operator's to close.**
 * An agent with a shell can open a socket directly and ignore the proxy. What
 * this stops is every well-behaved tool and every accident; what it does not
 * stop is a determined, prompt-injected agent. Pair it with a host firewall
 * that only lets this process's user reach the proxy port, or run the session
 * on the cloud runner, which does have the fabric.
 */
export interface EgressProxy {
  /** Environment the child needs to route through this proxy. */
  env: Record<string, string>;
  /** Hosts that were refused, for the session log. */
  readonly refused: string[];
  close(): Promise<void>;
}

export async function startEgressProxy(allowedHosts: string[]): Promise<EgressProxy> {
  const allowed = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  const refused: string[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Plain HTTP through a proxy arrives as an absolute-form URL.
    const target = safeUrl(request.url ?? "");
    if (!target || !permitted(target.hostname, allowed)) {
      refused.push(target?.hostname ?? "(unparseable)");
      response.writeHead(403, { "content-type": "text/plain" }).end("blocked by the AgentOS egress policy\n");
      return;
    }
    forwardPlain(request, response, target);
  });

  // HTTPS arrives as CONNECT: the proxy sees the host, never the payload.
  server.on("connect", (request: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const [host, port] = splitAuthority(request.url ?? "");
    if (!host || !permitted(host, allowed)) {
      refused.push(host || "(unparseable)");
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = netConnect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    clientSocket.on("error", () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  return {
    env: {
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      // The credential proxy is on loopback and must not be routed through this.
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    refused,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Allowlist matching: exact host, or a subdomain of an allowed host.
 *
 * `api.front.com` allows `api.front.com` and nothing else at that level;
 * listing `front.com` also allows `api.front.com`. Never a substring match —
 * `evil-front.com` must not pass because `front.com` is allowed.
 */
function permitted(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function splitAuthority(authority: string): [string, number] {
  const [host, port] = authority.split(":");
  return [(host ?? "").toLowerCase(), Number(port ?? 443) || 443];
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Plain HTTP, forwarded as a real request rather than raw bytes.
 *
 * The earlier version wrote a hand-built request line and piped the upstream
 * socket straight back, which left Node's own response framing hanging off the
 * side of it. This keeps the proxy an HTTP participant: status and headers are
 * copied, the body is piped, and a failure is a 502 the client can read.
 */
function forwardPlain(request: IncomingMessage, response: ServerResponse, target: URL): void {
  const headers = { ...request.headers };
  delete headers["proxy-connection"];
  const upstream = httpRequest(
    {
      host: target.hostname,
      port: Number(target.port || 80),
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain" });
    }
    response.end("upstream unreachable\n");
  });
  request.pipe(upstream);
}
