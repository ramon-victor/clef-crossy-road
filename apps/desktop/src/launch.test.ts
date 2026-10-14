import { describe, expect, it } from "vitest";
import { launchFromQuery } from "./launch.ts";

describe("launchFromQuery", () => {
  it("reads the player and the seed", () => {
    expect(launchFromQuery("?player=clef&seed=7")).toEqual({ player: "clef", seed: 7 });
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
