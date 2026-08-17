import { describe, expect, it } from "vitest";
import { CapacityGate } from "../src/capacity";
import { endAndClean, type CleanupTarget } from "../src/cleanup";

function fakeSession(id: string, destroy: () => Promise<void>): CleanupTarget {
  return {
    id,
    dir: `/var/agentos/${id}`,
    endRunOnly: () => undefined,
    publish: async () => [],
    destroy,
  };
}

describe("worker capacity", () => {
  it("queues in FIFO order and never admits above the configured limit", async () => {
    const gate = new CapacityGate(1);
    const first = await gate.acquire();
    const order: string[] = [];
    const second = gate.acquire().then((release) => { order.push("second"); return release; });
    const third = gate.acquire().then((release) => { order.push("third"); return release; });
    expect(gate.active).toBe(1);
    first!();
    const releaseSecond = await second;
    expect(gate.active).toBe(1);
    expect(order).toEqual(["second"]);
    releaseSecond!();
    const releaseThird = await third;
    expect(gate.active).toBe(1);
    expect(order).toEqual(["second", "third"]);
    releaseThird!();
    expect(gate.active).toBe(0);
  });

  it("drain rejects queued and new work while active work retains its slot", async () => {
    const gate = new CapacityGate(1);
    const active = await gate.acquire();
    const queued = gate.acquire();
    gate.setDraining(true);
    expect(await queued).toBeNull();
    expect(await gate.acquire()).toBeNull();
    expect(gate.active).toBe(1);
    active!();
    expect(gate.active).toBe(0);
  });

  it("removes a disconnected queued request without consuming capacity", async () => {
    const gate = new CapacityGate(1);
    const active = await gate.acquire();
    const controller = new AbortController();
    const queued = gate.acquire(controller.signal);
    controller.abort();
    expect(await queued).toBeNull();
    active!();
    expect(gate.active).toBe(0);
  });

  /**
   * The leak this closes: a workspace that survives every delete attempt used
   * to keep its execution permit for ever, so two undeletable directories made
   * a two-slot worker permanently unready. Cleanup can fail; capacity must not
   * be what fails with it.
   */
  it("gives back the permit when the workspace cannot be deleted, and keeps the session listed", async () => {
    const gate = new CapacityGate(1);
    const permits = new Map<string, () => void>([["s1", (await gate.acquire())!]]);
    const listed = new Set(["s1"]);
    expect(gate.active).toBe(1);
    expect(gate.ready).toBe(false);

    let attempts = 0;
    const result = await endAndClean(
      fakeSession("s1", async () => {
        attempts += 1;
        throw new Error("ENOTEMPTY");
      }),
      {
        releaseCapacity: (id) => { permits.get(id)?.(); permits.delete(id); },
        forget: (id) => listed.delete(id),
        log: () => undefined,
      },
      { attempts: 3, backoffMs: 0, sleep: async () => undefined },
    );

    expect(result.destroyed).toBe(false);
    expect(attempts).toBe(3);
    // Capacity is back…
    expect(gate.active).toBe(0);
    expect(gate.ready).toBe(true);
    expect(await gate.acquire()).not.toBeNull();
    // …and the undeletable workspace is still visible for recovery.
    expect(listed.has("s1")).toBe(true);
  });

  it("releases the permit and forgets the session on a successful delete", async () => {
    const gate = new CapacityGate(1);
    const permits = new Map<string, () => void>([["s2", (await gate.acquire())!]]);
    const listed = new Set(["s2"]);
    const published: string[] = [];

    const session = fakeSession("s2", async () => undefined);
    const result = await endAndClean(
      { ...session, publish: async () => { published.push("s2"); return []; } },
      {
        releaseCapacity: (id) => { permits.get(id)?.(); permits.delete(id); },
        forget: (id) => listed.delete(id),
        log: () => undefined,
      },
      { backoffMs: 0, sleep: async () => undefined },
    );

    expect(result.destroyed).toBe(true);
    // Published before the delete: the commits outlive the directory.
    expect(published).toEqual(["s2"]);
    expect(gate.active).toBe(0);
    expect(listed.size).toBe(0);
  });

  it("still releases the permit when publishing throws", async () => {
    const gate = new CapacityGate(1);
    const permits = new Map<string, () => void>([["s3", (await gate.acquire())!]]);
    const session = fakeSession("s3", async () => { throw new Error("ENOTEMPTY"); });

    await endAndClean(
      { ...session, publish: async () => { throw new Error("remote unreachable"); } },
      {
        releaseCapacity: (id) => { permits.get(id)?.(); permits.delete(id); },
        forget: () => undefined,
        log: () => undefined,
      },
      { attempts: 1, backoffMs: 0, sleep: async () => undefined },
    );

    expect(gate.active).toBe(0);
  });
});
