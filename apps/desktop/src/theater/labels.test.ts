import {
  AROUND_OPTIONS,
  CELL_OPTIONS,
  clefPolicy,
  DEFAULT_CLEF,
  MOVING_OPTIONS,
  RIDE_OPTIONS,
  RIDE_QUESTION_ID,
  ROUTE_QUESTION_IDS,
} from "@ccr/agent";
import { ClefClient, MemoryCache, type Transport } from "@ccr/clef";
import { Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import {
  decisionLabel,
  MANEUVER_LABELS,
  optionLabel,
  orderOptions,
  ROUTE_LABELS,
  readPath,
  sceneOf,
  spoken,
  titleOf,
} from "./labels.ts";

/** The state a real game puts in the request, built without sending anything. */
function sentState(seed: number): unknown {
  const transport: Transport = {
    async post() {
      throw new Error("nothing is sent");
    },
  };
  const client = new ClefClient({ transport, cache: new MemoryCache(), sleep: async () => {} });
  const policy = clefPolicy(client, DEFAULT_CLEF).create(seed);
  if (policy.kind !== "observation" || !policy.describe) throw new Error("expected describe()");
  return policy.describe(observe(new Game({ seed }))).state;
}

describe("the labels of the route lookups", () => {
  const options = {
    cell: CELL_OPTIONS,
    moving: MOVING_OPTIONS,
    around: AROUND_OPTIONS,
    ride: RIDE_OPTIONS,
  } as const;

  it("name every question and every option the strategy sends, so a new one cannot go unlabelled", () => {
    expect(Object.keys(ROUTE_LABELS).sort()).toEqual(
      [...ROUTE_QUESTION_IDS, RIDE_QUESTION_ID].sort(),
    );
    for (const id of [...ROUTE_QUESTION_IDS, RIDE_QUESTION_ID] as const) {
      expect(Object.keys(ROUTE_LABELS[id]?.options ?? {}), id).toEqual([...options[id]]);
    }
  });

  it("give every option a short word for the caption, different within a question", () => {
    for (const question of Object.values(ROUTE_LABELS)) {
      const shorts = Object.values(question.options).map((o) => o.short);
      expect(new Set(shorts).size).toBe(shorts.length);
      for (const o of Object.values(question.options))
        expect(o.short.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("sceneOf: the screen in a sentence", () => {
  it("reads the state a real game sends", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const scene = sceneOf(sentState(seed));
      expect(scene, `seed ${seed}`).not.toBeNull();
      expect(scene?.phrase.length).toBeGreaterThan(0);
      expect(scene?.gaps).toHaveLength(2);
      expect(scene?.tile).toMatch(/^(grass|tree|water|log|lily|car|train|edge)$/);
    }
  });

  it("says what lies ahead, whether it moves, and how far the openings are", () => {
    const at = (lands: string, move: string) => ({
      cross_ahead: { lands_on: lands, things_move: move },
      detour_left: { opening_ahead: "two_away" },
      detour_right: { opening_ahead: "adjacent" },
    });
    expect(sceneOf(at("water", "still"))).toEqual({
      tile: "water",
      phrase: "Water, standing still",
      gaps: ["left: 2 away", "right: next to it"],
      platform: null,
    });
    expect(sceneOf(at("vehicle", "left"))?.phrase).toBe("A vehicle, moving left");
    expect(sceneOf(at("tree", "still"))?.phrase).toBe("A tree in the way");
    expect(sceneOf(at("empty", "still"))?.phrase).toBe("Open ground");
    expect(sceneOf(at("empty", "right"))?.phrase).toBe("Open ground, things moving right");
    expect(sceneOf(at("train_coming", "still"))?.tile).toBe("train");
  });

  it("tells what the model was told of the platform under the chicken, and nothing off one", () => {
    const on = (word: string, towards: string) => ({
      cross_ahead: { lands_on: "water", things_move: "left" },
      chicken: { edge_in: word, carried_towards: towards },
    });
    expect(sceneOf(on("a_moment", "left"))?.platform).toEqual({
      phrase: "On a platform carried left: the edge of the world is a moment away",
      urgency: "now",
    });
    expect(sceneOf(on("soon", "right"))?.platform?.urgency).toBe("soon");
    expect(sceneOf(on("later", "right"))?.platform?.urgency).toBe("later");
    expect(sceneOf(on("not_carried", "no"))?.platform).toEqual({
      phrase: "On a platform: it is not taking the chicken to the edge",
      urgency: "none",
    });
    expect(sceneOf({ cross_ahead: { lands_on: "empty" }, chicken: {} })?.platform).toBeNull();
  });

  it("has no sentence for a state that is not the scene view's", () => {
    expect(sceneOf({ rows: [] })).toBeNull();
    expect(sceneOf("a text map")).toBeNull();
    expect(sceneOf(null)).toBeNull();
  });
});

describe("labelling anything else", () => {
  it("uses the five moves' own words, the manoeuvres', or the bare id", () => {
    expect(optionLabel("move", "hop_forward")).toEqual({
      glyph: "↑",
      label: "Forward",
      short: "Forward",
    });
    expect(optionLabel("move", "stay")).toEqual({ glyph: "•", label: "Wait", short: "Wait" });
    expect(optionLabel("move", "back_off")).toBe(MANEUVER_LABELS.back_off);
    expect(optionLabel("go", "hold_on")).toEqual({ glyph: "", label: "Hold on", short: "Hold on" });
  });

  it("names what a decision comes to: the manoeuvre if there was one, else the move", () => {
    expect(decisionLabel("detour_right", "hop_back")).toBe(MANEUVER_LABELS.detour_right);
    expect(decisionLabel(undefined, "hop_left")).toMatchObject({ glyph: "←", label: "Left" });
    // Getting off a platform is drawn as the hop that gets the chicken off it.
    expect(decisionLabel("leave_platform", "hop_forward")).toEqual({
      glyph: "↑",
      label: "Get off the platform",
      short: "Get off",
    });
    expect(decisionLabel("leave_platform", "hop_back").glyph).toBe("↓");
    expect(decisionLabel("unknown_one", "stay")).toMatchObject({ glyph: "•", label: "Wait" });
  });

  it("makes a title out of an id it does not know", () => {
    expect(titleOf("cell")).toBe("Can it stand there?");
    expect(titleOf("hop_side")).toBe("Hop side");
  });

  it("keeps the order it was given when it cannot rank every option", () => {
    expect(orderOptions("side", ["stay", "weird", "hop_left"])).toEqual([
      "stay",
      "weird",
      "hop_left",
    ]);
    expect(orderOptions("move", ["stay", "hop_forward", "hop_back"])).toEqual([
      "hop_forward",
      "stay",
      "hop_back",
    ]);
    expect(orderOptions("cell", ["no_stand", "stand"])).toEqual(["stand", "no_stand"]);
  });

  it("reads a dotted path and says words the way a person would", () => {
    const state = { a: { b: "two_away", n: 3, flag: false, deep: { x: {} } } };
    expect(readPath(state, "a.b")).toBe("two_away");
    expect(readPath(state, "a.n")).toBe("3");
    expect(readPath(state, "a.flag")).toBe("false");
    expect(readPath(state, "a.deep.x")).toBeUndefined();
    expect(readPath(state, "a.missing.y")).toBeUndefined();
    expect(readPath("text", "a")).toBeUndefined();
    expect(spoken("three_or_more")).toBe("three or more");
  });
});
