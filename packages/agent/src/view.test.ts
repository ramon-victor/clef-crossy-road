import { Game, type Observation, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { ENCODER_IDS, ENCODER_LEVEL, encodeRequest, encodeState } from "./encode.ts";
import { emptyMemory, type Memory, remember } from "./memory.ts";
import { choiceInstructions } from "./prompts.ts";
import { renderView } from "./view.ts";

/** A hand-built world: the chicken at column 0 with a tree, a car, a log and a lily pad around it. */
const world: Observation = {
  player: { col: 0, standing_on: "grass", riding: false, hop_ticks_left: 0 },
  rows: [
    { dz: -1, kind: "grass", blocked_cols: [] },
    { dz: 0, kind: "grass", blocked_cols: [-2] },
    {
      dz: 1,
      kind: "road",
      vehicles: [{ col: -1, half_extent: 1.25, speed_cols_per_s: 5 }],
    },
    {
      dz: 2,
      kind: "water",
      platforms: [
        { col: 2, half_extent: 1.25, speed_cols_per_s: -2, type: "log" },
        { col: -3, half_extent: 0.75, speed_cols_per_s: 0, type: "lily_pad" },
      ],
    },
    {
      dz: 3,
      kind: "rail",
      train: { col: 90, half_extent: 10.25, speed_cols_per_s: 48 },
      warning_light: "off",
    },
  ],
};

const stuck = (bumps: number): Memory => {
  let memory = remember(emptyMemory(), { action: "hop_forward", outcome: "hop" }, 3);
  for (let i = 0; i < bumps; i++) {
    memory = remember(memory, { action: "hop_forward", outcome: "blocked" }, 3);
  }
  return memory;
};

const lineFor = (text: string, prefix: string, from = 0): string => {
  const line = text
    .split("\n")
    .slice(from)
    .find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`no line starting with ${prefix}`);
  return line;
};

describe("the text view", () => {
  const view = renderView(world, emptyMemory(), { forecast: false });

  it("draws the whole screen around the chicken, far rows first, with one @ in its own row", () => {
    const rows = view.split("\n").filter((l) => l.startsWith("dz="));
    expect(rows.map((l) => l.slice(0, 6))).toEqual([
      "dz=+3 ",
      "dz=+2 ",
      "dz=+1 ",
      "dz= 0 ",
      "dz=-1 ",
    ]);
    expect(view.match(/@/g)).toHaveLength(1);
    expect(lineFor(view, "dz= 0")).toContain("@");
    for (const row of rows) {
      const cells = row.slice(11).split("   ")[0]?.trim().split(" ");
      expect(cells).toHaveLength(11);
    }
  });

  it("marks trees, vehicles by direction, logs, lily pads and rail", () => {
    const cells = (prefix: string) =>
      lineFor(view, prefix).slice(11).split("   ")[0]?.trim().split(" ");
    expect(cells("dz= 0")).toEqual([".", ".", ".", "T", ".", "@", ".", ".", ".", ".", "."]); // the tree is in column -2
    expect(cells("dz=+1")).toEqual([".", ".", ".", ">", ">", ">", ".", ".", ".", ".", "."]);
    expect(cells("dz=+2")).toEqual(["~", "~", "o", "~", "~", "~", "L", "L", "L", "~", "~"]);
    expect(cells("dz=+3")).toEqual(Array(11).fill("="));
  });

  it("gives the exact numbers next to moving objects, relative to the chicken", () => {
    expect(lineFor(view, "dz=+1")).toContain("vehicle dcol=-1 half=1.25 moving right 5/s");
    expect(lineFor(view, "dz=+2")).toContain("log dcol=+2 half=1.25 moving left 2/s");
    expect(lineFor(view, "dz=+2")).toContain("lily pad dcol=-3 half=0.75 still");
    expect(lineFor(view, "dz=+3")).toContain("warning light off");
  });

  it("marks the cells outside the world when the chicken stands near the edge", () => {
    const edge: Observation = { ...world, player: { ...world.player, col: 4 } };
    const cells = lineFor(renderView(edge, emptyMemory(), { forecast: false }), "dz=-1")
      .slice(11)
      .trim()
      .split(" ");
    expect(cells.slice(-4)).toEqual(["#", "#", "#", "#"]); // columns 6 to 9 are past the edge (|col| > 5)
    expect(cells.slice(0, 7).every((c) => c !== "#")).toBe(true);
  });

  it("has no second map unless asked, and the second map shows only what moves, one hop ahead", () => {
    expect(view).not.toContain("MAP IN");
    const forecast = renderView(world, emptyMemory(), { forecast: true });
    const after = forecast.slice(forecast.indexOf("MAP IN"));
    expect(after).toContain("MAP IN 0.2 s");
    expect(after).not.toContain("dz=-1");
    expect(after).not.toContain("@");
    // the car at column -1 moving right at 5 columns/s is at column 0 a hop later: it covers -1, 0 and 1
    const cars = lineFor(after, "dz=+1").slice(11).trim().split(" ");
    expect(cars.slice(3, 8)).toEqual([".", ">", ">", ">", "."]);
    expect(lineFor(after, "dz=+2")).not.toBe(lineFor(forecast, "dz=+2"));
  });

  it("says nothing about the past when the player has no memory, and tells the story when it does", () => {
    expect(view).toContain("none yet, this is your first move");
    const text = renderView(world, stuck(2), { forecast: false });
    expect(text).toContain("1. hop_forward: moved");
    expect(text).toContain("3. hop_forward: blocked by a tree, did not move");
    expect(text).toContain("Rows crossed so far: 3. Moves since you last reached a new row: 2.");
  });
});

describe("what the encoders may say", () => {
  const game = new Game({ seed: 4 });
  for (let i = 0; i < 5; i++) game.step("hop_forward");
  const obs = observe(game);
  const memory = stuck(3);
  const withMemory = ENCODER_IDS.filter((id) => ENCODER_LEVEL[id] !== "now");

  it("the first four encoders ignore the memory, so their requests (and the cache) never change", () => {
    for (const id of ENCODER_IDS.filter((e) => ENCODER_LEVEL[e] === "now" && e !== "image")) {
      expect(encodeRequest(id, obs, memory)).toEqual(encodeRequest(id, obs));
    }
  });

  it("the memory encoders do use it", () => {
    for (const id of withMemory) {
      expect(JSON.stringify(encodeState(id, obs, memory))).not.toEqual(
        JSON.stringify(encodeState(id, obs)),
      );
    }
  });

  it("never judge a move: no safety, validity or recommendation anywhere in what the model reads", () => {
    for (const id of withMemory) {
      const text = `${JSON.stringify(encodeState(id, obs, memory))} ${choiceInstructions("full", id)}`;
      expect(text, id).not.toMatch(/safe|danger|unsafe|valid|legal|recommend|reachable|collision/i);
      expect(JSON.stringify(encodeState(id, obs, memory)), id).not.toMatch(/\b(dies?|best)\b/i);
    }
  });

  it("describe their own format in the instructions and never advise", () => {
    for (const id of withMemory) {
      const text = choiceInstructions("full", id);
      expect(text, id).not.toMatch(/\b(should|safest|best move|you must|avoid)\b/i);
      expect(text, id).toContain("last moves");
    }
    expect(choiceInstructions("full", "view-fx")).toContain("0.2 seconds from now");
    expect(choiceInstructions("full", "view")).not.toContain("0.2 seconds from now");
  });

  it("json-fx adds the column a hop later and the memory fields to the relative json", () => {
    const state = encodeState("json-fx", obs, memory) as {
      memory: { last_moves: unknown[]; rows_crossed: number; moves_since_new_row: number };
      rows: Array<{ platforms?: Array<{ dcol: number; dcol_after: number }> }>;
    };
    expect(state.memory.last_moves).toHaveLength(4);
    expect(state.memory).toMatchObject({ rows_crossed: 3, moves_since_new_row: 3 });
    const platforms = state.rows.flatMap((r) => r.platforms ?? []);
    expect(platforms.length).toBeGreaterThan(0);
    for (const p of platforms) expect(p.dcol_after).toBeDefined();
  });
});
