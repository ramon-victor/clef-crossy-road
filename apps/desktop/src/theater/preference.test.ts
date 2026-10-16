import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACE,
  type KeyValueStore,
  openByDefault,
  PACE_MS,
  PACES,
  PREFERENCE_KEYS,
  readFlag,
  readPace,
  writeFlag,
  writePace,
} from "./preference.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const blocked: KeyValueStore = {
  getItem: () => {
    throw new Error("storage is blocked");
  },
  setItem: () => {
    throw new Error("storage is blocked");
  },
};

describe("the flags", () => {
  it("are nobody's choice until it is made, then remember on and off, each apart from the other", () => {
    const store = memoryStore();
    expect(readFlag("theater", store)).toBeNull();
    expect(readFlag("compass", store)).toBeNull();
    writeFlag("theater", false, store);
    expect(readFlag("theater", store)).toBe(false);
    expect(readFlag("compass", store)).toBeNull();
    writeFlag("compass", true, store);
    writeFlag("theater", true, store);
    expect(readFlag("theater", store)).toBe(true);
    expect(readFlag("compass", store)).toBe(true);
  });

  it("read anything they do not recognise as no choice", () => {
    expect(readFlag("theater", memoryStore({ "ccr.theater": "maybe" }))).toBeNull();
  });

  it("work without storage, and when storage throws", () => {
    expect(readFlag("compass", null)).toBeNull();
    expect(() => writeFlag("compass", true, null)).not.toThrow();
    expect(readFlag("compass", blocked)).toBeNull();
    expect(() => writeFlag("compass", true, blocked)).not.toThrow();
  });

  it("open for a model by default, and obey the person either way", () => {
    expect(openByDefault(null, "model")).toBe(true);
    expect(openByDefault(null, "reference")).toBe(false);
    expect(openByDefault(null, "human")).toBe(false);
    expect(openByDefault(null, undefined)).toBe(false);
    expect(openByDefault(false, "model")).toBe(false);
    expect(openByDefault(true, "human")).toBe(true);
  });

  it("list every key they keep, so it can be put back", () => {
    expect(PREFERENCE_KEYS).toEqual(["ccr.theater", "ccr.compass", "ccr.theater.pace"]);
  });
});

describe("the pace", () => {
  it("is relaxed until the person picks another, and remembers it", () => {
    const store = memoryStore();
    expect(readPace(store)).toBe(DEFAULT_PACE);
    expect(DEFAULT_PACE).toBe("relaxed");
    writePace("slow", store);
    expect(readPace(store)).toBe("slow");
  });

  it("falls back to the default for anything unknown, or without storage", () => {
    expect(readPace(memoryStore({ "ccr.theater.pace": "warp" }))).toBe(DEFAULT_PACE);
    expect(readPace(null)).toBe(DEFAULT_PACE);
    expect(readPace(blocked)).toBe(DEFAULT_PACE);
    expect(() => writePace("live", blocked)).not.toThrow();
  });

  it("goes from no wait at all to a wait long enough to read", () => {
    expect(PACES.map((pace) => PACE_MS[pace])).toEqual([0, 1000, 2200]);
  });
});
