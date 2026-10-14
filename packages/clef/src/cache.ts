import type { ClefModel } from "./models.ts";
import type { Answer, ClefUsage } from "./types.ts";

export interface CachedEntry {
  model: ClefModel;
  answers: Record<string, Answer>;
  usage: ClefUsage;
  /** Latency measured when the entry was stored; used to replay realistic delays. */
  latencyMs: number;
}

/**
 * Memoises responses by a hash of the request. Models are deterministic (the same request gave
 * identical probabilities in testing), so replaying a seed costs no neurons.
 */
export interface DecisionCache {
  get(key: string): CachedEntry | undefined | Promise<CachedEntry | undefined>;
  set(key: string, value: CachedEntry): void | Promise<void>;
}

export class MemoryCache implements DecisionCache {
  private readonly map = new Map<string, CachedEntry>();

  get(key: string): CachedEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, value: CachedEntry): void {
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}
