import { assertValidJobId, SessionQueue } from "../src/queue/session.queue";
import type { Harness } from "./harness";

export interface QueueSink {
  /** Task ids handed to `enqueueRun`, in order. */
  runs: string[];
  /** Dedupe keys those runs carried, `null` where none was passed. */
  keys: (string | null)[];
  /** Goal ids handed to `enqueueGoalIteration`. */
  goalIterations: string[];
  /** The dedupe keys those iterations carried, `null` where none. */
  goalIterationKeys: (string | null)[];
  /** `[sessionId, inboxMessageId]` pairs handed to `enqueueResume`. */
  resumes: [string, string][];
  clear(): void;
}

/**
 * Replaces the queue with a recorder that still enforces what the real queue
 * enforces.
 *
 * Every suite used to write its own stub, and most of them dropped the dedupe
 * key on the floor — which is exactly how an invalid BullMQ job id reached
 * production while the suite stayed green. The key is validated here through
 * the *same exported function* the queue itself calls, so the stub cannot
 * drift from the real rules the way a hand-copied check does.
 */
export function stubQueue(harness: Harness): QueueSink {
  const sink: QueueSink = {
    runs: [],
    keys: [],
    goalIterations: [],
    goalIterationKeys: [],
    resumes: [],
    clear() {
      sink.runs.length = 0;
      sink.keys.length = 0;
      sink.goalIterations.length = 0;
      sink.goalIterationKeys.length = 0;
      sink.resumes.length = 0;
    },
  };

  const queue = harness.app.get(SessionQueue);
  queue.enqueueRun = async (taskId: string, dedupeKey?: string) => {
    if (dedupeKey) {
      assertValidJobId(dedupeKey);
    }
    sink.runs.push(taskId);
    sink.keys.push(dedupeKey ?? null);
  };
  queue.enqueueGoalIteration = async (goalId: string, dedupeKey?: string) => {
    if (dedupeKey) {
      assertValidJobId(dedupeKey);
    }
    sink.goalIterations.push(goalId);
    sink.goalIterationKeys.push(dedupeKey ?? null);
  };
  queue.enqueueResume = async (sessionId: string, inboxMessageId: string) => {
    sink.resumes.push([sessionId, inboxMessageId]);
  };

  return sink;
}
