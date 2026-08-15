/**
 * The two trigger shapes SPEC §14 describes.
 *
 * Installed on demand rather than in the seed: creating a trigger mints a
 * signing key, and a key is only ever shown once — so it has to be shown to
 * whoever asked for it, not printed into a seed log.
 */
export const EXAMPLE_TRIGGERS = [
  {
    name: "support-inbound",
    agentName: "customer-support",
    jobPrompt:
      "A customer support conversation came in. Read it, decide who should own it, and " +
      "assign the right human rep or account executive. You have the support MCP only.",
  },
  {
    name: "bug-report",
    agentName: "diagnostic",
    jobPrompt:
      "Support submitted a bug. You have the repo and the conversation. Produce a cause " +
      "report on the task. Do not implement anything — the operator decides whether to " +
      "start the fix chain.",
  },
] as const;
