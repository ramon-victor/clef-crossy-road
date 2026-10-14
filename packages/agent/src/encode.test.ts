import { Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { encodeState } from "./encode.ts";
import { choiceInstructions, MANUALS, riskInstructions } from "./prompts.ts";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Undoes `json-rel`: `dcol` and `blocked_dcols` back to absolute columns. */
function withAbsoluteColumns(value: unknown, origin: number): unknown {
  if (Array.isArray(value)) return value.map((item) => withAbsoluteColumns(item, origin));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if (key === "dcol") return ["col", round2((inner as number) + origin)];
      if (key === "blocked_dcols") {
        return ["blocked_cols", (inner as number[]).map((d) => round2(d + origin))];
      }
      return [key, withAbsoluteColumns(inner, origin)];
    }),
  );
}

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

  describe("json-rel", () => {
    const state = encodeState("json-rel", obs) as { player: unknown; rows: unknown[] };

    it("only moves the origin: undoing it gives back the observation, nothing added or lost", () => {
      expect(withAbsoluteColumns(state, obs.player.col)).toEqual(obs);
    });

    it("writes offsets in the rows, keeps the chicken's own column absolute and never writes -0", () => {
      expect(state.player).toEqual(obs.player);
      const rows = JSON.stringify(state.rows);
      expect(rows).not.toContain('"col"');
      expect(rows).toContain('"dcol"');
      expect(rows).not.toContain("-0,");
    });
  });

  it("no encoder adds words that classify moves", () => {
    const text = (["json", "json-rel", "grid"] as const)
      .map((encoder) => JSON.stringify(encodeState(encoder, obs)))
      .join("");
    expect(text).not.toMatch(/safe|danger|collision|legal|valid|best|recommend/i);
  });

  it("the manuals and the encoder notes describe rules but never recommend a move", () => {
    const texts = [
      ...Object.values(MANUALS),
      choiceInstructions("full", "json-rel"),
      riskInstructions("full", "hop_forward", "json-rel"),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\b(should|safest|best move|you must|avoid)\b/i);
    }
  });

  it("only json-rel changes the JSON view's instructions, and only by describing its coordinates", () => {
    expect(choiceInstructions("full", "json")).toBe(choiceInstructions("full"));
    const relative = choiceInstructions("full", "json-rel");
    expect(relative.startsWith(MANUALS.full)).toBe(true);
    expect(relative).toContain("dcol");
  });
});
