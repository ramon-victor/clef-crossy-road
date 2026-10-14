import { createRng } from "@ccr/core";

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

export const median = (xs: readonly number[]): number => percentile(xs, 0.5);

export interface Interval {
  estimate: number;
  lo: number;
  hi: number;
}

const DEFAULT_ITERATIONS = 10_000;
const BOOTSTRAP_DOMAIN = 0x424f4f54; // "BOOT": independent of every game stream

/** Percentile bootstrap CI for a mean. */
export function bootstrapMean(
  xs: readonly number[],
  iterations = DEFAULT_ITERATIONS,
  seed = 1,
  alpha = 0.05,
): Interval {
  return bootstrap(xs.length, iterations, seed, alpha, mean(xs), (idx) => {
    let total = 0;
    for (const i of idx) total += xs[i] as number;
    return total / idx.length;
  });
}

/**
 * Percentile bootstrap CI for mean(a - b), resampling seeds (pairs) together, so the shared map
 * luck cancels. `a` and `b` are the scores of two policies on the same seeds, in the same order.
 */
export function bootstrapPairedDiff(
  a: readonly number[],
  b: readonly number[],
  iterations = DEFAULT_ITERATIONS,
  seed = 1,
  alpha = 0.05,
): Interval {
  if (a.length !== b.length) throw new RangeError("paired samples must have the same length");
  const diffs = a.map((x, i) => x - (b[i] as number));
  return bootstrapMean(diffs, iterations, seed, alpha);
}

function bootstrap(
  n: number,
  iterations: number,
  seed: number,
  alpha: number,
  estimate: number,
  statistic: (indices: Int32Array) => number,
): Interval {
  if (n === 0) return { estimate: Number.NaN, lo: Number.NaN, hi: Number.NaN };
  const rng = createRng(seed, 0, BOOTSTRAP_DOMAIN);
  const indices = new Int32Array(n);
  const samples = new Array<number>(iterations);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) indices[i] = rng.int(n);
    samples[it] = statistic(indices);
  }
  return {
    estimate,
    lo: percentile(samples, alpha / 2),
    hi: percentile(samples, 1 - alpha / 2),
  };
}
