import type { ChoiceKind } from "../policies.ts";

export const PACE_KEY = "ccr.theater.pace";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's storage, or nothing where it is blocked or missing (it can throw even to be looked at). */
function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string, store: KeyValueStore | null): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string, store: KeyValueStore | null): void {
  try {
    store?.setItem(key, value);
  } catch {
    // The choice just does not outlive the session.
  }
}

/** The two things the person can switch on or off, and where the choice is kept. */
export const FLAGS = { theater: "ccr.theater", compass: "ccr.compass" } as const;
export type Flag = keyof typeof FLAGS;

/** What the person chose last time for `flag`, or null if they never did (then the player decides). */
export function readFlag(flag: Flag, store: KeyValueStore | null = browserStore()): boolean | null {
  const value = read(FLAGS[flag], store);
  return value === "on" ? true : value === "off" ? false : null;
}

export function writeFlag(
  flag: Flag,
  on: boolean,
  store: KeyValueStore | null = browserStore(),
): void {
  write(FLAGS[flag], on ? "on" : "off", store);
}

/** Open when the person said so; otherwise open for a model, which is what there is to watch. */
export function openByDefault(preference: boolean | null, kind: ChoiceKind | undefined): boolean {
  return preference ?? kind === "model";
}

/**
 * How long the game lets a model's answer stand before it asks again (step timing). `live` is the speed the
 * benchmark plays at; the others leave time to read what the Theater shows.
 */
export const PACES = ["live", "relaxed", "slow"] as const;
export type Pace = (typeof PACES)[number];
export const PACE_MS: Readonly<Record<Pace, number>> = { live: 0, relaxed: 1000, slow: 2200 };
export const DEFAULT_PACE: Pace = "relaxed";

export function readPace(store: KeyValueStore | null = browserStore()): Pace {
  const value = read(PACE_KEY, store);
  return PACES.find((pace) => pace === value) ?? DEFAULT_PACE;
}

export function writePace(pace: Pace, store: KeyValueStore | null = browserStore()): void {
  write(PACE_KEY, pace, store);
}

/** Every key this module keeps, for whoever must put them back as they were. */
export const PREFERENCE_KEYS: readonly string[] = [FLAGS.theater, FLAGS.compass, PACE_KEY];
