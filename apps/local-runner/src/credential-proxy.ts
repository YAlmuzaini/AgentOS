import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Credential } from "./config.js";

const UPSTREAM = "https://api.anthropic.com";

/**
 * Keeps the operator's Claude credential out of the agent's reach.
 *
 * Claude Code runs here with `bypassPermissions` and a Bash tool, so anything
 * in its environment is readable by the agent — `env` prints it, and one
 * outbound request exfiltrates it. A subscription token is worth far more than
 * a single session, and it is not this worker's to lose.
 *
 * So the agent's process gets a placeholder key and a base URL pointing at this
 * loopback proxy. The proxy swaps in the real credential on the way out. An
 * agent can still *use* the proxy — it is on localhost and the run needs it —
 * but it cannot take the credential anywhere: the placeholder is worthless off
 * this machine, and the proxy dies with the worker.
 */
export interface CredentialProxy {
  /** What the child process should use as its API base. */
  baseUrl: string;
  /** Environment for the child: a placeholder, never the real credential. */
  env: Record<string, string>;
  close(): Promise<void>;
}

/**
 * Paths the agent loop legitimately needs. Everything else on the Anthropic API
 * — files, batches, admin — is refused, because the proxy is reachable by
 * anything running in this session and should be able to do exactly one job.
 */
const ALLOWED_PATHS = [/^\/v1\/messages$/, /^\/v1\/messages\/count_tokens$/];

export async function startCredentialProxy(
  credential: Credential,
  limits: { maxRequests?: number } = {},
): Promise<CredentialProxy> {
  // The placeholder is a real-looking value so nothing downstream trips on its
  // shape, and a per-process random so two workers never share one.
  const placeholder = `sk-ant-local-${randomUUID().replace(/-/g, "")}`;
  // A ceiling on how much this credential can be used through this session.
  // The SDK's own budget only governs the calls it makes; an agent issuing its
  // own requests is outside that accounting entirely, so the proxy keeps a
  // count of its own. Generous enough that no honest run reaches it.
  const maxRequests = limits.maxRequests ?? 500;
  let used = 0;

  const server = createServer((request, response) => {
    // The placeholder is a bearer token, not decoration. Without this check any
    // process on the machine — including one the agent started — could use the
    // proxy simply by knowing the port.
    const presented =
      request.headers["x-api-key"] ??
      String(request.headers.authorization ?? "").replace(/^Bearer /, "");
    if (presented !== placeholder) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }

    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (request.method !== "POST" || !ALLOWED_PATHS.some((allowed) => allowed.test(path))) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: `this proxy does not forward ${request.method} ${path}` } }),
      );
      return;
    }

    if (used >= maxRequests) {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message:
              `this session has made ${used} model requests, which is its ceiling. ` +
              "Raise LOCAL_RUNNER_MAX_SESSION_REQUESTS if a legitimate run needs more.",
          },
        }),
      );
      return;
    }
    used += 1;

    forward(request, response, credential, placeholder).catch((error: unknown) => {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: placeholder,
    },
    close: () => closeServer(server),
  };
}

async function forward(
  request: IncomingMessage,
  response: ServerResponse,
  credential: Credential,
  placeholder: string,
): Promise<void> {
  const body = await readBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value !== "string") {
      continue;
    }
    const lower = name.toLowerCase();
    // The client's own auth headers are dropped rather than forwarded: they
    // carry the placeholder, and forwarding them would let a crafted request
    // choose its own credential.
    if (lower === "host" || lower === "authorization" || lower === "x-api-key") {
      continue;
    }
    headers.set(name, value.replace(placeholder, ""));
  }

  // Exactly one place the real credential appears.
  if (credential.kind === "oauth") {
    headers.set("authorization", `Bearer ${credential.value}`);
  } else {
    headers.set("x-api-key", credential.value);
  }

  const upstream = await fetch(`${UPSTREAM}${request.url ?? "/"}`, {
    method: request.method,
    headers,
    body: body.length > 0 ? body : undefined,
  });

  const outbound = new Headers(upstream.headers);
  outbound.delete("content-encoding");
  outbound.delete("content-length");
  response.writeHead(upstream.status, Object.fromEntries(outbound.entries()));

  if (!upstream.body) {
    response.end();
    return;
  }
  // Streamed rather than buffered: these are SSE responses, and the agent loop
  // stalls if the frames only arrive at the end.
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    response.write(Buffer.from(value));
  }
  response.end();
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
