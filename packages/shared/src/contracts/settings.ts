import { z } from "zod";

/**
 * Which backend runs a session when the agent does not name one.
 *
 * `cloud` bills the Anthropic API per token. `local` runs Claude Code on a
 * machine the operator owns, against a subscription, at a flat rate. `auto`
 * prefers local when it is reachable and falls back to cloud.
 */
export const DEFAULT_RUNNERS = ["auto", "cloud", "local"] as const;
export type DefaultRunner = (typeof DEFAULT_RUNNERS)[number];

/**
 * Operator-tunable policy (SPEC §18 settings screen).
 *
 * The bounds are the interesting part: a timeout of five minutes would reap
 * sessions while the operator is still reading the question, and a sweep every
 * few seconds would hammer the runtime API for no gain. Both are enforced
 * server-side, because the browser is not the authority on this.
 */
export const updateSettingsSchema = z.object({
  /**
   * Minutes a session may sit parked on an inbox question before AgentOS gives
   * up and frees the container. 0 disables the reaper.
   */
  parkedSessionTimeoutMinutes: z
    .number()
    .int()
    .min(0)
    .max(20160) // fourteen days
    .refine((value) => value === 0 || value >= 30, {
      message: "use 0 to disable, or at least 30 minutes — below that answers get reaped mid-read",
    }),
  orphanSweepEnabled: z.boolean(),
  orphanSweepIntervalMinutes: z.number().int().min(5).max(1440),
  /** The money switch — see `DEFAULT_RUNNERS`. */
  defaultRunner: z.enum(DEFAULT_RUNNERS),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface SettingsDto {
  projectId: string;
  parkedSessionTimeoutMinutes: number;
  orphanSweepEnabled: boolean;
  orphanSweepIntervalMinutes: number;
  defaultRunner: DefaultRunner;
  updatedAt: string | null;
}

/**
 * Whether each backend can actually take a session right now.
 *
 * The switch above is a preference, not a promise: the local worker is only
 * reachable if `LOCAL_RUNNER_URL` points at a running process, and it refuses
 * sessions whose agent needs a restricted network because it cannot enforce
 * egress. A settings screen that offered the choice without saying this would
 * let an operator select `local`, see it accepted, and still be billed for
 * every run on the cloud.
 */
export interface RunnerStatusDto {
  cloud: { configured: boolean };
  local: { configured: boolean; healthy: boolean; url: string | null };
}

/** Applied to a project that has never saved settings. */
export const DEFAULT_SETTINGS: Omit<SettingsDto, "projectId" | "updatedAt"> = {
  // A question you have not answered by the next day is not going to be
  // answered inside this container's useful life.
  parkedSessionTimeoutMinutes: 1440,
  orphanSweepEnabled: true,
  orphanSweepIntervalMinutes: 15,
  // Prefers the operator's own machine when it is there, because that is the
  // cheap one; falls back to cloud rather than failing the run.
  defaultRunner: "auto",
};
