import type { WorkerConfig } from "./config.js";
import { startEgressProxy } from "./egress-proxy.js";
import { grantedEnv } from "./env.js";
import type { CustomToolDefinition } from "./protocol.js";
import type { LocalSession } from "./session.js";
import { WORKSPACE_TOOLS, runWorkspaceTool } from "./workspace-tools.js";

/**
 * The second engine of SPEC §16: Grok, in yolo mode, on the operator's own VM.
 *
 * xAI's API is OpenAI-compatible, so this is a plain tool-calling loop rather
 * than another vendor SDK. Two toolsets are exposed and nothing else:
 *
 *  - the control plane's own tools (`agentos_*`, `fs_*`, `inbox_*`), forwarded
 *    over the session the same way the Claude engine forwards them, so gates,
 *    grants and the inbox behave identically on both engines;
 *  - a workspace toolset (shell, read, write, list) confined to the session's
 *    throwaway directory. "Yolo mode" is exactly this: no approval prompt,
 *    because there is no human at the keyboard — the confinement is the
 *    directory and the session's own ceilings, not a permission dialog.
 *
 * Cost is left null: xAI reports tokens, not dollars, and inventing a price
 * would put a number the operator cannot check next to one they can.
 */
const MAX_TURNS = 60;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export async function runGrokSession(
  session: LocalSession,
  config: WorkerConfig,
  abort: AbortSignal,
): Promise<void> {
  const input = session.input;
  // The same egress wall the Claude engine gets: the model call is this
  // process's own, but everything the shell tool spawns routes through it.
  const egress =
    input.environment.networking === "limited" && config.egressMode === "proxy"
      ? await startEgressProxy(input.environment.allowedHosts)
      : null;
  // Granted bindings first, the runtime's own configuration last: a binding
  // named HTTPS_PROXY is an attempt to switch the wall off, not a variable.
  const childEnv = {
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
    ...(egress?.env ?? {}),
  };
  // A cap this engine cannot measure is a cap that does not exist. xAI reports
  // tokens rather than dollars, so a session carrying a budget — every goal
  // specialist under a spend cap — is refused here instead of running
  // unmetered against it.
  // Any budget, including zero: a $0 cap is a goal that has already spent it,
  // and running that unmetered is the same failure as running a $5 one.
  // Loose on purpose: null and a body that omitted the field both mean "no
  // budget", and 0 means a goal that has already spent its cap.
  if (input.budgetUsd != null) {
    await egress?.close();
    session.emit({
      kind: "error",
      message:
        `this session carries a $${(input.budgetUsd ?? 0).toFixed(2)} budget and the Grok engine cannot ` +
        "measure spend, so it will not run it. Route this agent to the cloud runner, or run it " +
        "on a Claude model where the budget is enforced.",
    });
    session.emit({ kind: "idle", stopReason: "error" });
    return;
  }
  if (!config.grokApiKey) {
    await egress?.close();
    session.emit({
      kind: "error",
      message:
        `this session asked for model "${input.model}", and no Grok credential is configured on ` +
        "this worker. Set GROK_API_KEY, or route this agent to the cloud runner.",
    });
    session.emit({ kind: "idle", stopReason: "error" });
    return;
  }

  const tools = [
    ...input.tools.map(toFunctionTool),
    ...WORKSPACE_TOOLS.map(toFunctionTool),
  ];
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.kickoff },
  ];
  const workspaceToolNames = new Set(WORKSPACE_TOOLS.map((tool) => tool.name));
  // The same ceiling the credential proxy puts on the Claude engine: a run
  // that cannot be priced still has to be bounded by something.
  const maxTurns = Math.min(MAX_TURNS, config.maxSessionRequests);

  try {
    for (let turn = 0; turn < maxTurns && !abort.aborted; turn += 1) {
      const reply = await complete(config, input.model, messages, tools, abort);
      messages.push(reply);

      if (reply.content?.trim()) {
        session.emit({
          kind: "log",
          eventId: `grok:${turn}:text`,
          type: "agent.message",
          name: null,
          summary: session.scrub(reply.content).slice(0, 280),
        });
      }

      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) {
        session.emit({ kind: "idle", stopReason: "end_turn" });
        return;
      }

      for (const call of calls) {
        const args = parseArguments(call.function.arguments);
        const result = workspaceToolNames.has(call.function.name)
          ? await runWorkspaceTool(session.dir, call.function.name, args, childEnv)
          : // Everything else is the control plane's: it answers, we relay.
            await session.callTool(call.function.name, args);
        if (workspaceToolNames.has(call.function.name)) {
          session.emit({
            kind: "log",
            eventId: `grok:${turn}:${call.id}`,
            type: "agent.tool_use",
            name: call.function.name,
            summary: call.function.name,
          });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    session.emit({
      kind: "error",
      message: `the run reached ${maxTurns} turns without finishing`,
    });
    session.emit({ kind: "idle", stopReason: "max_turns" });
  } catch (error) {
    if (abort.aborted) {
      return;
    }
    session.emit({ kind: "error", message: String(error) });
    session.emit({ kind: "idle", stopReason: "error" });
  } finally {
    if (egress) {
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

/** True when this session should run on Grok rather than Claude Code. */
export function isGrokModel(model: string): boolean {
  return model.toLowerCase().startsWith("grok");
}

async function complete(
  config: WorkerConfig,
  model: string,
  messages: ChatMessage[],
  tools: unknown[],
  abort: AbortSignal,
): Promise<ChatMessage> {
  const response = await fetch(`${config.grokBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.grokApiKey}`,
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
    signal: abort,
  });
  if (!response.ok) {
    // The body can quote the request, which carries the system prompt but not
    // the credential — the header is never echoed.
    throw new Error(`grok ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: ChatMessage }>;
  };
  const message = body.choices?.[0]?.message;
  if (!message) {
    throw new Error("grok returned no message");
  }
  return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
}

function toFunctionTool(definition: CustomToolDefinition): unknown {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
