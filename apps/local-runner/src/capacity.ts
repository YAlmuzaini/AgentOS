type Release = () => void;

interface Waiter {
  resolve: (release: Release | null) => void;
  signal?: AbortSignal;
  abort: () => void;
}

/** FIFO admission semaphore shared by sessions and orchestration decisions. */
export class CapacityGate {
  private inUse = 0;
  private draining: boolean;
  private readonly waiters: Waiter[] = [];

  constructor(readonly limit: number, draining = false) {
    this.draining = draining;
  }

  get active(): number {
    return this.inUse;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  get ready(): boolean {
    return !this.draining && this.inUse < this.limit;
  }

  acquire(signal?: AbortSignal): Promise<Release | null> {
    if (this.draining || signal?.aborted) return Promise.resolve(null);
    if (this.inUse < this.limit && this.waiters.length === 0) {
      return Promise.resolve(this.reserve());
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        signal,
        abort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          resolve(null);
        },
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  setDraining(value: boolean): void {
    this.draining = value;
    if (value) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.signal?.removeEventListener("abort", waiter.abort);
        waiter.resolve(null);
      }
    } else {
      this.admit();
    }
  }

  private reserve(): Release {
    this.inUse += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse = Math.max(0, this.inUse - 1);
      this.admit();
    };
  }

  private admit(): void {
    while (!this.draining && this.inUse < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.abort);
      if (waiter.signal?.aborted) {
        waiter.resolve(null);
      } else {
        waiter.resolve(this.reserve());
      }
    }
  }
}
