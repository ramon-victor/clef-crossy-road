import type { Observation, ObsRow } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward } from "./baselines.ts";
import { emptyMemory } from "./memory.ts";
import { driftingOff } from "./platform.ts";
import { boxedIn, grass, road, scene, water, world } from "./route.testing.ts";
import {
  execRoute,
  MAX_CROSS_WAIT,
  MAX_DETOUR_STEPS,
  MAX_LEAVE_STEPS,
  RETRY_AFTER,
  ROUTE_IDS,
  RouteExecutor,
  routeChoice,
  searchEscape,
  searchExit,
  searchRoute,
} from "./route.ts";
import { playEpisode } from "./runner.ts";
import { type SceneState, sceneState } from "./scene.ts";

describe("searchRoute: the way round, over the words alone", () => {
  it("goes back, along the row behind, and forward twice, when trees box the chicken in", () => {
    const route = searchRoute(boxedIn(), { goalDz: 1, side: "right", col0: 0 });
    expect(route?.path).toEqual([
      "hop_back",
      "hop_right",
      "hop_right",
      "hop_forward",
      "hop_forward",
    ]);
    expect(route?.first).toBe("hop_back");
    expect(route?.preview).toEqual({
      col: 0,
      steps: [
        { action: "hop_back", col: 0, dz: -1 },
        { action: "hop_right", col: 1, dz: -1 },
        { action: "hop_right", col: 2, dz: -1 },
        { action: "hop_forward", col: 2, dz: 0 },
        { action: "hop_forward", col: 2, dz: 1 },
      ],
    });
  });

  it("walks a long way to a lily pad, further than the first eight hops", () => {
    const farPad = world([grass([], -1), grass([], 0), water([{ col: 4 }], 1)], -4);
    const request = { goalDz: 1, side: "right", col0: -4 } as const;
    expect(searchRoute(farPad, { ...request, depth: 8 })).toBeNull();
    const route = searchRoute(farPad, request);
    expect(route?.path).toHaveLength(9);
    expect(route?.path.at(-1)).toBe("hop_forward");
  });

  it("keeps to the side it was asked for: a way that arrives on the other and walks back is not that detour", () => {
    expect(searchRoute(boxedIn(), { goalDz: 1, side: "left", col0: 0 })).toBeNull();
  });

  it("aims at the row beyond the furthest one reached, not the one ahead of where it stands", () => {
    // One row behind the front the goal is two rows ahead of the chicken.
    const rows = [grass([], -1), grass([], 0), grass([], 1), water([{ col: 1 }], 2)];
    const route = searchRoute(world(rows), { goalDz: 2, side: "right", col0: 0 });
    expect(route?.path.at(-1)).toBe("hop_forward");
    expect(route?.path.length).toBeGreaterThanOrEqual(3);
  });

  it("will not stand on a log that carries it past the edge", () => {
    const rows = [
      grass([], -1),
      water([{ col: 3, speed: 3, type: "log", half: 1.5 }], 0),
      grass([], 1),
    ];
    const obs = world(rows, 3, true);
    expect(driftingOff(obs)).toBe("right");
    const away = searchEscape(obs);
    expect(away?.first).toBe("hop_forward");
  });
});

describe("searchExit: the way off a platform that carries the chicken to the edge", () => {
  const drifting = (rowsAhead: ObsRow[], half = 1.6): Observation =>
    world(
      [grass([], -1), water([{ col: 3, speed: 3, type: "log", half }], 0), ...rowsAhead],
      3,
      true,
    );

  it("goes on to the row ahead when it can be stood on", () => {
    expect(searchExit(drifting([grass([], 1)]))?.first).toBe("hop_forward");
  });

  it("goes on rather than back, even when going back is a shorter way", () => {
    // Forward is two hops away (a step along the log, then onto the still log ahead); back is one hop onto the bank.
    const ahead = water([{ col: 2, type: "log", half: 0.4 }], 1);
    const route = searchExit(drifting([ahead], 2.2));
    expect(route?.path).toEqual(["hop_left", "hop_forward"]);
  });

  it("goes back to the bank when there is no way on", () => {
    expect(searchExit(drifting([water([], 1)]))?.first).toBe("hop_back");
  });

  it("finds no way when nothing is standable round the platform", () => {
    const alone = world([water([{ col: 4.2, speed: 3, type: "log", half: 1.5 }], 0)], 4.2, true);
    expect(searchExit(alone)).toBeNull();
  });
});

describe("RouteExecutor: leave_platform", () => {
  const carried = (): Observation =>
    world(
      [grass([], -1), water([{ col: 3, speed: 3, type: "log", half: 1.6 }], 0), grass([], 1)],
      3,
      true,
    );

  it("hops off the platform, numbers the hops, and reports them as a leave", () => {
    const executor = new RouteExecutor();
    const act = executor.start("leave_platform", carried(), emptyMemory());
    expect(act.action).toBe("hop_forward");
    expect(act.step).toEqual({ kind: "leave", n: 1, left: 1 });
    expect(act.note).toContain("leave_platform: hop 1, forward");
  });

  it("is over once the chicken is no longer carried to the edge", () => {
    const executor = new RouteExecutor();
    executor.start("leave_platform", carried(), emptyMemory());
    const onGrass = world([grass([], 0), grass([], 1)], 3);
    expect(executor.next(onGrass, emptyMemory())).toBeNull();
    expect(executor.lastResult).toBe("leave_platform: off the platform's way after 1 hop(s)");
  });

  it.each([
    [
      "the platform is not carrying it to the edge",
      world([grass([], -1), water([{ col: 0, speed: 0.5, type: "log", half: 2 }], 0)], 0, true),
      /^leave_platform: refused, the chicken is not being carried/,
    ],
    [
      "there is no way off",
      world([water([{ col: 4.2, speed: 3, type: "log", half: 1.5 }], 0)], 4.2, true),
      /^leave_platform: refused, no way off within 8 hops/,
    ],
  ])("is refused, and the chicken holds, when %s", (_why, obs, refusal) => {
    const executor = new RouteExecutor();
    const act = executor.start("leave_platform", obs, emptyMemory());
    expect(executor.lastResult).toMatch(refusal);
    expect(act.step).toMatchObject({ kind: "hold" });
  });

  it("gives the decision back after too many hops", () => {
    const executor = new RouteExecutor();
    const stuck = carried();
    executor.start("leave_platform", stuck, emptyMemory());
    const steps = Array.from({ length: MAX_LEAVE_STEPS }, () =>
      executor.next(stuck, emptyMemory()),
    );
    expect(steps.at(-1)).toBeNull();
    expect(executor.lastResult).toMatch(/more than 8 hops and still carried/);
  });
});

describe("RouteExecutor: what each step is, without reading its sentence", () => {
  it("calls the crossing a hop when the cell is clear", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), grass([], 1)]);
    expect(executor.start("cross_ahead", obs, emptyMemory()).step).toEqual({ kind: "hop" });
  });

  it("counts the steps spent waiting for a gap, and says what is in the way", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), water([{ col: 4, speed: -1, type: "log" }], 1)]);
    const first = executor.start("cross_ahead", obs, emptyMemory());
    expect(first.step).toEqual({
      kind: "wait",
      n: 1,
      of: MAX_CROSS_WAIT,
      cell: "water",
      why: "gap",
    });
    const second = executor.next(obs, emptyMemory());
    expect(second?.step).toEqual({
      kind: "wait",
      n: 2,
      of: MAX_CROSS_WAIT,
      cell: "water",
      why: "gap",
    });
  });

  it("calls a refused crossing a hold, however the chicken holds", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), grass([0], 1)]);
    const act = executor.start("cross_ahead", obs, emptyMemory());
    expect(act.action).toBe("stay");
    expect(act.step).toEqual({ kind: "hold", why: "refused" });
    expect(act.refused).toBe(true);
    const waiting = executor.start("wait_here", obs, emptyMemory());
    expect(waiting.step).toEqual({ kind: "hold", why: "refused" });
    expect(waiting.refused).toBeUndefined();
  });

  it("names the vehicle or the train that would reach a cell that is clear for the hop, and says it is not the cell that blocks", () => {
    const executor = new RouteExecutor();
    // The cell ahead is clear for the hop, but a vehicle reaches it half a second later and water follows.
    const roadAhead = world([grass([], 0), road([{ col: 2.6, speed: -3 }], 1), water([], 2)]);
    expect(executor.start("cross_ahead", roadAhead, emptyMemory()).step).toEqual({
      kind: "wait",
      n: 1,
      of: MAX_CROSS_WAIT,
      cell: "vehicle",
      why: "no_rest",
    });
    const railAhead = world([
      grass([], 0),
      {
        dz: 1,
        kind: "rail",
        warning_light: "off",
        train: { col: 3, half_extent: 1.5, speed_cols_per_s: -3 },
      },
      water([], 2),
    ]);
    expect(new RouteExecutor().start("cross_ahead", railAhead, emptyMemory()).step).toMatchObject({
      kind: "wait",
      cell: "train",
      why: "no_rest",
    });
  });

  it("says why a refused manoeuvre holds: a cell it cannot stay on, a platform to the edge, or nowhere to step", () => {
    const vehicle = world([grass([], -1), road([{ col: 2.5, speed: -6 }], 0), grass([0], 1)]);
    expect(new RouteExecutor().start("cross_ahead", vehicle, emptyMemory()).step).toEqual({
      kind: "hold",
      why: "unsafe_here",
    });
    const log = world(
      [grass([], -1), water([{ col: 3, speed: 3, type: "log", half: 1.6 }], 0), water([], 1)],
      3,
      true,
    );
    expect(new RouteExecutor().start("wait_here", log, emptyMemory()).step).toMatchObject({
      kind: "hold",
      why: "edge",
    });
    const alone = world([water([{ col: 4.2, speed: 3, type: "log", half: 1.5 }], 0)], 4.2, true);
    expect(new RouteExecutor().start("wait_here", alone, emptyMemory()).step).toEqual({
      kind: "hold",
      why: "no_way",
    });
  });

  it("numbers the hops of a detour and says how many are left", () => {
    const executor = new RouteExecutor();
    const memory = emptyMemory();
    const first = executor.start("detour_right", boxedIn(), memory);
    expect(first.step).toMatchObject({ kind: "walk", n: 1 });
    const second = executor.next(boxedIn(), memory);
    expect(second?.step).toMatchObject({ kind: "walk", n: 2 });
    const step = second?.step;
    expect(step?.kind === "walk" && step.left >= 0).toBe(true);
  });
});

describe("RouteExecutor: the manoeuvre in progress", () => {
  it("crosses as soon as the cell ahead can be stood on, and says so", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), grass([], 1)]);
    const act = executor.start("cross_ahead", obs, emptyMemory());
    expect(act.action).toBe("hop_forward");
    expect(executor.lastResult).toBe("cross_ahead: hopped");
    expect(executor.next(obs, emptyMemory())).toBeNull();
  });

  it("waits for a gap in passing logs, a step at a time, and gives the decision back after three seconds", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), water([{ col: 4, speed: -1, type: "log" }], 1)]);
    expect(executor.start("cross_ahead", obs, emptyMemory()).note).toContain(
      "waiting for the cell",
    );
    let steps = 0;
    while (executor.next(obs, emptyMemory())) steps++;
    expect(steps).toBe(14);
    expect(executor.lastResult).toMatch(
      /^cross_ahead: given back, the cell \(water\) did not clear in 15 steps/,
    );
  });

  it("refuses a crossing into a tree, and holds a step where it is safe", () => {
    const executor = new RouteExecutor();
    const obs = world([grass([], 0), grass([0], 1)]);
    const act = executor.start("cross_ahead", obs, emptyMemory());
    expect(act.action).toBe("stay");
    expect(executor.lastResult).toBe("cross_ahead: refused, tree does not go away");
  });

  it("walks a detour hop by hop, finishes when a new row is reached, and tells the model how it went", () => {
    const executor = new RouteExecutor();
    const memory = emptyMemory();
    const first = executor.start("detour_right", boxedIn(), memory);
    expect(first.action).toBe("hop_back");
    expect(executor.next(boxedIn(), memory)?.note).toContain("detour_right: hop 2");
    const reached = { ...memory, score: memory.score + 1 };
    expect(executor.next(boxedIn(), reached)).toBeNull();
    expect(executor.lastResult).toMatch(/^detour_right: reached a new row after 2 hop/);
    expect(executor.failedSides(reached)).toEqual({ left: false, right: false });
  });

  it("gives a detour with no way back, marks that side as tried, and forgets it at the next new row", () => {
    const executor = new RouteExecutor();
    const memory = emptyMemory();
    const act = executor.start("detour_left", boxedIn(), memory);
    expect(["stay", "hop_back", "hop_forward", "hop_left", "hop_right"]).toContain(act.action);
    expect(executor.lastResult).toMatch(/^detour_left: refused, no way to an opening on the left/);
    expect(executor.failedSides(memory).left).toBe(true);
    expect(
      sceneState(boxedIn(), memory, { failed: executor.failedSides(memory) }).detour_left
        .recently_failed,
    ).toBe("yes");
    expect(executor.failedSides({ ...memory, score: 1 }).left).toBe(false);
  });

  it("forgets a side that failed after a few decisions, and not before", () => {
    const executor = new RouteExecutor();
    const failedAt = { ...emptyMemory(), sinceProgress: 3 };
    executor.start("detour_left", boxedIn(), failedAt);
    const later = (decisions: number) => ({
      ...failedAt,
      sinceProgress: failedAt.sinceProgress + decisions,
    });
    expect(executor.failedSides(later(RETRY_AFTER - 1)).left).toBe(true);
    expect(executor.failedSides(later(RETRY_AFTER)).left).toBe(false);
    expect(executor.failedSides(later(RETRY_AFTER)).right).toBe(false);
    expect(executor.failedSides({ ...failedAt, sinceProgress: 0 }).left).toBe(false);
  });

  it("refuses at once a crossing into water that nothing on its row will ever cover, and still waits where logs pass", () => {
    const refusals = [water([{ col: 3 }], 1), water([], 1)].map((row) => {
      const executor = new RouteExecutor();
      const act = executor.start("cross_ahead", world([grass([], 0), row]), emptyMemory());
      return [act.refused, executor.lastResult, act.step.kind] as const;
    });
    for (const [refused, result, kind] of refusals) {
      expect(refused).toBe(true);
      expect(result).toBe("cross_ahead: refused, nothing moves on that row, the water stays");
      expect(kind).toBe("hold");
    }
    const logs = world([grass([], 0), water([{ col: 4, speed: -1, type: "log" }], 1)]);
    const waiting = new RouteExecutor().start("cross_ahead", logs, emptyMemory());
    expect(waiting.refused).toBeUndefined();
    expect(waiting.step.kind).toBe("wait");
  });

  it("gives a detour back after too many hops", () => {
    const executor = new RouteExecutor();
    const memory = emptyMemory();
    executor.start("detour_right", boxedIn(), memory);
    for (let i = 0; i < MAX_DETOUR_STEPS + 2 && executor.next(boxedIn(), memory); i++) {
      // keep asking: the world does not change here, so the route never ends
    }
    expect(executor.lastResult).toMatch(
      new RegExp(`more than ${MAX_DETOUR_STEPS} hops and no new row`),
    );
  });

  it("steps off a cell a vehicle is about to cover instead of waiting on it when a manoeuvre is refused", () => {
    const executor = new RouteExecutor();
    // A vehicle arriving on the chicken's own road row at 0.3 s, and a tree ahead so crossing is refused.
    const obs = world([grass([], -1), road([{ col: 2.5, speed: -6 }], 0), grass([0], 1)]);
    const act = executor.start("cross_ahead", obs, emptyMemory());
    expect(act.action).not.toBe("stay");
    expect(act.note).toContain("stepping off a cell it cannot stay on");
  });

  it("does not wait on a platform that carries it past the edge: it gives the crossing back and steps off", () => {
    const executor = new RouteExecutor();
    const rows = [
      grass([], -1),
      water([{ col: 3, speed: 3, type: "log", half: 1.6 }], 0),
      water([], 1),
    ];
    const act = executor.start("cross_ahead", world(rows, 3, true), emptyMemory());
    expect(executor.lastResult).toContain("past the edge of the world");
    expect(act.action).not.toBe("stay");
  });

  it("makes a crossing from a platform wait for a vehicle that only covers the column it leaves", () => {
    const executor = new RouteExecutor();
    const rows = [
      water([{ col: 0.7, speed: 1, type: "log", half: 2 }], 0),
      road([{ col: 0.1, speed: -2.78 }], 1),
      grass([], 2),
    ];
    const act = executor.start("cross_ahead", world(rows, 0.7, true), emptyMemory());
    expect(act.action).toBe("stay");
    expect(act.step).toMatchObject({ kind: "wait", cell: "vehicle" });
    expect(act.preview?.conditional).toBe(true);
    expect(act.preview?.steps[0]?.col).toBeCloseTo(0.9);
    expect(act.preview?.steps[1]).toEqual({ action: "hop_forward", col: 1, dz: 1 });
  });
});

describe("routeChoice: the lookups the options describe", () => {
  const base = (): SceneState => scene(boxedIn());
  const with_ = (patch: Partial<SceneState>): SceneState => ({ ...base(), ...patch });

  it("crosses when the cell ahead can be stood on, or when things keep passing", () => {
    expect(
      routeChoice(with_({ cross_ahead: { lands_on: "lily_pad", things_move: "still" } })),
    ).toBe("cross_ahead");
    expect(routeChoice(with_({ cross_ahead: { lands_on: "water", things_move: "left" } }))).toBe(
      "cross_ahead",
    );
    expect(
      routeChoice(with_({ cross_ahead: { lands_on: "train_coming", things_move: "left" } })),
    ).toBe("cross_ahead");
  });

  it("goes round by the nearer side, and by the one away from the nearer edge when they are as near", () => {
    expect(routeChoice(base())).toBe("detour_right"); // right adjacent... here two_away vs none
    const equal = (place: SceneState["chicken"]["place_in_world"]): SceneState => ({
      ...base(),
      detour_left: {
        opening_ahead: "adjacent",
        own_row_that_way: "free_for_one",
        recently_failed: "no",
      },
      detour_right: {
        opening_ahead: "adjacent",
        own_row_that_way: "free_for_one",
        recently_failed: "no",
      },
      chicken: { ...base().chicken, place_in_world: place },
    });
    expect(routeChoice(equal("middle"))).toBe("detour_left");
    expect(routeChoice(equal("left"))).toBe("detour_right");
  });

  it("leaves a platform that is a moment from the edge, whatever is ahead, and not one that is only soon", () => {
    const on = (word: "a_moment" | "soon" | "later" | "not_carried"): SceneState => ({
      ...with_({ cross_ahead: { lands_on: "lily_pad", things_move: "still" } }),
      chicken: { ...base().chicken, edge_in: word },
    });
    expect(routeChoice(on("a_moment"))).toBe("leave_platform");
    for (const word of ["soon", "later", "not_carried"] as const) {
      expect(routeChoice(on(word))).toBe("cross_ahead");
    }
  });

  it("waits when neither side has an opening, or the one it has was already tried", () => {
    const none = (): SceneState["detour_left"] => ({
      opening_ahead: "none",
      own_row_that_way: "blocked_at_once",
      recently_failed: "no",
    });
    expect(routeChoice(with_({ detour_left: none(), detour_right: none() }))).toBe("wait_here");
    expect(
      routeChoice(
        with_({
          detour_left: { ...none(), opening_ahead: "adjacent", recently_failed: "yes" },
          detour_right: none(),
        }),
      ),
    ).toBe("wait_here");
  });
});

describe("exec-route: the controller with an ideal chooser, a free reference", () => {
  it("asks nobody, and plays far better than always forward without drowning", async () => {
    let route = 0;
    let forward = 0;
    let drowned = 0;
    const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const result = await playEpisode(execRoute, seed);
      route += result.score;
      forward += (await playEpisode(alwaysForward, seed)).score;
      if (result.deathCause === "water") drowned++;
      for (const record of result.records) {
        expect(record.source).toBe("executor");
        expect(record.neurons).toBeUndefined();
      }
    }
    expect(route / seeds.length).toBeGreaterThan(3 * (forward / seeds.length));
    expect(drowned).toBeLessThanOrEqual(2);
  });

  it("knows every manoeuvre of the strategy", () => {
    expect(ROUTE_IDS).toEqual([
      "cross_ahead",
      "detour_left",
      "detour_right",
      "wait_here",
      "leave_platform",
    ]);
  });
});
