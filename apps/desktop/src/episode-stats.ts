import type { Decision } from "@ccr/agent";

/** Running figures for one episode: how long decisions took, what they cost, how many came from the cache. */
export class EpisodeStats {
  /** Neurons charged during the episode. */
  neurons = 0;
  cacheHits = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private tokenSum = 0;
  private tokenCount = 0;

  add(decision: Decision, wallMs: number): void {
    if (decision.cached) this.cacheHits++;
    else if (decision.latencyMs !== undefined) {
      this.latencySum += wallMs;
      this.latencyCount++;
    }
    if (decision.inputTokens !== undefined) {
      this.tokenSum += decision.inputTokens;
      this.tokenCount++;
    }
    this.neurons += decision.neurons ?? 0;
  }

  /** Mean wall-clock decision time over the decisions that were not served from the cache. */
  get avgLatencyMs(): number | null {
    return this.latencyCount > 0 ? this.latencySum / this.latencyCount : null;
  }

  /** Mean input tokens over the decisions that reported them. */
  get avgTokens(): number | null {
    return this.tokenCount > 0 ? this.tokenSum / this.tokenCount : null;
  }
}
