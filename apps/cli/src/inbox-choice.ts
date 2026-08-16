import type { Flags } from "./client";

/**
 * The inbox decision for an agent, read from the flags (SPEC §5.1).
 *
 * A capability is stated, never inferred. Defaulting it on grants something
 * nobody asked for; defaulting it off creates an agent the operator believes
 * can reach them and cannot; and accepting `--inbox --no-inbox` together —
 * which is what a script assembling flags in a loop produces — silently picks
 * one of two opposite intentions. All three are the same failure: the operator
 * finds out from an agent's behaviour instead of from this command.
 *
 * @param required when true, one of the two flags must be present.
 * @returns the decision, or undefined when neither flag was given and the
 * caller allows that (an update leaves the current value alone).
 */
export function inboxChoice(flags: Flags, required: boolean): boolean | undefined {
  const grant = "inbox" in flags;
  const withhold = "no-inbox" in flags;

  if (grant && withhold) {
    throw new Error(
      "--inbox and --no-inbox contradict each other. Pass exactly one: the inbox is the only " +
        "channel an agent has to you, so which way it goes is not something to guess at.",
    );
  }
  if (!grant && !withhold) {
    if (required) {
      throw new Error(
        "say whether this agent may reach you: pass --inbox to grant the inbox, or --no-inbox to " +
          "withhold it. It is a capability, so it is not assumed either way.",
      );
    }
    return undefined;
  }
  return grant;
}
