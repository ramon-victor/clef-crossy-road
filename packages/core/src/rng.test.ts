import { describe, expect, it } from "vitest";
import { createRng, DOMAIN_COSMETIC } from "./rng.ts";

const take = (seed: number, stream: number, n: number, domain?: number) => {
  const rng = domain === undefined ? createRng(seed, stream) : createRng(seed, stream, domain);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("is deterministic for the same (seed, stream, domain)", () => {
    expect(take(42, 7, 50)).toEqual(take(42, 7, 50));
  });

  it("gives different sequences for different seeds, streams and domains", () => {
    const base = take(42, 7, 8);
    expect(take(43, 7, 8)).not.toEqual(base);
    expect(take(42, 8, 8)).not.toEqual(base);
    expect(take(42, 7, 8, DOMAIN_COSMETIC)).not.toEqual(base);
  });

  it("stays in [0, 1) and is roughly uniform", () => {
    const values = take(1, 0, 100_000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    const buckets = new Array<number>(10).fill(0);
    for (const v of values) buckets[Math.floor(v * 10)] = (buckets[Math.floor(v * 10)] ?? 0) + 1;
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });

  it("int() covers [0, max) evenly", () => {
    const rng = createRng(5, 5);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(8));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("rejects seeds that are not unsigned 32-bit integers", () => {
    expect(() => createRng(-1)).toThrow(RangeError);
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(2 ** 32)).toThrow(RangeError);
  });
});
