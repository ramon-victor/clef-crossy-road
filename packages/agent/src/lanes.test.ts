import { Game, type ObsRow, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward } from "./baselines.ts";
import { ENCODER_LEVEL, encodeRequest } from "./encode.ts";
import {
  ACTION_NAMES,
  CELL_WORDS,
  type Cell,
  canStand,
  cellAt,
  cellWindow,
  hopWindow,
  isPermanent,
  type LanesState,
  lanesState,
  MANEUVER_NAMES,
  movesState,
  placeOf,
} from "./lanes.ts";
import { emptyMemory, remember } from "./memory.ts";
import { readLanes, ruleLanes } from "./rule.ts";
import { playEpisode } from "./runner.ts";

const grass = (blocked: number[] = [], dz = 1): ObsRow => ({
  dz,
  kind: "grass",
  blocked_cols: blocked,
});
const road = (vehicles: { col: number; speed: number }[], dz = 1): ObsRow => ({
  dz,
  kind: "road",
  vehicles: vehicles.map((v) => ({ col: v.col, half_extent: 1, speed_cols_per_s: v.speed })),
});
const water = (
  platforms: { col: number; speed: number; type?: "log" | "lily_pad" }[],
  dz = 1,
): ObsRow => ({
  dz,
  kind: "water",
  platforms: platforms.map((p) => ({
    col: p.col,
    half_extent: 1,
    speed_cols_per_s: p.speed,
    type: p.type ?? "log",
  })),
});
const rail = (trainCol: number, light: "on" | "off", speed = 48, dz = 1): ObsRow => ({
  dz,
  kind: "rail",
  train: { col: trainCol, half_extent: 3, speed_cols_per_s: speed },
  warning_light: light,
});

describe("cellAt: what fills a cell when the hop ends", () => {
  it("names trees, empty ground, the edge of the world and rows nobody can see", () => {
    expect(cellAt(grass([2]), 2, 0.2)).toBe("tree");
    expect(cellAt(grass([2]), 1, 0.2)).toBe("empty");
    expect(cellAt(grass(), 6, 0.2)).toBe("outside_world");
    expect(cellAt(undefined, 0, 0.2)).toBe("unseen");
  });

  it("looks where the platform will be, not where it is", () => {
    // A log at col 3 moving left at 10 cols/s is at col 1 after 0.2 s.
    const row = water([{ col: 3, speed: -10 }]);
    expect(cellAt(row, 1, 0.2)).toBe("log");
    expect(cellAt(row, 3, 0.2)).toBe("water");
    expect(cellAt(water([{ col: 0, speed: 0, type: "lily_pad" }]), 0, 0.2)).toBe("lily_pad");
  });

  it("counts a vehicle that is on the cell at any point from the middle of the hop", () => {
    // Passing the cell before the hop ends: at 0.1 s it is on col 0, at 0.2 s it has left it.
    const passing = road([{ col: -1, speed: 10 }]);
    expect(cellAt(passing, 0, 0.2)).toBe("vehicle");
    expect(cellAt(road([{ col: 5, speed: 0 }]), 0, 0.2)).toBe("empty");
  });

  it("separates the train from the warning light", () => {
    expect(cellAt(rail(100, "off"), 0, 0.2)).toBe("empty");
    expect(cellAt(rail(100, "on"), 0, 0.2)).toBe("train_coming");
    expect(cellAt(rail(0, "off", 0), 0, 0.2)).toBe("train");
  });

  it("can stand on empty, log and lily pad only; a tree and the edge never go away", () => {
    for (const cell of CELL_WORDS) {
      expect(canStand(cell), cell).toBe(cell === "empty" || cell === "log" || cell === "lily_pad");
    }
    expect(isPermanent("tree")).toBe(true);
    expect(isPermanent("outside_world")).toBe(true);
    expect(isPermanent("vehicle")).toBe(false);
  });

  it("places the chicken in the width of the world", () => {
    expect(placeOf(-5)).toBe("at_left_edge");
    expect(placeOf(-3)).toBe("left");
    expect(placeOf(0)).toBe("middle");
    expect(placeOf(2.5)).toBe("right");
    expect(placeOf(4.5)).toBe("at_right_edge");
  });
});

/** Every state a few free players pass through, to test properties of the view over many worlds. */
function* statesOf(seeds: number[], hops = 60): Generator<{ state: LanesState; game: Game }> {
  for (const seed of seeds) {
    const game = new Game({ seed });
    let memory = emptyMemory();
    for (let i = 0; i < hops && game.alive; i++) {
      const state = lanesState(observe(game), memory);
      yield { state, game: game.clone() };
      const action = readLanes(state);
      const { outcome } = game.step(action);
      memory = remember(memory, { action, outcome }, game.score);
    }
  }
}

const cellsOf = (state: LanesState): Cell[] => [
  state.chicken.stays_on,
  state.forward.lands_on,
  state.forward.lands_on_after_stepping_left,
  state.forward.lands_on_after_stepping_right,
  state.sideways.left_lands_on,
  state.sideways.right_lands_on,
  state.backward.lands_on,
];

describe("hopWindow: a hop forward from a column that is not a whole one", () => {
  // Seed 58 of the free reference died three ticks into a hop off a log from column 0.7 that was judged at column 1.
  const row = road([{ col: 0.1, speed: -2.78 }]);

  it("counts a vehicle over the column the chicken leaves, not only the whole column it lands on", () => {
    expect(cellWindow(row, 1, 0.2, 0.3)).toBe("empty");
    expect(hopWindow(row, 0.7, 0.2, 0.3)).toBe("vehicle");
  });

  it("is the plain window on a whole column and within a few hundredths of one", () => {
    expect(hopWindow(row, 1, 0.2, 0.3)).toBe("empty");
    expect(hopWindow(row, 1.02, 0.2, 0.3)).toBe("empty");
  });

  it("does not count the column left for the time the chicken then waits on the whole one", () => {
    const slow = road([{ col: -0.5, speed: 0.3 }]);
    expect(hopWindow(slow, 0.7, 0.2, 1.0, true)).toBe("empty");
  });

  it("looks only where the hop ends for water and trees", () => {
    expect(hopWindow(water([{ col: 1, speed: 0 }]), 0.7, 0.2, 0.3)).toBe("log");
    expect(hopWindow(grass([0]), 0.7, 0.2, 0.3)).toBe("empty");
  });
});

describe("the lanes view", () => {
  const sample = [...statesOf([1, 2, 3, 4, 5, 6, 7, 8])];

  it("only ever uses the words of the vocabulary", () => {
    expect(sample.length).toBeGreaterThan(100);
    for (const { state } of sample) {
      for (const cell of cellsOf(state)) expect(CELL_WORDS).toContain(cell);
    }
  });

  it("has no digits at all: the model is weak at counting and comparing magnitudes", () => {
    for (const { state } of sample) expect(JSON.stringify(state)).not.toMatch(/\d/);
  });

  it("never says what a move would lead to for the chicken (ADR-0009, ADR-0010)", () => {
    const forbidden = /safe|unsafe|danger|deadly|dies|fatal|reachable|valid|legal|can_go|survive/i;
    for (const { state } of sample) expect(JSON.stringify(state)).not.toMatch(forbidden);
  });

  it("is the same world seen twice: a pure function of the observation and the memory", () => {
    const game = new Game({ seed: 4 });
    game.step("hop_forward");
    const obs = observe(game);
    expect(lanesState(obs, emptyMemory())).toEqual(lanesState(obs, emptyMemory()));
    expect(encodeRequest("lanes", obs, emptyMemory()).state).toEqual(lanesState(obs));
  });

  it("matches a hand-checked state: seed 4 after one hop forward", () => {
    const game = new Game({ seed: 4 });
    const { outcome } = game.step("hop_forward");
    const memory = remember(emptyMemory(), { action: "hop_forward", outcome }, game.score);
    expect(lanesState(observe(game), memory)).toEqual({
      chicken: {
        standing_on: "grass",
        on_a_platform: false,
        carried_towards: "no",
        place_in_world: "middle",
        stays_on: "empty",
      },
      forward: {
        row: "water",
        things_move: "no",
        lands_on: "water",
        lands_on_after_stepping_left: "water",
        lands_on_after_stepping_right: "lily_pad",
      },
      sideways: { left_lands_on: "tree", right_lands_on: "tree" },
      backward: { row: "grass", lands_on: "empty" },
      rows_further_ahead: ["water", "road", "grass"],
      memory: {
        last_moves: ["hop_forward: moved"],
        blocked_last_two: false,
        no_new_row_for_a_while: false,
      },
    });
  });

  it("agrees with the simulator about the cell a hop lands on (water, grass and road)", () => {
    const tally = new Map<string, { n: number; agree: number }>();
    for (const { state, game } of sample) {
      const checks = [
        ["hop_forward", state.forward.lands_on, state.forward.row],
        ["hop_left", state.sideways.left_lands_on, state.chicken.standing_on],
        ["hop_right", state.sideways.right_lands_on, state.chicken.standing_on],
        ["hop_back", state.backward.lands_on, state.backward.row],
      ] as const;
      for (const [action, cell, row] of checks) {
        if (row === "rail") continue; // a warning light is a conservative word: the train comes later
        const probe = game.clone();
        const { outcome } = probe.step(action);
        const survives = probe.alive && outcome !== "blocked";
        const entry = tally.get(row) ?? { n: 0, agree: 0 };
        entry.n++;
        if (canStand(cell) === survives) entry.agree++;
        tally.set(row, entry);
      }
    }
    for (const [row, { n, agree }] of tally) {
      expect(agree / n, `${row}: ${agree}/${n}`).toBeGreaterThan(0.97);
    }
  });

  it("is a new level of knowledge, not more of it: its level is `words`", () => {
    expect(ENCODER_LEVEL.lanes).toBe("words");
  });
});

describe("readLanes and rule-lanes: the words are enough to play with", () => {
  it("hops forward when the cell ahead can be stood on", () => {
    const game = new Game({ seed: 1 });
    expect(readLanes(lanesState(observe(game)))).toBe("hop_forward");
  });

  it("steps to the side from which the way ahead is open, and waits when nothing is", () => {
    const base = lanesState(observe(new Game({ seed: 1 })));
    const blocked: LanesState = {
      ...base,
      forward: { ...base.forward, lands_on: "water", lands_on_after_stepping_left: "empty" },
      sideways: { left_lands_on: "empty", right_lands_on: "tree" },
    };
    expect(readLanes(blocked)).toBe("hop_left");
    expect(
      readLanes({
        ...blocked,
        forward: { ...blocked.forward, lands_on_after_stepping_left: "water" },
      }),
    ).toBe("stay");
  });

  it("leaves a spot it cannot stay on, and takes the side away from the nearer edge", () => {
    const base = lanesState(observe(new Game({ seed: 1 })));
    const both: LanesState = {
      ...base,
      chicken: { ...base.chicken, place_in_world: "left" },
      forward: {
        ...base.forward,
        lands_on: "tree",
        lands_on_after_stepping_left: "empty",
        lands_on_after_stepping_right: "empty",
      },
      sideways: { left_lands_on: "empty", right_lands_on: "empty" },
    };
    expect(readLanes(both)).toBe("hop_right");
    expect(readLanes({ ...both, chicken: { ...both.chicken, place_in_world: "right" } })).toBe(
      "hop_left",
    );
    const trapped: LanesState = {
      ...both,
      chicken: { ...both.chicken, stays_on: "vehicle" },
      forward: {
        ...both.forward,
        lands_on_after_stepping_left: "water",
        lands_on_after_stepping_right: "water",
      },
      sideways: { left_lands_on: "tree", right_lands_on: "tree" },
    };
    expect(readLanes(trapped)).toBe("hop_back");
  });

  it("plays far better than always forward, which is what tells us the words carry the information", async () => {
    let words = 0;
    let forward = 0;
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const seed of seeds) {
      words += (await playEpisode(ruleLanes, seed)).score;
      forward += (await playEpisode(alwaysForward, seed)).score;
    }
    expect(words / seeds.length).toBeGreaterThan(2 * (forward / seeds.length));
  });
});

describe("the moves view: the same words under the name of each move", () => {
  const sample = [...statesOf([1, 2, 3, 4, 5, 6])];

  it("regroups the cells of the lanes view without adding or losing any", () => {
    for (const { state } of sample) {
      const moves = movesState(state, ACTION_NAMES) as Record<string, Record<string, unknown>>;
      expect(moves.hop_forward).toEqual({ lands_on: state.forward.lands_on });
      expect(moves.hop_left).toEqual({
        lands_on: state.sideways.left_lands_on,
        then_hop_forward_lands_on: state.forward.lands_on_after_stepping_left,
      });
      expect(moves.hop_right).toEqual({
        lands_on: state.sideways.right_lands_on,
        then_hop_forward_lands_on: state.forward.lands_on_after_stepping_right,
      });
      expect(moves.hop_back).toEqual({ lands_on: state.backward.lands_on });
      expect(moves.stay).toEqual({ stands_on: state.chicken.stays_on });
    }
  });

  it("leaves out the name of the row: the word water beside a platform pulled the model to no", () => {
    for (const { state } of sample) {
      const text = JSON.stringify(movesState(state, ACTION_NAMES));
      expect(text).not.toContain('"row"');
      expect(text).not.toContain("things_move");
    }
  });

  it("names the moves after the manoeuvres when a controller does the hopping, and then says which way things move", () => {
    const { state } = sample[0] as { state: LanesState };
    const moves = movesState(state, MANEUVER_NAMES, { movement: true }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(moves).sort()).toEqual(
      [
        "back_off",
        "chicken",
        "cross_ahead",
        "memory",
        "sidestep_left",
        "sidestep_right",
        "wait_here",
      ].sort(),
    );
    expect(moves.cross_ahead).toHaveProperty("things_move");
    expect(moves.sidestep_left).toHaveProperty("then_cross_ahead_lands_on");
  });

  it("has no digits and no word of judgement", () => {
    for (const { state } of sample) {
      const text = JSON.stringify(movesState(state, ACTION_NAMES));
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/safe|danger|deadly|dies|fatal|reachable|valid|legal|survive/i);
    }
  });

  it("looks two steps ahead for what is under a chicken that stays, because a vehicle that arrives right after still hits it", () => {
    // A vehicle 1.4 columns from the chicken's column, closing at 5 columns per second: it covers the column
    // at 0.3 s, not at 0.2 s.
    const row: ObsRow = {
      dz: 0,
      kind: "road",
      vehicles: [{ col: 2.6, half_extent: 1, speed_cols_per_s: -5 }],
    };
    const obs = {
      player: { col: 0, standing_on: "road" as const, riding: false, hop_ticks_left: 0 },
      rows: [row],
    };
    expect(cellAt(row, 0, 0.2)).toBe("empty");
    expect(lanesState(obs).chicken.stays_on).toBe("vehicle");
  });

  it("encodes through the encoder table", () => {
    const game = new Game({ seed: 3 });
    game.step("hop_forward");
    const obs = observe(game);
    expect(encodeRequest("moves", obs, emptyMemory()).state).toEqual(
      movesState(lanesState(obs, emptyMemory()), ACTION_NAMES),
    );
    expect(ENCODER_LEVEL.moves).toBe("words");
  });
});
