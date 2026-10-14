import { Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { encodeState } from "./encode.ts";
import { MANUALS } from "./prompts.ts";

describe("encoders", () => {
  const game = new Game({ seed: 4 });
  for (let i = 0; i < 9; i++) game.step("hop_forward");
  const obs = observe(game);

  it("json passes the observation through unchanged", () => {
    expect(encodeState("json", obs)).toBe(obs);
  });

  it("grid draws exactly one chicken, on the dz=0 line, and keeps the exact numbers", () => {
    const grid = encodeState("grid", obs) as string;
    expect(grid.match(/@/g)?.length).toBe(1 + 1); // one cell plus the legend entry
    expect(grid.split("\n").find((l) => l.startsWith("dz=0"))).toContain("@");
    expect(grid).toContain("player: col=");
    for (const row of obs.rows) expect(grid).toContain(`dz=${row.dz > 0 ? "+" : ""}${row.dz}`);
  });

  it("neither encoder adds words that classify moves", () => {
    const text = `${JSON.stringify(encodeState("json", obs))}${encodeState("grid", obs)}`;
    expect(text).not.toMatch(/safe|danger|collision|legal|valid|best|recommend/i);
  });

  it("the manuals describe rules but never recommend a move", () => {
    for (const manual of Object.values(MANUALS)) {
      expect(manual).not.toMatch(/\b(should|safest|best move|you must|avoid)\b/i);
    }
  });
});
