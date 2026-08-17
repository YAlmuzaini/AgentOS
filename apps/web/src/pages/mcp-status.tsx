import type { McpConnectionDto, McpSeed } from "@agentos/shared";
import { StatusPill } from "../components/ui/pill";
import { Time } from "../components/ui/time";

/**
 * The five words this screen has to keep apart.
 *
 * They were previously all rendered as "it's there", which is how an operator
 * ends up believing a connection works because a row exists:
 *
 *   cataloged  AgentOS knows this URL and its declared transport and auth.
 *   configured A row exists in this project. Maybe without a credential.
 *   granted    At least one agent lists it, so a session can reach it.
 *   verified   A real handshake succeeded — `initialize` and `tools/list`.
 *   reachable  A network question, answered by the environment allowlist.
 *
 * Only `verified` is evidence. Everything else is intent.
 */
export function McpStateRow({
  connection,
  seed,
  grantedTo,
}: {
  connection: McpConnectionDto;
  /** The catalogue entry this row came from, when it came from one. */
  seed: McpSeed | undefined;
  /** Names of agents that list this connection. */
  grantedTo: string[];
}): React.JSX.Element {
  const needsCredential = seed?.credentialRequired && !connection.credentialSecretId;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {seed ? (
        <StatusPill tone="neutral" title="AgentOS ships this endpoint and has declared its transport, authentication and risks. That is not the same as having contacted it.">
          cataloged
        </StatusPill>
      ) : null}

      {needsCredential ? (
        <StatusPill
          tone="gate"
          title={`This server needs a credential. Attach a secret pointing at ${seed?.credentialEnvVar}.`}
        >
          needs credential
        </StatusPill>
      ) : null}

      {grantedTo.length > 0 ? (
        <StatusPill tone="idle" title={`Granted to ${grantedTo.join(", ")}.`}>
          granted &times;{grantedTo.length}
        </StatusPill>
      ) : (
        <StatusPill tone="neutral" title="No agent lists this connection, so no session can call it. Installing never grants.">
          granted to nobody
        </StatusPill>
      )}

      {connection.verifiedAt ? (
        <StatusPill
          tone="live"
          title={`${connection.verifiedTools.length} tool(s) reported: ${connection.verifiedTools.join(", ") || "none"}`}
        >
          verified <Time iso={connection.verifiedAt} />
        </StatusPill>
      ) : connection.verifyError ? (
        <StatusPill tone="danger" title={connection.verifyError}>
          verification failed
        </StatusPill>
      ) : (
        <StatusPill tone="neutral" title="Nobody has handshaken with this server from here. Press Verify to find out.">
          unverified
        </StatusPill>
      )}
    </span>
  );
}

/** Risk labels, straight from the catalogue. A fact, so neutral — except the two that cost. */
export function McpRisks({ seed }: { seed: McpSeed | undefined }): React.JSX.Element | null {
  if (!seed) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {seed.risks.map((risk) => (
        <StatusPill
          key={risk}
          // `billable` and `high-risk` are the two that turn a bad afternoon
          // into an invoice or a refund, so they get the hue that means "this
          // needs you". Everything else is a fact about the server.
          tone={risk === "billable" || risk === "high-risk" ? "gate" : "neutral"}
          title={RISK_HINTS[risk]}
        >
          {risk}
        </StatusPill>
      ))}
    </span>
  );
}

const RISK_HINTS: Record<string, string> = {
  "read-only": "No documented tool on this server changes anything.",
  mutating: "This server can change a real system through its tools.",
  billable: "Calls against this server can cost money on your account.",
  "high-risk": "Reaches money, production, or something published. Grant deliberately.",
};

/**
 * The local runner's one honest limitation, said where it applies.
 *
 * Claude Code attaches an MCP server whole — there is no per-tool gate — so a
 * connection with a narrowed operation list is *refused* locally rather than
 * widened, and a connection with an empty list hands the agent every tool the
 * server exposes. Both halves surprise people, and both are worth a sentence
 * next to the row rather than a paragraph in a document nobody opens.
 */
export function LocalToolWarning({
  connection,
  seed,
}: {
  connection: McpConnectionDto;
  seed: McpSeed | undefined;
}): React.JSX.Element | null {
  if (!seed?.localRequiresAllTools) {
    return null;
  }
  // The unscoped case is the *default*, so saying it on every row printed the
  // same paragraph eight times and buried the rows it was attached to. It is
  // stated once above the table instead; only the scoped case — which behaves
  // differently on each runner — earns a line of its own here.
  if (connection.allowedOperations.length === 0) {
    return null;
  }
  return (
    <p className="text-xs leading-relaxed text-ink-faint">
      Scoped to {connection.allowedOperations.length} tool(s): enforced per tool on the cloud
      runner, and <span className="text-ink-muted">not attached at all</span> on the local worker,
      which cannot filter — the omission is reported in the session log.
    </p>
  );
}

/**
 * The sentence that applies to every row, said once.
 *
 * Rendered above the table rather than on each connection: it is a property of
 * the local runner, not of any particular server.
 */
export function LocalToolNote(): React.JSX.Element {
  return (
    <p className="text-xs leading-relaxed text-ink-faint">
      The local worker attaches an MCP server whole. A connection with no operation list gives a
      local session <span className="text-ink-muted">every tool that server exposes</span>; naming
      operations narrows it on the cloud runner and stops the local worker attaching it at all.
    </p>
  );
}
