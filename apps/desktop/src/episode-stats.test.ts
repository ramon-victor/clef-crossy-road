import { describe, expect, it } from "vitest";
import { EpisodeStats } from "./episode-stats.ts";

describe("EpisodeStats", () => {
  it("has no averages before the first decision", () => {
    const stats = new EpisodeStats();
    expect([stats.avgLatencyMs, stats.avgTokens, stats.neurons, stats.cacheHits]).toEqual([
      null,
      null,
      0,
      0,
    ]);
  });

  it("averages latency and tokens and adds up the neurons", () => {
    const stats = new EpisodeStats();
    stats.add({ action: "hop_forward", latencyMs: 1, inputTokens: 1000, neurons: 3.5 }, 300);
    stats.add({ action: "hop_left", latencyMs: 1, inputTokens: 1200, neurons: 4.1 }, 500);
    expect(stats.avgLatencyMs).toBe(400);
    expect(stats.avgTokens).toBe(1100);
    expect(stats.neurons).toBeCloseTo(7.6, 10);
  });

  it("counts cache hits apart and keeps them out of the latency average", () => {
    const stats = new EpisodeStats();
    stats.add({ action: "hop_forward", cached: true, latencyMs: 5, inputTokens: 900 }, 2);
    stats.add({ action: "hop_forward", cached: false, latencyMs: 300 }, 320);
    expect(stats.cacheHits).toBe(1);
    expect(stats.avgLatencyMs).toBe(320);
    expect(stats.avgTokens).toBe(900);
  });

  it("ignores the time of a policy that does not report a latency (a reference)", () => {
    const stats = new EpisodeStats();
    stats.add({ action: "hop_forward" }, 4);
    expect(stats.avgLatencyMs).toBeNull();
  });
});
