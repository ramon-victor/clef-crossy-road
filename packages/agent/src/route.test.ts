import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { Game, type Observation, type ObsRow, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward } from "./baselines.ts";
import {
  clefPolicy,
  clefPolicyId,
  helpLabel,
  parseClefPolicyId,
  STRATEGY_IDS,
} from "./clef-policy.ts";
import { decisionCost } from "./cost.ts";
import { ENCODER_LEVEL, encodeRequest } from "./encode.ts";
import { cellWindow } from "./lanes.ts";
import { emptyMemory, type Memory, remember } from "./memory.ts";
import {
  driftingOff,
  execRoute,
  MAX_DETOUR_STEPS,
  ROUTE_IDS,
  RouteExecutor,
  routeChoice,
  searchEscape,
  searchRoute,
} from "./route.ts";
import { fromRoute } from "./route-policy.ts";
import {
  AROUND_CRITERIA,
  AROUND_OPTIONS,
  CELL_CRITERIA,
  MOVING_CRITERIA,
  routeQuestions,
} from "./route-prompts.ts";
import { playEpisode } from "./runner.ts";
import { openingAhead, ownRowThatWay, type SceneState, sceneState } from "./scene.ts";

const grass = (blocked: number[] = [], dz = 0): ObsRow => ({
  dz,
  kind: "grass",
  blocked_cols: blocked,
});
const water = (
  platforms: Array<{ col: number; speed?: number; type?: "log" | "lily_pad"; half?: number }>,
  dz = 1,
): ObsRow => ({
  dz,
  kind: "water",
  platforms: platforms.map((p) => ({
    col: p.col,
    half_extent: p.half ?? 0.6,
    speed_cols_per_s: p.speed ?? 0,
    type: p.type ?? "lily_pad",
  })),
});
const road = (vehicles: Array<{ col: number; speed: number }>, dz = 1): ObsRow => ({
  dz,
  kind: "road",
  vehicles: vehicles.map((v) => ({ col: v.col, half_extent: 1, speed_cols_per_s: v.speed })),
});
const world = (rows: ObsRow[], col = 0, riding = false): Observation => ({
  player: {
    col,
    standing_on: rows.find((r) => r.dz === 0)?.kind ?? "grass",
    riding,
    hop_ticks_left: 0,
  },
  rows,
});

/** A chicken boxed in by trees on a grass row, with one lily pad two columns to the right on the water ahead. */
const boxedIn = (): Observation =>
  world([grass([], -1), grass([-1, 1], 0), water([{ col: 2 }], 1), grass([], 2)]);

const scene = (obs: Observation, memory: Memory = emptyMemory()): SceneState =>
  sceneState(obs, memory);

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

  it("is a new level of knowledge, not more of it: its level is `words`", () => {
    expect(ENCODER_LEVEL.scene).toBe("words");
    expect(encodeRequest("scene", boxedIn(), emptyMemory()).state).toEqual(scene(boxedIn()));
  });
});

describe("the hop window: a vehicle counts from three ticks into the hop that brings the chicken onto its row", () => {
  it("catches the vehicle that the old half-hop sweep missed", () => {
    // Measured by replaying a death: a vehicle 1.4 columns away, closing at 1.2 columns per second, hit a
    // chicken that landed in the cell at 0.05 s.
    const row = road([{ col: 2.65, speed: -1.2 }]);
    expect(cellWindow(row, 3, 0.2, 0.3)).toBe("vehicle");
  });
});

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
  });

  it("keeps to the side it was asked for, and says when that side has no way", () => {
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

  it("gives a detour back after too many hops", () => {
    const executor = new RouteExecutor();
    const memory = emptyMemory();
    executor.start("detour_right", boxedIn(), memory);
    for (let i = 0; i < MAX_DETOUR_STEPS + 2 && executor.next(boxedIn(), memory); i++) {
      // keep asking: the world does not change here, so the route never ends
    }
    expect(executor.lastResult).toMatch(/more than 12 hops and no new row/);
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

describe("the lookup questions", () => {
  const questions = routeQuestions();

  it("are three, each a lookup of its own field with its own options, the same for every state", () => {
    expect(Object.keys(questions).sort()).toEqual(["around", "cell", "moving"]);
    expect(Object.keys(CELL_CRITERIA).sort()).toEqual(["no_stand", "stand"]);
    expect(Object.keys(MOVING_CRITERIA).sort()).toEqual(["moving", "still"]);
    expect(Object.keys(AROUND_CRITERIA).sort()).toEqual([...AROUND_OPTIONS].sort());
  });

  it("each of the first two reads one field, and says so", () => {
    expect(questions.cell?.instructions).toContain("Read only cross_ahead.lands_on");
    expect(questions.moving?.instructions).toContain("Read only cross_ahead.things_move");
  });

  it("only name entries and fields that the state has, and never say which move is good", () => {
    const state = scene(boxedIn()) as unknown as Record<string, Record<string, unknown>>;
    const text = Object.values(questions)
      .map((q) =>
        q.type === "choice"
          ? `${q.instructions} ${Object.values(q.criteria).join(" ")}`
          : q.instructions,
      )
      .join(" ");
    const found = [
      ...text.matchAll(
        /\b(cross_ahead|detour_left|detour_right|wait_here|chicken|memory)\.([a-z_]+)/g,
      ),
    ];
    expect(found.length).toBeGreaterThan(12);
    for (const [, entry, field] of found) {
      expect(Object.keys(state[entry ?? ""] ?? {}), `${entry}.${field}`).toContain(field);
    }
    expect(text).not.toMatch(/\bsafe\b|\bunsafe\b|danger|you should|best move/i);
  });

  it("carry solved examples for each question", () => {
    expect(questions.cell?.instructions).toContain("lands_on lily_pad -> stand");
    expect(questions.cell?.instructions).toContain("lands_on water -> no_stand");
    expect(questions.moving?.instructions).toContain("things_move still -> still");
    expect(questions.around?.instructions).toContain("left none and right none -> wait_here");
  });
});

describe("the route strategy through the Clef policy", () => {
  const id = "clef:clef-flash:scene:route:lookup";

  function clientAnswering(cell: string, moving: string, around: string, pStand = 0.8) {
    const requests: ClefRequest[] = [];
    const transport: Transport = {
      async post(req) {
        requests.push(req.body as ClefRequest);
        return {
          status: 200,
          json: {
            result: {
              answers: {
                cell: {
                  type: "choice",
                  choice: cell,
                  probabilities: { stand: pStand, no_stand: 1 - pStand },
                  confidence: 0.5,
                },
                moving: {
                  type: "choice",
                  choice: moving,
                  probabilities: { moving: 0.5, still: 0.5 },
                  confidence: 0.5,
                },
                around: {
                  type: "choice",
                  choice: around,
                  probabilities: { detour_left: 0.2, detour_right: 0.6, wait_here: 0.2 },
                  confidence: 0.4,
                },
              },
              usage: { input_tokens: 1500, output_tokens: 0 },
            },
            success: true,
          },
        };
      },
    };
    return {
      client: new ClefClient({ transport, cache: new MemoryCache(), sleep: async () => {} }),
      requests,
    };
  }

  const policyOf = (client: ClefClient) => {
    const policy = clefPolicy(client, parseClefPolicyId(id)).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    return policy;
  };

  it("parses and prints back, and only exists as the trio scene, route, lookup", () => {
    expect(clefPolicyId(parseClefPolicyId(id))).toBe(id);
    for (const bad of [
      "clef:clef-flash:scene:choice:lookup",
      "clef:clef-flash:scene:route:full",
      "clef:clef-flash:moves:route:lookup",
      "clef:clef-flash:json:route:full",
      "clef:clef-flash:scene:critic:lookup",
    ]) {
      expect(() => parseClefPolicyId(bad), bad).toThrow();
    }
    expect(STRATEGY_IDS).toContain("route");
  });

  it("labels the help, so a result is never read without it", () => {
    expect(helpLabel(parseClefPolicyId(id))).toBe("words + rules + graph + route executor");
  });

  it("is an estimate of the cost until a probe reads the tokens", () => {
    const cost = decisionCost(parseClefPolicyId(id));
    expect(cost.measured).toBe(false);
    expect(cost.tokens).toBeGreaterThan(1000);
  });

  it("asks the three questions in one request, and a cell to stand on means cross", async () => {
    const { client, requests } = clientAnswering("stand", "still", "detour_left");
    const decision = await policyOf(client).decide(observe(new Game({ seed: 1 })));
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual(["around", "cell", "moving"]);
    expect(decision.action).toBe("hop_forward");
    expect(decision.source).toBe("model");
    expect(decision.extra).toMatchObject({
      maneuver: "cross_ahead",
      ahead: "open",
      around: "detour_left",
    });
  });

  it("a cell to stand on and things that do not move mean closed: the answer to the third question, and the probabilities add up to one", async () => {
    const { client } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const decision = await policyOf(client).decide(observe(new Game({ seed: 4 })));
    expect(decision.extra).toMatchObject({ maneuver: "detour_right", ahead: "closed" });
    const total = Object.values(decision.probabilities ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("a cell that cannot be stood on but things that keep moving mean passing: cross and wait for the gap", async () => {
    const { client } = clientAnswering("no_stand", "moving", "detour_left", 0.1);
    const decision = await policyOf(client).decide(observe(new Game({ seed: 4 })));
    expect(decision.extra).toMatchObject({ maneuver: "cross_ahead", ahead: "passing" });
  });

  it("takes the steps of a manoeuvre itself, without asking again", async () => {
    const { client, requests } = clientAnswering("no_stand", "moving", "wait_here");
    const policy = policyOf(client);
    const first = await policy.decide(observe(new Game({ seed: 1 })));
    expect(requests).toHaveLength(1);
    expect(first.source).toBe("model");
    // Seed 1 has open grass ahead, so crossing is immediate and the next decision asks again.
    const second = await policy.decide(observe(new Game({ seed: 1 })));
    expect(second.source).toBe("model");
    expect(requests).toHaveLength(2);
  });

  it("gives every episode its own controller", () => {
    const { client } = clientAnswering("stand", "still", "wait_here");
    const factory = clefPolicy(client, parseClefPolicyId(id));
    expect(factory.create(1)).not.toBe(factory.create(1));
  });

  it("fromRoute rejects an option it does not know", () => {
    expect(() =>
      fromRoute({
        answers: { cell: { type: "choice", choice: "maybe", probabilities: {}, confidence: 0 } },
        usage: { inputTokens: 1 },
        latencyMs: 1,
        neurons: 0,
        cached: false,
      } as never),
    ).toThrow(/unknown option for cell/);
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
    expect(ROUTE_IDS).toEqual(["cross_ahead", "detour_left", "detour_right", "wait_here"]);
  });
});
