export interface RunnerCapabilityProfile {
  sandbox: boolean;
  enforceableEgress: boolean;
  mcpPerToolFiltering: boolean;
  mcpServerAttachment: boolean;
  spendAccounting: "metered-usd" | "subscription-or-worker-credential";
  commitHandling: "runtime-publish" | "worker-observe-and-publish";
  transports: Array<"http">;
  auth: Array<"none" | "bearer">;
  goalEvaluator: boolean;
}

/** One product truth consumed by readiness, routing explanations and UI copy. */
export const RUNNER_CAPABILITIES: Record<"cloud" | "local", RunnerCapabilityProfile> = {
  cloud: {
    sandbox: true,
    enforceableEgress: true,
    mcpPerToolFiltering: true,
    mcpServerAttachment: true,
    spendAccounting: "metered-usd",
    commitHandling: "runtime-publish",
    transports: ["http"],
    auth: ["none", "bearer"],
    goalEvaluator: true,
  },
  local: {
    sandbox: false,
    enforceableEgress: false,
    mcpPerToolFiltering: false,
    mcpServerAttachment: true,
    spendAccounting: "subscription-or-worker-credential",
    commitHandling: "worker-observe-and-publish",
    transports: ["http"],
    auth: ["none", "bearer"],
    goalEvaluator: true,
  },
};
