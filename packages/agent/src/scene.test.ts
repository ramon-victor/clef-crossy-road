import { Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { ENCODER_LEVEL, encodeRequest } from "./encode.ts";
import { emptyMemory, remember } from "./memory.ts";
import { boxedIn, grass, scene, water, world } from "./route.testing.ts";
import { routeChoice } from "./route.ts";
import { openingAhead, ownRowThatWay, sceneState } from "./scene.ts";

describe("the scene view: where the openings are, in words", () => {
  it("says how far to each side the nearest opening of the row ahead is", () => {
    expect(openingAhead(boxedIn(), "right")).toBe("two_away");
    expect(openingAhead(boxedIn(), "left")).toBe("none");
    const near = world([grass([], 0), water([{ col: 1 }, { col: -3 }], 1)]);
    expect(openingAhead(near, "right")).toBe("adjacent");
    expect(openingAhead(near, "left")).toBe("three_or_more");
  });

  it("says how much of its own row it can step along", () => {
    expect(ownRowThatWay(boxedIn(), "right")).toBe("blocked_at_once");
    const free = world([grass([], 0), grass([], 1)]);
    expect(ownRowThatWay(free, "left")).toBe("free_for_two_or_more");
    const oneThenTree = world([grass([-2], 0), grass([], 1)]);
    expect(ownRowThatWay(oneThenTree, "left")).toBe("free_for_one");
  });

  it("has a closed vocabulary, no digits, and never says what the chicken should do", () => {
    const forbidden = /safe|danger|deadly|dies|fatal|reachable|valid|legal|survive|should|best/i;
    for (let seed = 1; seed <= 6; seed++) {
      const game = new Game({ seed });
      let memory = emptyMemory();
      for (let i = 0; i < 40 && game.alive; i++) {
        const state = scene(observe(game), memory);
        const text = JSON.stringify(state);
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(forbidden);
        const action = routeChoice(state) === "cross_ahead" ? "hop_forward" : "hop_left";
        const { outcome } = game.step(action);
        memory = remember(memory, { action, outcome }, game.score, game.heroRow);
      }
    }
  });

  it("matches a hand-checked state: seed 4 after one hop forward", () => {
    const game = new Game({ seed: 4 });
    const { outcome } = game.step("hop_forward");
    const memory = remember(
      emptyMemory(),
      { action: "hop_forward", outcome },
      game.score,
      game.heroRow,
    );
    expect(scene(observe(game), memory)).toEqual({
      cross_ahead: { lands_on: "water", things_move: "still" },
      detour_left: {
        opening_ahead: "two_away",
        own_row_that_way: "blocked_at_once",
        recently_failed: "no",
      },
      detour_right: {
        opening_ahead: "adjacent",
        own_row_that_way: "blocked_at_once",
        recently_failed: "no",
      },
      wait_here: { stands_on: "empty" },
      chicken: { place_in_world: "middle", carried_towards: "no", behind_frontier: "no" },
      memory: {
        last_moves: ["hop_forward: moved"],
        blocked_last_two: false,
        no_new_row_for_a_while: false,
      },
    });
  });

  it("says when the chicken stands behind the furthest row it reached, and when a side was tried and given back", () => {
    const behind = { ...emptyMemory(), score: 5, behindFrontier: 1 };
    expect(scene(boxedIn(), behind).chicken.behind_frontier).toBe("one");
    expect(scene(boxedIn(), { ...behind, behindFrontier: 3 }).chicken.behind_frontier).toBe(
      "two_or_more",
    );
    const failed = sceneState(boxedIn(), emptyMemory(), { failed: { left: true, right: false } });
    expect(failed.detour_left.recently_failed).toBe("yes");
    expect(failed.detour_right.recently_failed).toBe("no");
  });

  it.each([
    ["a_moment", 3, 3],
    ["soon", 2, 1.5],
    ["later", 0, 1],
    ["not_carried", 0, 0],
  ] as const)(
    "says the edge is %s for a log at column %s moving at %s columns per second",
    (word, col, speed) => {
      const log = world(
        [grass([], -1), water([{ col, speed, type: "log", half: 2.2 }], 0)],
        col,
        true,
      );
      expect(scene(log).chicken.edge_in).toBe(word);
    },
  );

  it("says nothing of the edge off a platform, and still uses no digits on one", () => {
    expect(scene(boxedIn()).chicken).not.toHaveProperty("edge_in");
    const log = world(
      [grass([], -1), water([{ col: 3, speed: 3, type: "log", half: 2.2 }], 0)],
      3,
      true,
    );
    expect(JSON.stringify(scene(log))).not.toMatch(/\d/);
  });

  it("is a new level of knowledge, not more of it: its level is `words`", () => {
    expect(ENCODER_LEVEL.scene).toBe("words");
    expect(encodeRequest("scene", boxedIn(), emptyMemory()).state).toEqual(scene(boxedIn()));
  });
});
