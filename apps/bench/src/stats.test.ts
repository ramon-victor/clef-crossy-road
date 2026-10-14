import { describe, expect, it } from "vitest";
import { bootstrapMean, bootstrapPairedDiff, mean, median, percentile } from "./stats.ts";

describe("stats", () => {
  it("computes mean, median and interpolated percentiles", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 10);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it("bootstrap CI of a mean brackets the estimate and is reproducible", () => {
    const xs = Array.from({ length: 200 }, (_, i) => (i % 10) + 1);
    const a = bootstrapMean(xs, 2000, 7);
    expect(bootstrapMean(xs, 2000, 7)).toEqual(a);
    expect(a.estimate).toBeCloseTo(5.5, 10);
    expect(a.lo).toBeLessThan(5.5);
    expect(a.hi).toBeGreaterThan(5.5);
    expect(a.hi - a.lo).toBeLessThan(1);
  });

  it("paired CI excludes zero for a consistent improvement and includes it for noise", () => {
    const base = Array.from({ length: 100 }, (_, i) => (i * 7) % 11);
    const better = base.map((x) => x + 1 + (x % 2 === 0 ? 0 : 1));
    expect(bootstrapPairedDiff(better, base, 2000).lo).toBeGreaterThan(0);

    const noisy = base.map((x, i) => x + (i % 2 === 0 ? 2 : -2));
    const ci = bootstrapPairedDiff(noisy, base, 2000);
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0);
  });

  it("refuses unequal paired samples", () => {
    expect(() => bootstrapPairedDiff([1, 2], [1])).toThrow(RangeError);
  });
});
