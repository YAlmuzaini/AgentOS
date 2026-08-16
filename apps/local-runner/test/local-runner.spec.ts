import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.js";
import { isGrokModel, runGrokSession } from "../src/grok-agent.js";
import { acceptsNetworking, loadConfig } from "../src/config.js";
import { grantedEnv, inheritableEnv } from "../src/env.js";
import { collectCommits } from "../src/workspace.js";
import { runWorkspaceTool } from "../src/workspace-tools.js";
import type { WorkerConfig } from "../src/config.js";
import type { RunnerEvent } from "../src/protocol.js";

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
