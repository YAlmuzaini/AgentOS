import { z } from "zod";

export const GOAL_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "stopped-spend",
  "stopped-time",
  "stopped-stuck",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_RUNNER_PREFERENCES = ["cloud", "local", "auto"] as const;

export const dodItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  done: z.boolean().default(false),
});
export type DodItem = z.infer<typeof dodItemSchema>;

/**
 * A goal without a spend cap is allowed, but only if the operator says so out
 * loud (SPEC §11): he ran one overnight without one and it cost $1000.
 */
export const createGoalSchema = z
  .object({
    title: z.string().min(1).max(300),
    spec: z.string().min(1),
    /** Leave empty to have the system draft the checklist from the spec. */
    definitionOfDone: z.array(z.string().min(1)).default([]),
    spendCapUsd: z.number().positive().nullable().default(null),
    acknowledgeNoSpendCap: z.boolean().default(false),
    maxDurationMinutes: z.number().int().positive().nullable().default(null),
    stuckThreshold: z.number().int().min(2).max(100).default(19),
    runnerPreference: z.enum(GOAL_RUNNER_PREFERENCES).default("auto"),
  })
  .superRefine((value, ctx) => {
    if (value.spendCapUsd === null && !value.acknowledgeNoSpendCap) {
      ctx.addIssue({
        code: "custom",
        path: ["spendCapUsd"],
        message:
          "set a spend cap, or pass acknowledgeNoSpendCap to run this goal without one",
      });
    }
  });
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

/** The operator's sign-off on the checklist. Nothing runs before this. */
export const approveDodSchema = z.object({
  definitionOfDone: z.array(dodItemSchema).min(1),
});
export type ApproveDodInput = z.infer<typeof approveDodSchema>;

export interface GoalDto {
  id: string;
  projectId: string;
  title: string;
  spec: string;
  definitionOfDone: DodItem[];
  dodApproved: boolean;
  status: GoalStatus;
  spendCapUsd: number | null;
  spendUsd: number;
  maxDurationMinutes: number | null;
  stuckThreshold: number;
  runnerPreference: (typeof GOAL_RUNNER_PREFERENCES)[number];
  progressLog: string;
  stoppedReason: string | null;
  iterations: number;
  /** When the operator approved the checklist and the loop began. */
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Heuristic first pass at a checklist. Deliberately mechanical: it turns the
 * spec's own bullets or sentences into checkboxes and hands them to the
 * operator to correct. Nothing runs until they approve, so a bad draft costs a
 * few seconds of editing, not a wrong run.
 */
export function draftDefinitionOfDone(spec: string): string[] {
  const bullets = spec
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 0);

  if (bullets.length > 0) {
    return bullets.slice(0, 20);
  }

  return spec
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12)
    .slice(0, 10);
}
