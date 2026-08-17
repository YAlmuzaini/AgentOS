import { Injectable } from "@nestjs/common";

/** In-process cancellation fan-out for every specialist currently owned by a goal turn. */
@Injectable()
export class GoalRuns {
  private readonly active = new Map<string, Set<AbortController>>();

  begin(goalId: string, parent: AbortSignal): { signal: AbortSignal; release: () => void } {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (parent.aborted) cancel();
    else parent.addEventListener("abort", cancel, { once: true });
    const set = this.active.get(goalId) ?? new Set<AbortController>();
    set.add(controller);
    this.active.set(goalId, set);
    return {
      signal: controller.signal,
      release: () => {
        parent.removeEventListener("abort", cancel);
        set.delete(controller);
        if (set.size === 0) this.active.delete(goalId);
      },
    };
  }

  cancel(goalId: string): void {
    this.active.get(goalId)?.forEach((controller) => controller.abort());
  }
}
