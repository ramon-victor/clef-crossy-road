/**
 * Seeded PRNG (sfc32). This is the only source of randomness in the core.
 *
 * Every row has its own stream, derived from (seed, row, domain). Row content therefore does
 * not depend on the order in which rows are generated, or on how fast a policy plays.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Independent streams for the same (seed, row). */
export const DOMAIN_LAYOUT = 1;
export const DOMAIN_COSMETIC = 2;

function hash32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function createRng(seed: number, stream = 0, domain = DOMAIN_LAYOUT): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`seed must be an integer in [0, 2^32): got ${seed}`);
  }
  let h = hash32(seed ^ 0x9e3779b9);
  h = hash32(h + Math.imul(stream | 0, 0x85ebca6b) + 0x7f4a7c15);
  h = hash32(h ^ Math.imul(domain | 0, 0xc2b2ae35));

  let a = hash32(h + 0x6a09e667);
  let b = hash32(h + 0xbb67ae85);
  let c = hash32(h + 0x3c6ef372);
  let d = hash32(h + 0xa54ff53a);

  const raw = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Warm-up: sfc32 recommends discarding the first outputs of a freshly mixed state.
  for (let i = 0; i < 12; i++) raw();

  return {
    next: raw,
    int(maxExclusive: number): number {
      return Math.floor(raw() * maxExclusive);
    },
  };
}
