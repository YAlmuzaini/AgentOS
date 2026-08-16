import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { runSession } from "./agent.js";
import { loadConfig, resolveCredential, type WorkerConfig } from "./config.js";
import { frame, type ProvisionBody } from "./protocol.js";
import { LocalSession } from "./session.js";
import { createWorkspace } from "./workspace.js";

/**
 * The VM-side half of the AgentOS local runner (SPEC §16).
 *
 * A separate deployable on purpose: it runs on a machine the operator owns, it
 * holds a Claude credential and nothing else, and it never talks to the AgentOS
 * database. The control plane drives it over the five endpoints below and
 * answers every AgentOS tool call itself.
 *
 * What this backend is *not*: a sandbox. Claude Code runs as this process's
 * unix user with `bypassPermissions`, inside a throwaway directory. Read
 * DEPLOY.md before pointing real work at it.
 */
const config = loadConfig();
const credential = resolveCredential();
const sessions = new Map<string, LocalSession>();

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    send(response, 500, { error: String(error) });
  });
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/health") {
    send(response, 200, { ok: true, credential: credential.kind, sessions: sessions.size });
    return;
  }

  if (!authorised(request)) {
    send(response, 401, { error: "bad or missing bearer token" });
    return;
  }

  if (path === "/sessions" && request.method === "POST") {
    await provision(request, response);
    return;
  }

  // What this worker currently has running, for the control plane's orphan
  // sweep. A worker that cannot be asked this is a worker whose leaked
  // sessions nobody ever finds.
  if (path === "/sessions" && request.method === "GET") {
    send(
      response,
      200,
      [...sessions.values()]
        .filter((session) => !session.isFinished)
        .map((session) => ({ id: session.id, startedAt: session.startedAt.toISOString() })),
    );
    return;
  }

  const match = /^\/sessions\/([^/]+)(\/events|\/tool-result|\/cost)?$/.exec(path);
  const session = match ? sessions.get(match[1]!) : undefined;
  if (!match || !session) {
    send(response, 404, { error: "unknown session" });
    return;
  }

  switch (`${request.method} ${match[2] ?? ""}`) {
    case "GET /events":
      streamEvents(session, response);
      return;
    case "POST /tool-result": {
      const body = (await readJson(request)) as { toolUseId?: string; result?: string };
      const answered = session.answerTool(String(body.toolUseId ?? ""), String(body.result ?? ""));
      send(response, answered ? 204 : 409, answered ? null : { error: "no such open tool call" });
      return;
    }
    case "GET /cost":
      send(response, 200, { costUsd: session.cost });
      return;
    case "DELETE ":
      // Ends the run, then removes the workspace — and if removal fails, the
      // session stays listed so this can be retried rather than forgotten.
      await session.destroy();
      sessions.delete(session.id);
      send(response, 204, null);
      return;
    default:
      send(response, 405, { error: "method not allowed" });
  }
}

async function provision(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const input = (await readJson(request)) as ProvisionBody;

  // Fail closed on the promise this process cannot keep. The cloud runner has
  // an egress firewall; a VM has whatever the operator configured, which this
  // process cannot see. Refusing is recoverable — the router falls back to
  // cloud. Pretending would silently downgrade a wall the operator relies on.
  if (input.environment.networking === "limited" && !config.allowUnenforcedNetwork) {
    send(response, 409, {
      error:
        `this session requires a limited network (${input.environment.allowedHosts.join(", ") || "no hosts"}) ` +
        "and this worker cannot enforce egress. Configure a firewall on this machine and set " +
        "LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK=1 to accept the risk, or leave it unset to keep " +
        "these sessions on the cloud runner.",
    });
    return;
  }

  // Same refusal the cloud runner makes, for the same reason. A repo granted
  // without a resolved credential used to be cloned anonymously here: a private
  // one failed obscurely mid-run, and a public one succeeded while the session
  // prompt advertised write access the agent did not have. Refusing is the
  // honest answer, and it is the one the operator can act on.
  const credentialless = input.repos.filter((repo) => repo.token === null).map((repo) => repo.name);
  if (credentialless.length > 0) {
    send(response, 409, {
      error:
        `these repositories were granted without a credential that resolved: ${credentialless.join(", ")}. ` +
        "Attach a secret to each repo, or remove the grant from this agent.",
    });
    return;
  }

  const abort = new AbortController();
  const workspace = await createWorkspace(config.workRoot, input);
  const session = new LocalSession(input, workspace, abort);
  sessions.set(session.id, session);

  // Nothing here waits for the run: the control plane picks it up on /events.
  void runSession(session, credential, abort.signal, config.maxSessionRequests);
  expireLater(session, config);

  send(response, 200, { id: session.id });
}

function streamEvents(session: LocalSession, response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const unsubscribe = session.subscribe((event) => {
    response.write(frame(event));
    if (event.kind === "terminated") {
      response.end();
    }
  });
  response.on("close", unsubscribe);
}

/**
 * A hard ceiling on one run, independent of anything the control plane does.
 *
 * The control plane has its own rails, but this worker holds the process: if
 * the control plane crashes mid-run, nothing else will ever stop Claude Code.
 */
function expireLater(session: LocalSession, worker: WorkerConfig): void {
  const timer = setTimeout(
    () => {
      if (session.isFinished) {
        return;
      }
      session.emit({ kind: "error", message: `session exceeded ${worker.maxSessionMinutes}m` });
      void cleanUp(session);
    },
    worker.maxSessionMinutes * 60_000,
  );
  timer.unref();
}

/**
 * Ends a timed-out session and keeps trying to remove its workspace.
 *
 * The run itself stops immediately — `destroy` closes the event stream first,
 * so the control plane's consumer is never left blocked on a session that has
 * already been abandoned. Only the directory removal is retried, because that
 * is the part that fails transiently: an agent's own tooling writing under the
 * workspace as it is torn down produced `ENOTEMPTY` on a real run.
 *
 * A session whose workspace survives every attempt stays in the map on
 * purpose. It remains visible to `GET /sessions`, which is what the control
 * plane's orphan sweep reads, so the operator gets a retry rather than a
 * directory nothing remembers.
 */
async function cleanUp(session: LocalSession): Promise<void> {
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await session.destroy();
      sessions.delete(session.id);
      return;
    } catch (error) {
      console.error(
        `session ${session.id}: cleanup attempt ${attempt}/${CLEANUP_ATTEMPTS} failed: ${String(error)}`,
      );
      if (attempt < CLEANUP_ATTEMPTS) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, attempt * CLEANUP_BACKOFF_MS);
          timer.unref?.();
        });
      }
    }
  }
  console.error(
    `session ${session.id}: workspace ${session.dir} could not be removed; ` +
      "it stays listed so the control plane can retry the delete",
  );
}

const CLEANUP_ATTEMPTS = 4;
const CLEANUP_BACKOFF_MS = 2_000;

/**
 * Clears leftover session directories at boot.
 *
 * No session survives a restart — the map is in memory — so anything still
 * here belongs to a run that is over. Two things leave one behind: a worker
 * killed mid-session, and an agent's own background tooling writing into the
 * workspace *after* cleanup has already removed it, which was observed in a
 * real run leaving an empty `.omc/state` tree. Neither is dangerous on its
 * own; both accumulate on a machine that is never looked at.
 */
async function sweepWorkRoot(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(config.workRoot);
  } catch {
    return;
  }
  const stale = entries.filter((entry) => entry.startsWith("session-"));
  for (const entry of stale) {
    await rm(join(config.workRoot, entry), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch((error: unknown) => {
      console.error(`could not remove the stale workspace ${entry}: ${String(error)}`);
    });
  }
  if (stale.length > 0) {
    console.log(`removed ${stale.length} workspace(s) left by a previous run`);
  }
}

function authorised(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${config.authToken}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (body === null) {
    response.writeHead(status).end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" }).end(payload);
}

await mkdir(config.workRoot, { recursive: true });
await sweepWorkRoot();
server.listen(config.port, () => {
  // The credential kind is worth printing; the credential itself never is.
  console.log(
    `agentos local runner on :${config.port} — auth: ${credential.kind}, ` +
      `workspaces: ${config.workRoot}, network enforcement: ${
        config.allowUnenforcedNetwork ? "operator-managed" : "required (limited sessions refused)"
      }`,
  );
});
