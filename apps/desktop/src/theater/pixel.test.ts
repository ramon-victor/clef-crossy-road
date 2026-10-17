import { describe, expect, it } from "vitest";
import {
  cellsOf,
  DIRECTIONS,
  ICON_SIZE,
  type IconName,
  iconForGlyph,
  pathOf,
  spriteOf,
} from "./pixel.ts";

const ALL: IconName[] = [...DIRECTIONS, "wait", "check", "cross", "both", "block", "warn"];

describe("the sprites", () => {
  it("are nine by nine, drawn with # and ., and not empty", () => {
    for (const icon of ALL) {
      const sprite = spriteOf(icon);
      expect(sprite, icon).toHaveLength(9);
      for (const row of sprite) expect(row, icon).toMatch(/^[#.]{9}$/);
      expect(sprite.join("").includes("#"), icon).toBe(true);
    }
  });

  it("turn into each other a quarter turn at a time, so none is ever rotated by an odd angle", () => {
    const count = (icon: IconName) => spriteOf(icon).join("").split("#").length - 1;
    expect(new Set(DIRECTIONS.map(count)).size).toBe(1);
    // North turned once is east: the bar of the head, row 4 of the one, is column 4 of the other.
    expect(spriteOf("n")[4]).toBe("#########");
    expect(
      spriteOf("e")
        .map((row) => row[4])
        .join(""),
    ).toBe("#########");
  });

  it("keep the arrow symmetric left to right", () => {
    for (const row of spriteOf("n")) expect(row).toBe([...row].reverse().join(""));
  });

  it("point where they say: the tip of each is on that side", () => {
    expect(spriteOf("n")[0]).toBe("....#....");
    expect(spriteOf("s")[8]).toBe("....#....");
    expect(
      spriteOf("e")
        .map((r) => r[8])
        .join(""),
    ).toBe("....#....");
    expect(
      spriteOf("w")
        .map((r) => r[0])
        .join(""),
    ).toBe("....#....");
  });
});

describe("the pixels of an icon and its edge", () => {
  it("lie inside the eleven by eleven canvas, with the edge only where there is no fill", () => {
    for (const icon of ALL) {
      const { fill, edge } = cellsOf(icon);
      const taken = new Set(fill.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of [...fill, ...edge]) {
        expect(x, icon).toBeGreaterThanOrEqual(0);
        expect(y, icon).toBeGreaterThanOrEqual(0);
        expect(x, icon).toBeLessThan(ICON_SIZE);
        expect(y, icon).toBeLessThan(ICON_SIZE);
      }
      for (const [x, y] of edge) expect(taken.has(`${x},${y}`), icon).toBe(false);
      expect(edge.length, icon).toBeGreaterThan(0);
    }
  });

  it("give one square per pixel in the path", () => {
    expect(
      pathOf([
        [1, 2],
        [3, 4],
      ]),
    ).toBe("M1 2h1v1h-1zM3 4h1v1h-1z");
    expect(pathOf([])).toBe("");
  });
});

describe("the icon for a character", () => {
  it("draws the four moves as straight arrows: forward is up, back is down", () => {
    expect(iconForGlyph("↑")).toBe("n");
    expect(iconForGlyph("↓")).toBe("s");
    expect(iconForGlyph("←")).toBe("w");
    expect(iconForGlyph("→")).toBe("e");
  });

  it("maps the other signs, and leaves any other text alone", () => {
    expect(iconForGlyph("•")).toBe("wait");
    expect(iconForGlyph("✓")).toBe("check");
    expect(iconForGlyph("✗")).toBe("cross");
    expect(iconForGlyph("↔")).toBe("both");
    expect(iconForGlyph("▪")).toBe("block");
    expect(iconForGlyph("!")).toBe("warn");
    expect(iconForGlyph("Yes")).toBeNull();
    expect(iconForGlyph("")).toBeNull();
  });
});
