import { afterEach, describe, expect, it, vi } from "vitest";
import { launchFromQuery, readLaunchOptions } from "./launch.ts";

afterEach(() => vi.unstubAllGlobals());

describe("browser launch", () => {
  it("uses a free player on a fresh localhost launch without needing a model cache", async () => {
    vi.stubGlobal("window", { location: { search: "" } });
    expect(await readLaunchOptions()).toEqual({ player: "lookahead" });
  });

  it("keeps explicit player, seed and logging query options", async () => {
    vi.stubGlobal("window", { location: { search: "?player=human&seed=6&log=full" } });
    expect(await readLaunchOptions()).toEqual({ player: "human", seed: 6, log: "full" });
  });
});

describe("launchFromQuery", () => {
  it("reads the player and the seed", () => {
    expect(launchFromQuery("?player=clef&seed=7")).toEqual({ player: "clef", seed: 7 });
  });

  it("reads how much to log, and leaves it out when it is off or not a mode", () => {
    expect(launchFromQuery("?log=full")).toEqual({ log: "full" });
    expect(launchFromQuery("?player=clef-27b&log=brief")).toEqual({
      player: "clef-27b",
      log: "brief",
    });
    for (const query of ["?log=off", "?log=", "?log=loud"])
      expect(launchFromQuery(query)).toEqual({});
  });

  it("asks for nothing by default", () => {
    expect(launchFromQuery("")).toEqual({});
  });

  it("does not turn a blank or invalid seed into seed 0, which would spend neurons on an uncached map", () => {
    for (const query of ["?seed=", "?seed=abc", "?seed=-1", "?seed=4294967296"]) {
      expect(launchFromQuery(query)).toEqual({});
    }
    expect(launchFromQuery("?seed=0")).toEqual({ seed: 0 });
  });
});
