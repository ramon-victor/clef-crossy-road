/**
 * Concurrency limiter that backs off when the service pushes back (AIMD: halve on a rate limit,
 * add one back after a streak of successes). Cloudflare does not document the Clef rate limit,
 * so the right level is found empirically instead of hard-coded.
 */
export class AdaptiveLimiter {
  private limit: number;
  private active = 0;
  private successes = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;

  constructor(initial: number, max = initial) {
    if (initial < 1) throw new RangeError("concurrency must be at least 1");
    this.limit = initial;
    this.max = Math.max(initial, max);
  }

  get currentLimit(): number {
    return this.limit;
  }

  get inFlight(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.wake();
    };
  }

  onRateLimit(): void {
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.successes = 0;
  }

  onSuccess(): void {
    if (++this.successes >= 20 && this.limit < this.max) {
      this.limit++;
      this.successes = 0;
      this.wake();
    }
  }

  private wake(): void {
    while (this.waiters.length > 0 && this.active < this.limit) {
      this.active++;
      this.waiters.shift()?.();
    }
  }
}
