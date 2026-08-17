import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.js";
import { isGrokModel, runGrokSession } from "../src/grok-agent.js";
import { acceptsNetworking, loadConfig } from "../src/config.js";
import { grantedEnv, inheritableEnv } from "../src/env.js";
import { collectCommits, publishCommits } from "../src/workspace.js";
import { runWorkspaceTool } from "../src/workspace-tools.js";
import type { WorkerConfig } from "../src/config.js";
import type { ProvisionBody, RunnerEvent } from "../src/protocol.js";

/**
 * The two halves of SPEC §16 this worker gained: an egress wall it can
 * actually enforce for ordinary clients, and a second engine.
 */
describe("egress proxy", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
  });

  it("refuses a host the environment did not allow, and allows one it did", async () => {
    // A server standing in for the allow-listed host, so nothing in this test
    // touches the real network.
    const upstream = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    closers.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const proxy = await startEgressProxy(["127.0.0.1"]);
    closers.push(proxy.close);
    const proxyPort = Number(new URL(proxy.env.HTTP_PROXY!).port);

    const blocked = await proxyRequest(proxyPort, "http://github.com/anything");
    expect(blocked.status).toBe(403);
    expect(proxy.refused).toContain("github.com");

    const allowed = await proxyRequest(proxyPort, `http://127.0.0.1:${upstreamPort}/anything`);
    expect(allowed.status).toBe(200);
  });

  it("refuses a CONNECT to a host outside the allowlist", async () => {
    const proxy = await startEgressProxy(["api.front.com"]);
    closers.push(proxy.close);
    const proxyPort = Number(new URL(proxy.env.HTTP_PROXY!).port);

    const status = await connectStatus(proxyPort, "github.com:443");
    expect(status).toBe(403);
    // A subdomain of an allowed host passes; a lookalike does not.
    expect(await connectStatus(proxyPort, "evil-front.com:443")).toBe(403);
  });

  it("hands the child a proxy configuration that skips loopback", async () => {
    const proxy = await startEgressProxy(["api.front.com"]);
    closers.push(proxy.close);
    expect(proxy.env.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The credential proxy lives on loopback; routing it through the egress
    // wall would break every model call.
    expect(proxy.env.NO_PROXY).toContain("127.0.0.1");
  });
});

describe("workspace tools", () => {
  it("refuses a path that climbs out of the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-ws-"));
    const result = await runWorkspaceTool(root, "workspace_read", { path: "../../etc/hosts" });
    expect(result).toMatch(/outside the session workspace/);
  });

  it("reads and writes inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-ws-"));
    await runWorkspaceTool(root, "workspace_write", { path: "notes/a.md", content: "hello" });
    expect(await readFile(join(root, "notes/a.md"), "utf8")).toBe("hello");
    expect(await runWorkspaceTool(root, "workspace_read", { path: "notes/a.md" })).toBe("hello");
  });

  it("runs a command and reports its exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-ws-"));
    await writeFile(join(root, "marker"), "x", "utf8");
    const result = await runWorkspaceTool(root, "workspace_shell", { command: "ls" });
    expect(result).toContain("exit 0");
    expect(result).toContain("marker");
  });
});

/**
 * Codex, review round eight: a granted binding named HTTPS_PROXY or
 * ANTHROPIC_BASE_URL is not a variable — it is a way to switch containment off
 * or point the run at a different credential.
 */
/**
 * SPEC §5.5, fail closed: the proxy is a layer, and only the operator's
 * assertion that this machine is confined is a permission.
 */
describe("network acceptance", () => {
  it("refuses a limited session unless the operator asserted confinement", () => {
    expect(acceptsNetworking({ allowUnenforcedNetwork: false }, "limited")).toBe(false);
    expect(acceptsNetworking({ allowUnenforcedNetwork: true }, "limited")).toBe(true);
    // An open environment asks for no wall, so there is nothing to refuse.
    expect(acceptsNetworking({ allowUnenforcedNetwork: false }, "open")).toBe(true);
  });

  it("treats a non-positive ceiling as unset rather than as zero", () => {
    const base = { LOCAL_RUNNER_TOKEN: "t" };
    expect(loadConfig({ ...base, LOCAL_RUNNER_MAX_SESSION_REQUESTS: "0" }).maxSessionRequests).toBe(500);
    expect(loadConfig({ ...base, LOCAL_RUNNER_MAX_SESSION_REQUESTS: "abc" }).maxSessionRequests).toBe(500);
    expect(loadConfig({ ...base, LOCAL_RUNNER_MAX_SESSION_REQUESTS: "7" }).maxSessionRequests).toBe(7);
  });
});

describe("granted environment", () => {
  it("refuses bindings that would reconfigure the runtime", () => {
    const refused: string[] = [];
    const env = grantedEnv(
      [
        { key: "MONGO_URL", value: "mongodb://readonly" },
        { key: "HTTPS_PROXY", value: "http://attacker" },
        { key: "ANTHROPIC_BASE_URL", value: "http://attacker" },
        { key: "ANTHROPIC_API_KEY", value: "sk-ant-stolen" },
      ],
      (key) => refused.push(key),
    );
    expect(env).toEqual({ MONGO_URL: "mongodb://readonly" });
    expect(refused).toEqual(["HTTPS_PROXY", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"]);
  });

  it("keeps the worker's own credentials out of the agent's environment", () => {
    process.env.GROK_API_KEY = "xai-should-not-leak";
    // The path is as good as the key: the same unix user owns both.
    process.env.GROK_API_KEY_FILE = "/etc/agentos/grok-token";
    process.env.XAI_API_KEY = "xai-alias";
    process.env.LOCAL_RUNNER_TOKEN = "worker-token";
    const inherited = inheritableEnv();
    expect(inherited.GROK_API_KEY).toBeUndefined();
    expect(inherited.GROK_API_KEY_FILE).toBeUndefined();
    expect(inherited.XAI_API_KEY).toBeUndefined();
    expect(inherited.LOCAL_RUNNER_TOKEN).toBeUndefined();
    expect(inherited.PATH).toBeDefined();
  });

  it("refuses a binding that points the runtime at another credential file", () => {
    const refused: string[] = [];
    const env = grantedEnv(
      [
        { key: "GROK_API_KEY_FILE", value: "/tmp/mine" },
        { key: "XAI_API_KEY", value: "xai-stolen" },
      ],
      (key) => refused.push(key),
    );
    expect(env).toEqual({});
    expect(refused).toEqual(["GROK_API_KEY_FILE", "XAI_API_KEY"]);
  });
});

/**
 * SPEC §6, and Codex round eight: a `git-read` grant cannot produce a commit
 * anyone will ever see, so a local commit in one is scratch work.
 */
describe("commit collection", () => {
  /** A repository with one commit the cloned tip does not have. */
  async function repoWithOneCommit(root: string, mount: string): Promise<void> {
    const dir = join(root, mount);
    await mkdir(dir, { recursive: true });
    const run = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await run(["init", "--initial-branch=main", "-q"]);
    await run(["config", "user.email", "test@example.invalid"]);
    await run(["config", "user.name", "Test"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await run(["add", "-A"]);
    await run(["commit", "-qm", "base"]);
    // The clone's tip, as `git clone --branch main` would have left it.
    await run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await writeFile(join(dir, "a.txt"), "two", "utf8");
    await run(["commit", "-aqm", "the agent's work"]);
  }

  it("reports commits for a git-write repo and skips a git-read one", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-commits-"));
    await repoWithOneCommit(root, "writable");
    await repoWithOneCommit(root, "readonly");

    const commits = await collectCommits(root, [
      {
        name: "writable",
        remoteUrl: "https://example.invalid/w.git",
        mountPath: "/writable",
        branch: "main",
        permissions: "git-write",
        token: null,
      },
      {
        name: "readonly",
        remoteUrl: "https://example.invalid/r.git",
        mountPath: "/readonly",
        branch: "main",
        permissions: "git-read",
        token: null,
      },
    ]);

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ repo: "writable", subject: "the agent's work" });
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("grok engine", () => {
  it("routes only grok models to itself", () => {
    expect(isGrokModel("grok-4.6")).toBe(true);
    expect(isGrokModel("claude-sonnet-5")).toBe(false);
  });

  /**
   * The loop's whole contract: control-plane tools are forwarded rather than
   * executed here, and the run ends when the model stops asking for tools.
   */
  it("forwards a control-plane tool call and finishes", async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const events: RunnerEvent[] = [];
    let turn = 0;

    const server = createServer((request, response) => {
      turn += 1;
      const body =
        turn === 1
          ? {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "agentos_update_task",
                          arguments: JSON.stringify({ status: "done" }),
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { choices: [{ message: { content: "finished", tool_calls: [] } }] };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const config = {
      grokApiKey: "test",
      grokBaseUrl: `http://127.0.0.1:${port}`,
      egressMode: "none",
      // `loadConfig` guarantees a positive ceiling; a double has to as well.
      maxSessionRequests: 500,
    } as WorkerConfig;

    const session = {
      dir: await mkdtemp(join(tmpdir(), "agentos-grok-")),
      input: {
        model: "grok-4.6",
        systemPrompt: "you are a test",
        kickoff: "do the thing",
        budgetUsd: null,
        tools: [
          {
            name: "agentos_update_task",
            description: "update",
            inputSchema: { type: "object", properties: {} },
          },
        ],
        environment: { key: "open", networking: "open", allowedHosts: [] },
        envVars: [],
      },
      emit: (event: RunnerEvent) => events.push(event),
      // The real session scrubs its own granted secrets out of anything it
      // says; the stub has to offer the same surface or the engine throws.
      scrub: (text: string) => text,
      callTool: async (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return 'task status is now "done"';
      },
    };

    await runGrokSession(
      session as unknown as Parameters<typeof runGrokSession>[0],
      config,
      new AbortController().signal,
    );
    server.close();

    expect(calls).toEqual([{ name: "agentos_update_task", input: { status: "done" } }]);
    expect(events.at(-1)).toEqual({ kind: "idle", stopReason: "end_turn" });
  });

  it("refuses a $0 budget as firmly as a $5 one", async () => {
    const events: RunnerEvent[] = [];
    const session = {
      dir: "/tmp",
      input: {
        model: "grok-4.6",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        // A goal that has already spent its cap dispatches with zero left.
        budgetUsd: 0,
        environment: { key: "open", networking: "open", allowedHosts: [] },
        envVars: [],
      },
      emit: (event: RunnerEvent) => events.push(event),
      callTool: async () => "",
    };
    await runGrokSession(
      session as unknown as Parameters<typeof runGrokSession>[0],
      { grokApiKey: "set", grokBaseUrl: "http://127.0.0.1:1", egressMode: "none" } as WorkerConfig,
      new AbortController().signal,
    );
    expect(JSON.stringify(events[0])).toMatch(/cannot measure spend/);
  });

  it("stops at the configured request ceiling instead of looping", async () => {
    const events: RunnerEvent[] = [];
    let calls = 0;
    // Always asks for another tool call, so only the ceiling can end it.
    const server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: `call_${calls}`,
                    type: "function",
                    function: { name: "workspace_list", arguments: JSON.stringify({ path: "." }) },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const session = {
      dir: await mkdtemp(join(tmpdir(), "agentos-grok-")),
      input: {
        model: "grok-4.6",
        systemPrompt: "",
        kickoff: "go",
        tools: [],
        budgetUsd: null,
        environment: { key: "open", networking: "open", allowedHosts: [] },
        envVars: [],
      },
      emit: (event: RunnerEvent) => events.push(event),
      callTool: async () => "",
    };
    await runGrokSession(
      session as unknown as Parameters<typeof runGrokSession>[0],
      {
        grokApiKey: "set",
        grokBaseUrl: `http://127.0.0.1:${port}`,
        egressMode: "none",
        maxSessionRequests: 3,
      } as WorkerConfig,
      new AbortController().signal,
    );
    server.close();

    expect(calls).toBe(3);
    expect(events.at(-1)).toEqual({ kind: "idle", stopReason: "max_turns" });
  });

  it("refuses a budgeted session rather than running it unmetered", async () => {
    const events: RunnerEvent[] = [];
    const session = {
      dir: "/tmp",
      input: {
        model: "grok-4.6",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        budgetUsd: 5,
        environment: { key: "open", networking: "open", allowedHosts: [] },
        envVars: [],
      },
      emit: (event: RunnerEvent) => events.push(event),
      callTool: async () => "",
    };
    await runGrokSession(
      session as unknown as Parameters<typeof runGrokSession>[0],
      { grokApiKey: "set", grokBaseUrl: "http://127.0.0.1:1", egressMode: "none" } as WorkerConfig,
      new AbortController().signal,
    );
    expect(JSON.stringify(events[0])).toMatch(/cannot measure spend/);
  });

  it("says so rather than pretending when no credential is configured", async () => {
    const events: RunnerEvent[] = [];
    const session = {
      dir: "/tmp",
      input: {
        model: "grok-4.6",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        budgetUsd: null,
        environment: { key: "open", networking: "open", allowedHosts: [] },
        envVars: [],
      },
      emit: (event: RunnerEvent) => events.push(event),
      callTool: async () => "",
    };
    await runGrokSession(
      session as unknown as Parameters<typeof runGrokSession>[0],
      { grokApiKey: "", grokBaseUrl: "", egressMode: "none" } as WorkerConfig,
      new AbortController().signal,
    );
    expect(events[0]).toMatchObject({ kind: "error" });
    expect(JSON.stringify(events[0])).toMatch(/no Grok credential/);
  });
});

/** An absolute-form HTTP request, which is what a proxied client sends. */
function proxyRequest(port: number, target: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, method: "GET", path: target },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** The status line a CONNECT gets back, without opening a real tunnel. */
function connectStatus(port: number, authority: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nhost: ${authority}\r\n\r\n`);
    });
    socket.once("data", (chunk: Buffer) => {
      const match = /^HTTP\/1\.1 (\d+)/.exec(chunk.toString());
      socket.destroy();
      resolve(Number(match?.[1] ?? 0));
    });
    socket.on("error", reject);
  });
}

/**
 * Pushing the work out before the workspace is deleted.
 *
 * These run real `git` against real repositories in a temp directory — a bare
 * repo standing in for the remote — because the whole failure this path exists
 * to fix was a plausible-looking implementation that lost commits. A mock would
 * have passed for the broken version too.
 */
describe("publishing local commits", () => {
  async function git(dir: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args.join(" ")}: ${err}`)),
      );
    });
  }

  /**
   * A bare "remote", plus a clone of it with one unpushed commit on top.
   *
   * The remote and the seed checkout live *outside* `root`, because `root`
   * stands in for a session workspace and some tests scan it for unpushed
   * work — a stray seed repository in there would answer for itself.
   */
  async function repoWithRemote(
    root: string,
    mount: string,
  ): Promise<{ remote: string; work: string }> {
    const outside = await mkdtemp(join(tmpdir(), "agentos-remote-"));
    const remote = join(outside, `${mount}.git`);
    await mkdir(remote, { recursive: true });
    await git(remote, ["init", "--bare", "--initial-branch=main", "-q"]);

    const seed = join(outside, `${mount}-seed`);
    await mkdir(seed, { recursive: true });
    await git(seed, ["init", "--initial-branch=main", "-q"]);
    await git(seed, ["config", "user.email", "seed@example.invalid"]);
    await git(seed, ["config", "user.name", "Seed"]);
    await writeFile(join(seed, "a.txt"), "one", "utf8");
    await git(seed, ["add", "-A"]);
    await git(seed, ["commit", "-qm", "base"]);
    await git(seed, ["push", "-q", remote, "main"]);

    const work = join(root, mount);
    await git(root, ["clone", "-q", "--depth", "1", "--branch", "main", remote, work]);
    await git(work, ["config", "user.email", "agent@example.invalid"]);
    await git(work, ["config", "user.name", "Agent"]);
    await writeFile(join(work, "a.txt"), "two", "utf8");
    await git(work, ["commit", "-aqm", "the agent's work"]);
    return { remote, work };
  }

  function grant(
    name: string,
    remote: string,
    permissions: "git-read" | "git-write" = "git-write",
  ) {
    return {
      name,
      remoteUrl: `file://${remote}`,
      mountPath: `/${name}`,
      branch: "main",
      permissions,
      token: "unused-for-a-file-remote",
    };
  }

  it("pushes a git-write repo and reports the sha now on the remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-"));
    const { remote, work } = await repoWithRemote(root, "app");

    const [record] = await publishCommits(root, [grant("app", remote)]);

    expect(record!.pushed).toBe(true);
    expect(record!.commits).toBe(1);
    expect(record!.error).toBeNull();
    // The assertion that matters: the remote actually moved, and it moved to
    // exactly the commit the workspace had.
    expect(await git(remote, ["rev-parse", "main"])).toBe(await git(work, ["rev-parse", "HEAD"]));
    expect(record!.remoteSha).toBe(await git(remote, ["rev-parse", "main"]));
  });

  /** A read grant that produced commits produced scratch commits. */
  it("never pushes a git-read repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-ro-"));
    const { remote } = await repoWithRemote(root, "readonly");
    const before = await git(remote, ["rev-parse", "main"]);

    const records = await publishCommits(root, [grant("readonly", remote, "git-read")]);

    expect(records).toEqual([]);
    expect(await git(remote, ["rev-parse", "main"])).toBe(before);
  });

  /**
   * The exfiltration guard. An agent with a shell can repoint `origin`; the
   * push must follow the operator's grant instead, so the rewritten remote is
   * left untouched and the granted one receives the work.
   */
  it("pushes to the granted remote even when the agent repointed origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-hijack-"));
    const { remote, work } = await repoWithRemote(root, "app");
    const attacker = join(root, "attacker.git");
    await mkdir(attacker, { recursive: true });
    await git(attacker, ["init", "--bare", "--initial-branch=main", "-q"]);
    await git(work, ["remote", "set-url", "origin", `file://${attacker}`]);

    const [record] = await publishCommits(root, [grant("app", remote)]);

    expect(record!.pushed).toBe(true);
    expect(await git(remote, ["rev-parse", "main"])).toBe(await git(work, ["rev-parse", "HEAD"]));
    // The attacker's repo never received a ref at all.
    await expect(git(attacker, ["rev-parse", "main"])).rejects.toThrow();
  });

  it("refuses a remote that would carry the credential in the clear", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-http-"));
    const { remote } = await repoWithRemote(root, "app");

    const [record] = await publishCommits(root, [
      { ...grant("app", remote), remoteUrl: "http://example.invalid/app.git" },
    ]);

    expect(record!.pushed).toBe(false);
    expect(record!.error).toMatch(/not an https remote/);
  });

  /** No force, ever: a remote that moved on is a failure, not an overwrite. */
  it("refuses to push when the remote is no longer an ancestor", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-diverged-"));
    const { remote } = await repoWithRemote(root, "app");
    const remoteHead = await git(remote, ["rev-parse", "main"]);

    // Somebody else pushes to the branch while the session was running.
    const other = join(await mkdtemp(join(tmpdir(), "agentos-other-")), "other");
    await git(root, ["clone", "-q", remote, other]);
    await git(other, ["config", "user.email", "other@example.invalid"]);
    await git(other, ["config", "user.name", "Other"]);
    await writeFile(join(other, "b.txt"), "theirs", "utf8");
    await git(other, ["add", "-A"]);
    await git(other, ["commit", "-qm", "someone else"]);
    await git(other, ["push", "-q", "origin", "main"]);
    const moved = await git(remote, ["rev-parse", "main"]);
    expect(moved).not.toBe(remoteHead);

    const [record] = await publishCommits(root, [grant("app", remote)]);

    expect(record!.pushed).toBe(false);
    expect(record!.error).toBeTruthy();
    // Their commit is still the tip. Nothing was overwritten.
    expect(await git(remote, ["rev-parse", "main"])).toBe(moved);
  });

  /** Running teardown twice must not report a spurious second failure. */
  it("is a no-op when there is nothing ahead of the remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-noop-"));
    const { remote } = await repoWithRemote(root, "app");

    const first = await publishCommits(root, [grant("app", remote)]);
    expect(first[0]!.pushed).toBe(true);

    // The workspace's origin ref has not moved, so a second call still sees the
    // commit as ahead — and the push is simply already satisfied.
    const second = await publishCommits(root, [grant("app", remote)]);
    expect(second[0]!.pushed).toBe(true);
    expect(second[0]!.error).toBeNull();
  });

  /**
   * After a successful push the checkout must stop looking like it holds work
   * nobody has — otherwise the boot sweep quarantines workspaces that were
   * fully published, forever.
   */
  it("moves the local tracking ref so a pushed checkout reads as published", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-ref-"));
    const { remote } = await repoWithRemote(root, "app");

    expect(await holdsUnpushedWork(root)).toBe(true);
    const [record] = await publishCommits(root, [grant("app", remote)]);
    expect(record!.pushed).toBe(true);
    expect(await holdsUnpushedWork(root)).toBe(false);
  });

  it("records a failure per repository rather than abandoning the rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-publish-mixed-"));
    const { remote } = await repoWithRemote(root, "good");

    const records = await publishCommits(root, [
      { ...grant("missing", remote), mountPath: "/nowhere" },
      grant("good", remote),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]!.pushed).toBe(false);
    expect(records[0]!.error).toBeTruthy();
    expect(records[1]!.pushed).toBe(true);
  });
});

/**
 * The session's own rules about publishing: once, and never at the cost of the
 * only copy of the work.
 */
describe("publish and quarantine", () => {
  async function sessionWith(root: string, repos: ProvisionBody["repos"]) {
    const { LocalSession } = await import("../src/session.js");
    let removed = false;
    const workspace = {
      dir: root,
      async destroy() {
        removed = true;
        await rm(root, { recursive: true, force: true });
      },
    };
    const input = {
      agent: "senior-dev",
      model: "claude-sonnet-5",
      systemPrompt: "",
      kickoff: "",
      tools: [],
      environment: { key: "open", networking: "open" as const, allowedHosts: [] },
      repos,
      mcpServers: [],
      envVars: [],
      budgetUsd: null,
    };
    const session = new LocalSession(input, workspace, new AbortController());
    return { session, wasRemoved: () => removed };
  }

  it("answers a second publish from the first result rather than pushing again", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-pub-once-"));
    const { session } = await sessionWith(root, []);

    const first = await session.publish();
    const second = await session.publish();

    expect(second).toBe(first);
  });

  /**
   * The failure this whole path exists to prevent: destroying a workspace that
   * holds commits which reached no remote.
   */
  it("keeps the workspace when a push failed, and destroy does not delete it", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-quarantine-"));
    // A git-write repo with an unreachable remote: commits exist, push cannot.
    const dir = join(root, "app");
    await mkdir(dir, { recursive: true });
    const git = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(["init", "--initial-branch=main", "-q"]);
    await git(["config", "user.email", "a@example.invalid"]);
    await git(["config", "user.name", "A"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "base"]);
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await writeFile(join(dir, "a.txt"), "two", "utf8");
    await git(["commit", "-aqm", "unpushable work"]);

    const { session, wasRemoved } = await sessionWith(root, [
      {
        name: "app",
        remoteUrl: "https://example.invalid/app.git",
        mountPath: "/app",
        branch: "main",
        permissions: "git-write",
        token: "t",
      },
    ]);

    const records = await session.publish();
    expect(records[0]!.pushed).toBe(false);
    expect(records[0]!.commits).toBe(1);
    expect(session.retainedWorkspace).toBeTruthy();

    await session.destroy();
    // The directory survives, under a name the boot sweep does not clear.
    expect(wasRemoved()).toBe(false);
    expect(session.retainedWorkspace).not.toContain("/session-");
    expect(existsSync(session.retainedWorkspace!)).toBe(true);
  });

  /** A clean run is still destroyed: quarantine is for failure only. */
  it("destroys the workspace normally when there was nothing to keep", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentos-clean-destroy-"));
    const { session, wasRemoved } = await sessionWith(root, []);

    await session.publish();
    await session.destroy();

    expect(session.retainedWorkspace).toBeNull();
    expect(wasRemoved()).toBe(true);
  });
});

/**
 * The boot sweep, which is the one place a worker restart could silently
 * delete an afternoon's work.
 */
describe("stale workspace detection", () => {
  it("reports a checkout with unpushed commits, and clears one without", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-stale-"));

    const git = (dir: string, args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });

    // A checkout whose commit the remote already has.
    const clean = join(root, "clean");
    await mkdir(clean, { recursive: true });
    await git(clean, ["init", "--initial-branch=main", "-q"]);
    await git(clean, ["config", "user.email", "a@example.invalid"]);
    await git(clean, ["config", "user.name", "A"]);
    await writeFile(join(clean, "a.txt"), "one", "utf8");
    await git(clean, ["add", "-A"]);
    await git(clean, ["commit", "-qm", "base"]);
    await git(clean, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    expect(await holdsUnpushedWork(root)).toBe(false);

    // …and one commit on top that no remote knows about.
    await writeFile(join(clean, "a.txt"), "two", "utf8");
    await git(clean, ["commit", "-aqm", "unpushed"]);
    expect(await holdsUnpushedWork(root)).toBe(true);
  });

  /** A directory it cannot read is reported as holding work: fail safe. */
  it("treats an unreadable directory as holding work", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    expect(await holdsUnpushedWork(join(tmpdir(), "agentos-does-not-exist"))).toBe(true);
  });
});

/**
 * Codex round two: the quarantine trigger read a number that git produced, so
 * a failure *before* that number was read looked like "nothing to keep".
 */
describe("quarantine on a failure with no commit count", () => {
  it("keeps the workspace when the count itself could not be read", async () => {
    const { LocalSession } = await import("../src/session.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-noref-"));
    const dir = join(root, "app");
    await mkdir(dir, { recursive: true });
    const git = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(["init", "--initial-branch=main", "-q"]);
    await git(["config", "user.email", "a@example.invalid"]);
    await git(["config", "user.name", "A"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "work"]);
    // No `refs/remotes/origin/main` at all — exactly what an agent that ran
    // `git remote remove origin` leaves behind. The count cannot be computed.

    let removed = false;
    const session = new LocalSession(
      {
        agent: "senior-dev",
        model: "claude-sonnet-5",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        environment: { key: "open", networking: "open" as const, allowedHosts: [] },
        repos: [
          {
            name: "app",
            remoteUrl: "https://example.invalid/app.git",
            mountPath: "/app",
            branch: "main",
            permissions: "git-write" as const,
            token: "t",
          },
        ],
        mcpServers: [],
        envVars: [],
        budgetUsd: null,
      },
      {
        dir: root,
        async destroy() {
          removed = true;
        },
      },
      new AbortController(),
    );

    const [record] = await session.publish();
    expect(record!.pushed).toBe(false);
    expect(record!.commits).toBe(0);
    // The work is still there, so the workspace must be.
    expect(session.retainedWorkspace).toBeTruthy();

    await session.destroy();
    expect(removed).toBe(false);
  });
});

/**
 * Codex round three: publishing takes a snapshot, and the agent is not always
 * stopped when it is taken. The last gate is at deletion, where the loss would
 * actually happen.
 */
describe("the final unpushed-work gate", () => {
  it("keeps a workspace when commits appear after the push was attempted", async () => {
    const { LocalSession } = await import("../src/session.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-late-commit-"));
    const dir = join(root, "app");
    await mkdir(dir, { recursive: true });
    const git = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(["init", "--initial-branch=main", "-q"]);
    await git(["config", "user.email", "a@example.invalid"]);
    await git(["config", "user.name", "A"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "base"]);
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

    let removed = false;
    const session = new LocalSession(
      {
        agent: "senior-dev",
        model: "claude-sonnet-5",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        environment: { key: "open", networking: "open" as const, allowedHosts: [] },
        // No granted repos: publish has nothing to do and reports nothing,
        // which is exactly the snapshot an agent can then invalidate.
        repos: [],
        mcpServers: [],
        envVars: [],
        budgetUsd: null,
      },
      {
        dir: root,
        async destroy() {
          removed = true;
        },
      },
      new AbortController(),
    );

    expect(await session.publish()).toEqual([]);
    expect(session.retainedWorkspace).toBeNull();

    // The agent commits after the snapshot and before teardown deletes.
    await writeFile(join(dir, "a.txt"), "two", "utf8");
    await git(["commit", "-aqm", "raced the teardown"]);

    await session.destroy();

    expect(removed).toBe(false);
    expect(session.retainedWorkspace).toBeTruthy();
  });

  it("still deletes a workspace with nothing outstanding", async () => {
    const { LocalSession } = await import("../src/session.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-nothing-outstanding-"));
    let removed = false;
    const session = new LocalSession(
      {
        agent: "default",
        model: "claude-sonnet-5",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        environment: { key: "open", networking: "open" as const, allowedHosts: [] },
        repos: [],
        mcpServers: [],
        envVars: [],
        budgetUsd: null,
      },
      {
        dir: root,
        async destroy() {
          removed = true;
        },
      },
      new AbortController(),
    );

    await session.publish();
    await session.destroy();

    expect(removed).toBe(true);
    expect(session.retainedWorkspace).toBeNull();
  });

  /** Two callers, one push: the timeout invites teardown to race it. */
  it("runs one publish even when two callers arrive at once", async () => {
    const { LocalSession } = await import("../src/session.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-single-flight-"));
    const session = new LocalSession(
      {
        agent: "default",
        model: "claude-sonnet-5",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        environment: { key: "open", networking: "open" as const, allowedHosts: [] },
        repos: [],
        mcpServers: [],
        envVars: [],
        budgetUsd: null,
      },
      { dir: root, async destroy() {} },
      new AbortController(),
    );

    const [first, second] = await Promise.all([session.publish(), session.publish()]);
    expect(first).toBe(second);
  });
});

/**
 * Codex round four. Each of these is a concrete way work was still lost, or a
 * credential still stored, after three rounds of fixes.
 */
describe("round four regressions", () => {
  async function gitIn(dir: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
    });
  }

  /** A repository two levels down is an ordinary mount, not an exotic one. */
  it("finds a checkout nested below the workspace root", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-nested-"));
    const nested = join(root, "services", "api");
    await mkdir(nested, { recursive: true });
    await gitIn(nested, ["init", "--initial-branch=main", "-q"]);
    await gitIn(nested, ["config", "user.email", "a@example.invalid"]);
    await gitIn(nested, ["config", "user.name", "A"]);
    await writeFile(join(nested, "a.txt"), "one", "utf8");
    await gitIn(nested, ["add", "-A"]);
    await gitIn(nested, ["commit", "-qm", "base"]);
    await gitIn(nested, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    // Published: nothing outstanding, even though it is two levels down.
    expect(await holdsUnpushedWork(root)).toBe(false);

    await writeFile(join(nested, "a.txt"), "two", "utf8");
    await gitIn(nested, ["commit", "-aqm", "unpushed, and nested"]);
    expect(await holdsUnpushedWork(root)).toBe(true);
  });

  /**
   * The credential must not survive into a failure message.
   *
   * The first version of this test pointed at an http server and never reached
   * git at all — the transport guard refused first, so it proved nothing about
   * `run()`'s stderr redaction and would have passed if that broke. This one
   * makes git itself fail on a remote whose *path* contains the token, which
   * is the shape that reliably lands the secret in git's own stderr.
   */
  it("keeps the token out of a real git failure message", async () => {
    const { publishCommits } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-echo-"));
    const dir = join(root, "app");
    await mkdir(dir, { recursive: true });
    await gitIn(dir, ["init", "--initial-branch=main", "-q"]);
    await gitIn(dir, ["config", "user.email", "a@example.invalid"]);
    await gitIn(dir, ["config", "user.name", "A"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await gitIn(dir, ["add", "-A"]);
    await gitIn(dir, ["commit", "-qm", "base"]);
    await gitIn(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await writeFile(join(dir, "a.txt"), "two", "utf8");
    await gitIn(dir, ["commit", "-aqm", "work"]);

    const token = "s3cret-token-value";
    // A `file://` remote passes the transport guard, so git really runs — and
    // fails, quoting the path it could not open. The path contains the token.
    const [record] = await publishCommits(root, [
      {
        name: "app",
        remoteUrl: `file://${join(tmpdir(), `${token}-missing.git`)}`,
        mountPath: "/app",
        branch: "main",
        permissions: "git-write",
        token,
      },
    ]);

    expect(record!.pushed).toBe(false);
    expect(record!.error).toBeTruthy();
    // git named the path; the token inside it must not have survived.
    expect(record!.error!).not.toContain(token);
    expect(record!.error!).toContain("<redacted>");
  });
});

/**
 * Codex round five: a limit that stops searching answers "nothing here", and
 * that answer deletes commits. A limit that refuses to answer keeps them.
 */
describe("search budgets fail safe", () => {
  it("reports work rather than nothing when a repository is too deep to reach", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-deep-"));
    // Deeper than the walk will go. The old code returned "no work" here.
    const deep = join(root, "a/b/c/d/e/f/g/h/i/j/k/l/m/n/repo");
    await mkdir(deep, { recursive: true });

    expect(await holdsUnpushedWork(root)).toBe(true);
  });

  it("reports work rather than nothing when the workspace is unreadable", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    expect(await holdsUnpushedWork(join(tmpdir(), "agentos-not-here-at-all"))).toBe(true);
  });

  /** The clock a retained workspace is expired against must be its own. */
  it("stamps a quarantined directory with both a marker and its mtime", async () => {
    const { stampQuarantine, QUARANTINE_MARKER } = await import("../src/workspace.js");
    const dir = await mkdtemp(join(tmpdir(), "agentos-stamp-"));
    // An old directory, as a workspace from a long-dead session would be.
    const old = new Date(Date.now() - 90 * 86_400_000);
    await utimes(dir, old, old);

    await stampQuarantine(dir);

    const marked = Date.parse((await readFile(join(dir, QUARANTINE_MARKER), "utf8")).trim());
    expect(Number.isNaN(marked)).toBe(false);
    expect(Date.now() - marked).toBeLessThan(60_000);
    // …and the fallback agrees with it, so a failed marker write is still safe.
    const { mtimeMs } = await stat(dir);
    expect(Date.now() - mtimeMs).toBeLessThan(60_000);
  });
});

/**
 * Codex round six. Two ways a checkout could still be judged "already pushed"
 * and deleted, and one way a quarantine could be dated wrongly.
 */
describe("round six regressions", () => {
  async function git(dir: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
    });
  }

  /**
   * `refs/remotes/origin/main` is a file in the checkout, and the agent can
   * write it. Counting against it let an agent make unpushed work look pushed.
   */
  it("counts against the clone-time sha, not a ref the agent can move", async () => {
    const { createWorkspace, publishCommits } = await import("../src/workspace.js");
    const outside = await mkdtemp(join(tmpdir(), "agentos-r6-remote-"));
    const remote = join(outside, "app.git");
    await mkdir(remote, { recursive: true });
    await git(remote, ["init", "--bare", "--initial-branch=main", "-q"]);
    const seed = join(outside, "seed");
    await mkdir(seed, { recursive: true });
    await git(seed, ["init", "--initial-branch=main", "-q"]);
    await git(seed, ["config", "user.email", "s@example.invalid"]);
    await git(seed, ["config", "user.name", "S"]);
    await writeFile(join(seed, "a.txt"), "one", "utf8");
    await git(seed, ["add", "-A"]);
    await git(seed, ["commit", "-qm", "base"]);
    await git(seed, ["push", "-q", remote, "main"]);

    const root = await mkdtemp(join(tmpdir(), "agentos-r6-work-"));
    const grant = {
      name: "app",
      remoteUrl: `file://${remote}`,
      mountPath: "/app",
      branch: "main",
      permissions: "git-write" as const,
      token: "unused-for-a-file-remote",
    };
    const workspace = await createWorkspace(root, {
      agent: "senior-dev",
      model: "claude-sonnet-5",
      systemPrompt: "",
      kickoff: "",
      tools: [],
      environment: { key: "open", networking: "open" as const, allowedHosts: [] },
      repos: [grant],
      mcpServers: [],
      envVars: [],
      budgetUsd: null,
    });

    const work = join(workspace.dir, "app");
    await git(work, ["config", "user.email", "a@example.invalid"]);
    await git(work, ["config", "user.name", "A"]);
    await writeFile(join(work, "a.txt"), "two", "utf8");
    await git(work, ["commit", "-aqm", "the agent's work"]);
    // The agent covers its tracks: the ref now says the remote has this.
    await git(work, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const [record] = await publishCommits(workspace.dir, [grant], workspace.baseShas);

    // Counted against the clone-time sha, so the work is still seen…
    expect(record!.commits).toBe(1);
    // …and it really reached the remote.
    expect(record!.pushed).toBe(true);
  });

  /** A worktree or submodule announces itself with a `.git` *file*. */
  it("sees a checkout whose .git is a file", async () => {
    const { holdsUnpushedWork } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-r6-gitfile-"));
    const checkout = join(root, "app");
    await mkdir(checkout, { recursive: true });
    // No real repository needed: an unreadable one must also be kept.
    await writeFile(join(checkout, ".git"), "gitdir: ../metadata\n", "utf8");

    expect(await holdsUnpushedWork(root)).toBe(true);
  });

  /** Without a marker, a quarantine has no age — and must not be guessed at. */
  it("keeps a quarantined directory that has no marker", async () => {
    const { QUARANTINE_MARKER, stampQuarantine } = await import("../src/workspace.js");
    const dir = await mkdtemp(join(tmpdir(), "agentos-r6-stamp-"));
    expect(await stampQuarantine(dir)).toBe(true);
    expect(await readFile(join(dir, QUARANTINE_MARKER), "utf8")).toBeTruthy();
  });
});

/**
 * Codex round seven. The remaining ways a credential escaped, and the two ways
 * a checkout could still be misjudged.
 */
describe("round seven regressions", () => {
  it("scrubs granted credentials out of anything the session emits", async () => {
    const { LocalSession } = await import("../src/session.js");
    const events: RunnerEvent[] = [];
    const session = new LocalSession(
      {
        agent: "senior-dev",
        model: "claude-sonnet-5",
        systemPrompt: "",
        kickoff: "",
        tools: [],
        environment: { key: "open", networking: "open" as const, allowedHosts: [] },
        repos: [],
        mcpServers: [
          {
            name: "github",
            url: "https://api.githubcopilot.com/mcp/readonly",
            allowedOperations: [],
            token: "ghp_averyrealtokenvalue",
          },
        ],
        envVars: [{ key: "MONGO_URL", value: "mongodb://user:hunter2hunter2@db", allowedHosts: [] }],
        budgetUsd: null,
      },
      { dir: "/tmp/nowhere", async destroy() {} },
      new AbortController(),
    );
    session.subscribe((event) => events.push(event));

    // The shape an MCP server produces when it echoes the request back.
    session.emit({
      kind: "error",
      message: "MCP error: rejected Authorization: Bearer ghp_averyrealtokenvalue",
    });
    session.emit({
      kind: "log",
      eventId: null,
      type: "runner.warning",
      name: null,
      summary: "could not connect using mongodb://user:hunter2hunter2@db",
    });

    // A tool the server *named* after the credential, and a tool call whose
    // arguments carry a granted environment value — both cross the event
    // stream and both used to be forwarded untouched.
    session.emit({
      kind: "log",
      eventId: null,
      type: "mcp.tool",
      name: "search_ghp_averyrealtokenvalue",
      summary: "listed tools",
    });
    session.emit({
      kind: "tool-call",
      eventId: "t1",
      call: {
        toolUseId: "t1",
        name: "inbox_send",
        input: { body: "connect with mongodb://user:hunter2hunter2@db", nested: ["ghp_averyrealtokenvalue"] },
      },
    });

    const said = JSON.stringify(events);
    expect(said).not.toContain("ghp_averyrealtokenvalue");
    expect(said).not.toContain("hunter2hunter2");
    expect(said).toContain("<redacted>");
  });

  /**
   * A session that pushed successfully must not then be judged to still hold
   * unpushed work — that quarantined every productive run and leaked disk in
   * proportion to how well the product was working.
   */
  it("stops reporting unpushed work once the push has landed", async () => {
    const { createWorkspace, publishCommits, holdsUnpushedWork } = await import(
      "../src/workspace.js"
    );
    const outside = await mkdtemp(join(tmpdir(), "agentos-r8-remote-"));
    const remote = join(outside, "app.git");
    await mkdir(remote, { recursive: true });
    const git = (dir: string, args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(remote, ["init", "--bare", "--initial-branch=main", "-q"]);
    const seed = join(outside, "seed");
    await mkdir(seed, { recursive: true });
    await git(seed, ["init", "--initial-branch=main", "-q"]);
    await git(seed, ["config", "user.email", "s@example.invalid"]);
    await git(seed, ["config", "user.name", "S"]);
    await writeFile(join(seed, "a.txt"), "one", "utf8");
    await git(seed, ["add", "-A"]);
    await git(seed, ["commit", "-qm", "base"]);
    await git(seed, ["push", "-q", remote, "main"]);

    const root = await mkdtemp(join(tmpdir(), "agentos-r8-work-"));
    const grant = {
      name: "app",
      remoteUrl: `file://${remote}`,
      mountPath: "/app",
      branch: "main",
      permissions: "git-write" as const,
      token: "unused",
    };
    const workspace = await createWorkspace(root, {
      agent: "senior-dev",
      model: "claude-sonnet-5",
      systemPrompt: "",
      kickoff: "",
      tools: [],
      environment: { key: "open", networking: "open" as const, allowedHosts: [] },
      repos: [grant],
      mcpServers: [],
      envVars: [],
      budgetUsd: null,
    });

    const work = join(workspace.dir, "app");
    await git(work, ["config", "user.email", "a@example.invalid"]);
    await git(work, ["config", "user.name", "A"]);
    await writeFile(join(work, "a.txt"), "two", "utf8");
    await git(work, ["commit", "-aqm", "work"]);

    expect(await holdsUnpushedWork(workspace.dir, workspace.baseShas)).toBe(true);
    const [record] = await publishCommits(workspace.dir, [grant], workspace.baseShas);
    expect(record!.pushed).toBe(true);
    // The base advanced with the push, so there is nothing left outstanding.
    expect(await holdsUnpushedWork(workspace.dir, workspace.baseShas)).toBe(false);
  });

  /** A tag is not a branch, and publishing must not invent one on the remote. */
  it("refuses to push from a detached checkout rather than creating a branch", async () => {
    const { publishCommits, mountKey: mountKeyFor } = await import("../src/workspace.js");
    const outside = await mkdtemp(join(tmpdir(), "agentos-r7-remote-"));
    const remote = join(outside, "app.git");
    await mkdir(remote, { recursive: true });
    const git = (dir: string, args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(remote, ["init", "--bare", "--initial-branch=main", "-q"]);

    const root = await mkdtemp(join(tmpdir(), "agentos-r7-work-"));
    const work = join(root, "app");
    await mkdir(work, { recursive: true });
    await git(work, ["init", "--initial-branch=main", "-q"]);
    await git(work, ["config", "user.email", "a@example.invalid"]);
    await git(work, ["config", "user.name", "A"]);
    await writeFile(join(work, "a.txt"), "one", "utf8");
    await git(work, ["add", "-A"]);
    await git(work, ["commit", "-qm", "base"]);
    const base = await new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["-C", work, "rev-parse", "HEAD"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
    // Detach, exactly as `clone --branch <tag>` leaves it, then commit.
    await git(work, ["checkout", "-q", "--detach", base]);
    await writeFile(join(work, "a.txt"), "two", "utf8");
    await git(work, ["commit", "-aqm", "work on a tag"]);

    const [record] = await publishCommits(
      root,
      [
        {
          name: "app",
          remoteUrl: `file://${remote}`,
          mountPath: "/app",
          branch: "v1.0",
          permissions: "git-write",
          token: "unused",
        },
      ],
      // Keyed the way the workspace keys it — canonical, so `/app`, `/app/`
      // and `/a/./app` cannot become three different entries.
      new Map([[mountKeyFor("/app"), base]]),
    );

    expect(record!.pushed).toBe(false);
    expect(record!.error).toMatch(/detached/);
    // The remote gained nothing.
    await expect(
      new Promise((resolve, reject) => {
        const child = spawn("git", ["-C", remote, "rev-parse", "v1.0"], { stdio: "ignore" });
        child.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error("absent"))));
      }),
    ).rejects.toThrow();
  });

  /** After a restart nothing can be trusted about what a remote has. */
  it("keeps any leftover checkout on boot, pushed or not", async () => {
    const { containsCheckout } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-r7-boot-"));
    expect(await containsCheckout(root)).toBe(false);
    await mkdir(join(root, "app", ".git"), { recursive: true });
    expect(await containsCheckout(root)).toBe(true);
  });
});

/**
 * Codex round eleven: work does not stop existing because `HEAD` moved off it.
 */
describe("round eleven regressions", () => {
  it("keeps a workspace whose commits live on a branch the agent left", async () => {
    const { holdsUnpushedWork, mountKey } = await import("../src/workspace.js");
    const root = await mkdtemp(join(tmpdir(), "agentos-r11-"));
    const dir = join(root, "app");
    await mkdir(dir, { recursive: true });
    const git = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", dir, ...args], { stdio: "ignore" });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(args.join(" ")))));
      });
    await git(["init", "--initial-branch=main", "-q"]);
    await git(["config", "user.email", "a@example.invalid"]);
    await git(["config", "user.name", "A"]);
    await writeFile(join(dir, "a.txt"), "one", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "base"]);
    const base = await new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["-C", dir, "rev-parse", "HEAD"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });

    const bases = new Map([[mountKey("/app"), base]]);
    expect(await holdsUnpushedWork(root, bases)).toBe(false);

    // Work on a side branch, then go back to the base — the commit is no
    // longer reachable from HEAD, and it is still the only copy of the work.
    await git(["checkout", "-q", "-b", "feature"]);
    await writeFile(join(dir, "a.txt"), "two", "utf8");
    await git(["commit", "-aqm", "work on a branch"]);
    await git(["checkout", "-q", "main"]);

    expect(await holdsUnpushedWork(root, bases)).toBe(true);
  });
});
