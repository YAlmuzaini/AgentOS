import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Credential, WorkerConfig } from "./config.js";
import { startCredentialProxy } from "./credential-proxy.js";
import { inheritableEnv } from "./env.js";
import type { DecisionBody } from "./protocol.js";

/** Runs one tool-free structured decision through the subscription-backed CLI. */
export async function runDecision(
  input: DecisionBody,
  credential: Credential,
  config: WorkerConfig,
): Promise<{ output: unknown; model: string; durationMs: number; billingMode: "subscription" | "metered-api" }> {
  // Validated rather than trusted. The body is cast at the route, so a missing
  // `timeoutMs` made `Math.min(Math.max(undefined, 1_000), 120_000)` NaN, and
  // `setTimeout(NaN)` fires immediately — the decision aborted the moment it
  // started, with a failure that read like a model problem. Bearer auth means
  // the caller is the operator's own control plane, so this is a
  // confusing-failure fix, not a trust boundary.
  for (const field of ["prompt", "systemPrompt", "model"] as const) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new Error(`local decision requires a non-empty ${field}`);
    }
  }
  if (!input.schema || typeof input.schema !== "object") {
    throw new Error("local decision requires a JSON schema");
  }
  const requested = Number(input.timeoutMs);
  const timeoutMs = Number.isFinite(requested) ? Math.min(Math.max(requested, 1_000), 120_000) : 90_000;

  const started = Date.now();
  const proxy = await startCredentialProxy(credential, {
    maxRequests: Math.min(config.maxSessionRequests, 4),
  });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), timeoutMs);
  timeout.unref();

  try {
    const response = query({
      prompt: input.prompt,
      options: {
        model: input.model,
        systemPrompt: input.systemPrompt,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "dontAsk",
        outputFormat: { type: "json_schema", schema: input.schema },
        env: { ...inheritableEnv(), ...proxy.env },
        abortController: abort,
      },
    });

    for await (const message of response) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`local decision failed: ${message.subtype}`);
      }
      if (message.structured_output === undefined) {
        throw new Error("local decision returned no structured output");
      }
      return {
        output: message.structured_output,
        // What the CLI reports, when it reports one. Echoing the *requested*
        // model made `goal_decisions.model` read as an observation on the local
        // backend while it is a genuine observation on the cloud one — the same
        // column meaning two different things.
        model: observedModel(message) ?? input.model,
        durationMs: Date.now() - started,
        billingMode: credential.kind === "oauth" ? "subscription" : "metered-api",
      };
    }
    throw new Error("local decision ended without a result");
  } finally {
    clearTimeout(timeout);
    await proxy.close();
  }
}

/** The model the CLI says it used, if the result message carries one. */
function observedModel(message: unknown): string | null {
  const value = (message as { modelUsage?: Record<string, unknown> }).modelUsage;
  if (value && typeof value === "object") {
    const names = Object.keys(value);
    if (names.length === 1 && names[0]) return names[0];
  }
  return null;
}
