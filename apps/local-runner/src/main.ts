import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { runSession } from "./agent.js";
import { isGrokModel, runGrokSession } from "./grok-agent.js";
import { acceptsNetworking, loadConfig, resolveCredential, type WorkerConfig } from "./config.js";
import { frame, type ProvisionBody } from "./protocol.js";
import { LocalSession } from "./session.js";
import {
  collectCommits,
  containsCheckout,
  createWorkspace,
  QUARANTINE_MARKER,
  stampQuarantine,
} from "./workspace.js";

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
    // `capabilities` lets the control plane tell "this worker has no such
    // session" from "this worker is too old to have that route" — both of
    // which answer 404, and only one of which means the work is safely gone.
    // Never cached: a proxy holding this across a worker rollback would let an
    // old worker's route-level 404 read as "session forgotten", and teardown
    // would delete a live workspace on the strength of a stale answer.
    response.setHeader("cache-control", "no-store");
    send(response, 200, {
      ok: true,
      credential: credential.kind,
      sessions: sessions.size,
      capabilities: ["publish"],
    });
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

  const match = /^\/sessions\/([^/]+)(\/events|\/tool-result|\/cost|\/commits|\/publish)?$/.exec(path);
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
    // Asked while the checkout still exists — a moment later the DELETE below
    // removes it and the answer is gone for good (SPEC §6).
    // Asked by teardown, after the event stream has already ended — so the
    // answer travels in the response, not as a session event nobody is reading
    // any more. The control plane writes it onto the session row.
    case "GET /commits":
      send(
        response,
        200,
        await collectCommits(session.dir, session.input.repos, session.baseShas, (text) =>
          session.scrub(text),
        ),
      );
      return;
    // Pushes what the session committed, before the DELETE below removes the
    // only copy. POST because it changes the world — a remote branch moves —
    // and because it is the one call here that must not be retried blindly;
    // the session memoises its answer so a retry is a read.
    case "POST /publish": {
      const records = await session.publish();
      send(response, 200, { records, retainedWorkspace: session.retainedWorkspace });
      return;
    }
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
  // The proxy is a layer, never the permission.
  //
  // It holds every ordinary client, and an agent with a shell can still open
  // its own socket — so treating it as enforcement would turn a wall the
  // operator relies on into a promise this process cannot keep. Accepting a
  // `limited` session remains one deliberate decision: the operator asserting
  // that *this machine* is confined. The proxy then applies on top.
  if (!acceptsNetworking(config, input.environment.networking)) {
    send(response, 409, {
      error:
        `this session requires a limited network (${input.environment.allowedHosts.join(", ") || "no hosts"}) ` +
        "and this worker cannot enforce egress. Confine the machine — a container network policy, " +
        "or a host firewall scoped to this worker's unix user — then set " +
        "LOCAL_RUNNER_ALLOW_UNENFORCED_NETWORK=1 to say so, and LOCAL_RUNNER_EGRESS_MODE=proxy to " +
        "add an allow-listed proxy on top. Leaving it unset keeps these sessions on the cloud " +
        "runner, which has a real egress firewall.",
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

  // Two engines behind one contract (SPEC §16): Claude Code, or Grok in yolo
  // mode. The agent's model decides, and everything above this line — grants,
  // gates, the inbox, the workspace — is identical either way.
  //
  // Nothing here waits for the run: the control plane picks it up on /events.
  void (isGrokModel(input.model)
    ? runGrokSession(session, config, abort.signal)
    : runSession(session, credential, config, abort.signal));
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
  // Stop the agent *first*. It is still running at this point — this is the
  // worker's own hard ceiling firing — and publishing while it works snapshots
  // a moving target: a commit made after the push and before the deletion
  // would reach no remote and then be deleted with the directory. Ending the
  // run also releases the event stream, so the control plane is not left
  // waiting on a session that is being torn down.
  session.endRunOnly();

  // Then publish, because nothing else will ever ask for these commits: the
  // control plane is not driving this path. `publish` memoises, so a later
  // teardown gets the same answer rather than a second attempt, and the git
  // calls underneath it have their own timeout — a stalled push must not hold
  // the ceiling open that this function exists to enforce.
  try {
    await session.publish();
  } catch (error) {
    console.error(`session ${session.id}: could not publish before cleanup: ${String(error)}`);
  }

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
  // Retained workspaces are the one thing here that outlives a restart on
  // purpose. They are still bounded: past the horizon the operator configured,
  // the work has either been recovered or is not going to be, and an
  // ever-growing directory on an unwatched machine becomes its own outage.
  if (config.quarantineDays > 0) {
    const horizon = Date.now() - config.quarantineDays * 86_400_000;
    for (const entry of entries.filter((name) => name.startsWith("quarantine-"))) {
      const path = join(config.workRoot, entry);
      // The marker written when the workspace was set aside. Falling back to
      // `mtime` only when it is missing: a rename does not update the moved
      // directory's own mtime, so mtime alone dated the *session* rather than
      // the quarantine and could expire a fresh one immediately.
      const markedAt = await readFile(join(path, QUARANTINE_MARKER), "utf8")
        .then((text) => Date.parse(text.trim()))
        .catch(() => Number.NaN);
      // `stampQuarantine` writes the marker *and* sets the directory's mtime,
      // so the mtime fallback is a real timestamp rather than the age of
      // whatever this used to be.
      //
      // But a fallback is only usable if it was actually set, and nothing here
      // can tell a stamped mtime from an original one. So the marker is the
      // only clock this trusts, and a directory without one is kept rather than
      // dated — a workspace that survives forever costs disk, and the
      // alternative cost is deleting the only copy of someone's afternoon.
      if (Number.isNaN(markedAt)) {
        console.error(
          `${entry}: no quarantine marker, so its age is unknown; keeping it. Remove it by hand ` +
            "once its commits are recovered.",
        );
        continue;
      }
      if (markedAt < horizon) {
        await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
          console.error(`could not remove the expired workspace ${entry}: ${String(error)}`);
        });
        console.log(
          `removed ${entry}: retained for more than ${config.quarantineDays} days without being recovered`,
        );
      }
    }
  }

  const stale = entries.filter((entry) => entry.startsWith("session-"));
  let removed = 0;
  let kept = 0;
  for (const entry of stale) {
    const path = join(config.workRoot, entry);

    // A workspace left by a killed worker may hold commits that reached no
    // remote — the run ended, or never got to end, without a push. Deleting
    // those is the loss the whole publish path exists to prevent, and a boot
    // sweep is the one place it would happen silently. So anything holding
    // unpushed work is moved out of the swept namespace and left for the
    // operator instead.
    // Not `holdsUnpushedWork`: after a restart there is no trusted record of
    // what any remote has, and the refs in the checkout are agent-writable.
    // Any leftover repository is kept rather than judged.
    if (await containsCheckout(path)) {
      const keptPath = join(config.workRoot, `quarantine-${entry}`);
      await rename(path, keptPath).catch((error: unknown) => {
        console.error(`could not set aside ${entry}: ${String(error)}`);
      });
      // The retention clock starts now, not whenever this directory was last
      // written. Without it the expiry above would read the age of the dead
      // session and delete this on the next boot — the exact case that leaves
      // an operator no window at all.
      await stampQuarantine(keptPath);
      kept += 1;
      console.error(
        `workspace ${entry} still holds a git checkout and this worker has no record of what was ` +
          `pushed; kept at ${keptPath} rather than deleted — recover anything outstanding by ` +
          "hand, then remove the directory",
      );
      continue;
    }

    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch((error: unknown) => {
      console.error(`could not remove the stale workspace ${entry}: ${String(error)}`);
    });
    removed += 1;
  }
  if (removed > 0) {
    console.log(`removed ${removed} workspace(s) left by a previous run`);
  }
  if (kept > 0) {
    console.log(`kept ${kept} workspace(s) that still hold unpushed commits`);
  }
}

/** Says which of the three egress postures this worker is actually in. */
function describeEgress(worker: WorkerConfig): string {
  const layer = worker.egressMode === "proxy" ? " + allow-list proxy" : "";
  // The acceptance flag first, because it is what decides whether a limited
  // session runs here at all. Reporting "allow-list proxy" while every such
  // session is being refused reads as capability the worker does not have.
  return worker.allowUnenforcedNetwork
    ? `operator-managed${layer} (limited sessions accepted)`
    : `required${layer} (limited sessions refused)`;
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
      `workspaces: ${config.workRoot}, engines: claude-code${config.grokApiKey ? " + grok" : ""}, ` +
      `network enforcement: ${describeEgress(config)}`,
  );
});
