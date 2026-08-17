import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Credential, WorkerConfig } from "./config.js";
import { startCredentialProxy } from "./credential-proxy.js";
import { startEgressProxy } from "./egress-proxy.js";
import { grantedEnv, inheritableEnv } from "./env.js";
import { toZodShape } from "./json-schema-to-zod.js";
import type { CustomToolDefinition, ProvisionBody } from "./protocol.js";
import type { LocalSession } from "./session.js";

/** Tools that reach the network on their own; a limited session must not have them. */
const NETWORK_TOOLS = ["WebFetch", "WebSearch"];

/**
 * Runs one session through Claude Code and translates its messages into the
 * control plane's `RunnerEvent` vocabulary.
 *
 * The mapping is deliberately lossy in one direction only: everything the model
 * does is reported, but only *our* custom tools round-trip to the control
 * plane. Claude Code's own tools (Bash, Read, Edit) execute here, in the
 * workspace, and are reported as log lines — which is the difference between
 * this backend and the cloud one, and why the environment story below matters.
 */
export async function runSession(
  session: LocalSession,
  credential: Credential,
  config: WorkerConfig,
  abort: AbortSignal,
): Promise<void> {
  const input = session.input;
  // One proxy per session, torn down with it, so a leaked base URL is useless
  // the moment the run ends.
  const proxy = await startCredentialProxy(credential, { maxRequests: config.maxSessionRequests });
  // And, when the operator turned it on, one egress wall per session. The
  // child's HTTP_PROXY points at it, so every ordinary client on the machine
  // is held to the environment's allowlist (SPEC §5.5).
  const egress =
    input.environment.networking === "limited" && config.egressMode === "proxy"
      ? await startEgressProxy(input.environment.allowedHosts)
      : null;

  try {
    const response = query({
      prompt: input.kickoff,
      options: {
        model: input.model,
        systemPrompt: input.systemPrompt,
        cwd: session.dir,
        // The workspace is a throwaway directory on a machine the operator
        // owns, and there is no human at the keyboard to approve anything.
        permissionMode: "bypassPermissions",
        disallowedTools: input.environment.networking === "limited" ? NETWORK_TOOLS : [],
        mcpServers: {
          // Granted MCP servers are attached here too, or the local backend
          // would silently give an agent fewer capabilities than its manifest
          // promises. Unlike the cloud runner there is no egress substitution:
          // the token really is handed to the client on this machine.
          ...Object.fromEntries(
            attachableMcpServers(session, input.mcpServers).map((server) => [
              server.name,
              {
                type: "http" as const,
                url: server.url,
                ...(server.token
                  ? { headers: { authorization: `Bearer ${server.token}` } }
                  : {}),
              },
            ]),
          ),
          // Last, and deliberately so: `agentos` is the control plane's own
          // namespace, and a granted server claiming that name must not be
          // able to displace the session's task, inbox and filesystem tools.
          agentos: controlPlaneTools(session, input.tools),
        },
        env: {
          // The SDK *replaces* the child's environment rather than merging, so
          // this has to carry the basics — without PATH the Bash tool has only
          // shell builtins, which looks like a broken sandbox rather than a
          // configuration mistake.
          ...inheritableEnv(),
          // Granted env vars are handed to the session's own processes. Unlike
          // the cloud runner there is no egress substitution here: the value is
          // really in the environment, and the agent can read it. A binding
          // that names a runtime key is refused rather than applied.
          ...grantedEnv(input.envVars, (key) =>
            session.emit({
              kind: "log",
              eventId: `env-refused:${key}`,
              type: "runner.warning",
              name: key,
              summary:
                `the environment variable "${key}" was not injected: that name configures this ` +
                "worker's credential or egress proxy, and a session may not reconfigure either.",
            }),
          ),
          // Applied last, and deliberately so: a placeholder key, a loopback
          // base URL, and the egress wall. The operator's real credential lives
          // in the proxy, not in this environment, because everything here is
          // readable by the agent's own Bash tool.
          ...proxy.env,
          ...(egress?.env ?? {}),
        },
        ...(input.budgetUsd !== null && input.budgetUsd > 0
          ? { maxBudgetUsd: input.budgetUsd }
          : {}),
        abortController: abortControllerFrom(abort),
      },
    });

    for await (const message of response) {
      translate(session, message as Record<string, unknown>);
    }
    session.emit({ kind: "idle", stopReason: "end_turn" });
  } catch (error) {
    if (abort.aborted) {
      return;
    }
    session.emit({ kind: "error", message: String(error) });
    session.emit({ kind: "idle", stopReason: "error" });
  } finally {
    await proxy.close();
    if (egress) {
      // What the wall stopped is worth saying: a session that quietly failed
      // to reach something looks like a model that gave up.
      if (egress.refused.length > 0) {
        session.emit({
          kind: "log",
          eventId: "egress:refused",
          type: "runner.warning",
          name: null,
          summary: `the egress policy refused: ${[...new Set(egress.refused)].join(", ")}`,
        });
      }
      await egress.close();
    }
  }
}

/**
 * Granted MCP servers this backend is able to attach honestly.
 *
 * A grant that names specific operations means every other operation on that
 * server is denied. The cloud runner enforces that per-toolset; Claude Code
 * attaches an MCP server whole, so this worker cannot. Rather than quietly
 * handing the agent the full server — more access than its manifest grants —
 * the server is left off and the omission is reported into the session log,
 * where the operator will see it.
 */
function attachableMcpServers(
  session: LocalSession,
  servers: ProvisionBody["mcpServers"],
): ProvisionBody["mcpServers"] {
  const attachable = servers.filter(
    (server) => server.allowedOperations.length === 0 && server.name !== "agentos",
  );
  for (const server of servers) {
    if (server.name === "agentos") {
      session.emit({
        kind: "log",
        eventId: `mcp-skipped:${server.name}`,
        type: "runner.warning",
        name: server.name,
        summary:
          'an MCP server named "agentos" was not attached: that name belongs to the ' +
          "control plane's own tools. Rename the connection.",
      });
      continue;
    }
    if (server.allowedOperations.length > 0) {
      session.emit({
        kind: "log",
        eventId: `mcp-skipped:${server.name}`,
        type: "runner.warning",
        name: server.name,
        summary:
          `MCP server "${server.name}" was not attached: it is granted for specific ` +
          "operations and the local runner can only attach a server whole. Run this " +
          "agent on the cloud runner, or grant the server without an operation list.",
      });
    }
  }
  return attachable;
}

/**
 * The control plane's tools, exposed to Claude Code as an in-process MCP
 * server. Each handler blocks until the control plane answers.
 */
function controlPlaneTools(session: LocalSession, definitions: CustomToolDefinition[]) {
  return createSdkMcpServer({
    name: "agentos",
    version: "1.0.0",
    tools: definitions.map((definition) =>
      tool(
        definition.name,
        definition.description,
        toZodShape(definition.inputSchema),
        async (args: Record<string, unknown>) => {
          const result = await session.callTool(definition.name, args ?? {});
          return { content: [{ type: "text" as const, text: result }] };
        },
      ),
    ),
  });
}

function translate(session: LocalSession, message: Record<string, unknown>): void {
  const type = String(message.type ?? "");

  if (type === "assistant") {
    const content = ((message.message as { content?: unknown[] } | undefined)?.content ??
      []) as Array<Record<string, unknown>>;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        session.emit({
          kind: "log",
          eventId: String(block.id ?? `${message.uuid ?? ""}:text`),
          type: "agent.message",
          name: null,
          // Scrubbed before the cut: slicing first can leave the front of a
          // long credential behind, which no exact-value replacement will
          // then recognise.
          summary: session.scrub(block.text).slice(0, 280),
        });
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        // A built-in tool: it already ran here. Reported so the operator's
        // session log shows the same detail the cloud runner would.
        session.emit({
          kind: "log",
          eventId: String(block.id ?? `${message.uuid ?? ""}:tool`),
          type: "agent.tool_use",
          name: block.name,
          summary: block.name,
        });
      }
    }
    return;
  }

  if (type === "result") {
    session.recordCost(numberOrNull(message.total_cost_usd));
    if (message.is_error) {
      session.emit({ kind: "error", message: String(message.result ?? "run failed") });
    }
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The SDK wants its own controller; this bridges the session's signal to it. */
function abortControllerFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}
