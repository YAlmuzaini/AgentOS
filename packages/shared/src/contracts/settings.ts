import { z } from "zod";

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
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface SettingsDto {
  projectId: string;
  parkedSessionTimeoutMinutes: number;
  orphanSweepEnabled: boolean;
  orphanSweepIntervalMinutes: number;
  updatedAt: string | null;
}

/** Applied to a project that has never saved settings. */
export const DEFAULT_SETTINGS: Omit<SettingsDto, "projectId" | "updatedAt"> = {
  // A question you have not answered by the next day is not going to be
  // answered inside this container's useful life.
  parkedSessionTimeoutMinutes: 1440,
  orphanSweepEnabled: true,
  orphanSweepIntervalMinutes: 15,
};
