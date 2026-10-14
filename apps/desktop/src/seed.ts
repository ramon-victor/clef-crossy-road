/** A map seed is an unsigned 32-bit integer, the range the simulator accepts. */
export const isSeed = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** What the user typed in the seed box. Blank must not mean seed 0 (`Number("")` is 0). */
export function parseSeedText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return isSeed(n) ? n : undefined;
}

/** A short seed that is easy to read and type. */
export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 1) % 1_000_000;
}
