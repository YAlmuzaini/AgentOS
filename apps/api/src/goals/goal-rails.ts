import type { goals } from "@agentos/db";

type GoalRow = typeof goals.$inferSelect;

/** Why the loop stopped, or null when it may keep going. */
export type RailBreach =
  | { status: "stopped-spend"; reason: string }
  | { status: "stopped-time"; reason: string }
  | { status: "stopped-stuck"; reason: string };

/**
 * The safety rails (SPEC §11), as a pure function of the goal row.
 *
 * Checked before every dispatch, so a goal can never spend or run past them by
 * one more session. Deliberately free of the service and the database: these
 * are the three numbers standing between an unattended loop and a $1000 night,
 * and they should be readable in one screen with nothing else in the way.
 */
export function checkRails(goal: GoalRow, now = Date.now()): RailBreach | null {
  const cap = goal.spendCapUsd === null ? null : Number(goal.spendCapUsd);
  const spent = Number(goal.spendUsd);
  if (cap !== null && spent >= cap) {
    return {
      status: "stopped-spend",
      reason: `spend cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}`,
    };
  }

  if (goal.maxDurationMinutes !== null && goal.startedAt) {
    const elapsedMinutes = (now - goal.startedAt.getTime()) / 60_000;
    if (elapsedMinutes >= goal.maxDurationMinutes) {
      return {
        status: "stopped-time",
        reason: `max duration reached: ${Math.round(elapsedMinutes)} of ${goal.maxDurationMinutes} minutes`,
      };
    }
  }

  if (goal.stuckCount >= goal.stuckThreshold) {
    return {
      status: "stopped-stuck",
      reason: `no progress across ${goal.stuckCount} iterations`,
    };
  }

  // The rail that cannot be talked out of firing.
  //
  // Every other stop here depends on something an agent influences: the stuck
  // counter resets on a progress mark, and a prompt-injected specialist can
  // mint one by calling its activity tool with any text at all. Self-attested
  // progress is not evidence, so there has to be one ceiling that counts
  // dispatches and nothing else. A goal that has spawned this many specialists
  // is not converging, whatever its log says about itself.
  if (goal.iterations >= MAX_ITERATIONS) {
    return {
      status: "stopped-stuck",
      reason: `reached the hard ceiling of ${MAX_ITERATIONS} iterations without completing`,
    };
  }

  return null;
}

/**
 * The absolute maximum number of specialists one goal may ever dispatch.
 *
 * Deliberately not a setting and deliberately generous: it is a backstop
 * against a loop that has lost the ability to notice it is looping, not a
 * tuning knob. SPEC §11 asks for "stuck at 19" as the *adaptive* rail; this is
 * the one underneath it.
 */
export const MAX_ITERATIONS = 100;
