import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { Game, type Observation, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import {
  clefPolicy,
  clefPolicyId,
  helpLabel,
  parseClefPolicyId,
  STRATEGY_IDS,
} from "./clef-policy.ts";
import { decisionCost } from "./cost.ts";
import { emptyMemory } from "./memory.ts";
import type { ModelInput } from "./policy.ts";
import {
  boxedIn,
  grass,
  road,
  seed6PlatformExit,
  warnedRailsExit,
  water,
  world,
} from "./route.testing.ts";
import { MAX_CROSS_WAIT } from "./route.ts";
import { fromRoute, refusalOrder } from "./route-policy.ts";
import { playEpisode } from "./runner.ts";

describe("the route strategy through the Clef policy", () => {
  const id = "clef:clef-flash:scene:route:lookup";

  function clientAnswering(
    cell: string,
    moving: string,
    around: string,
    pStand = 0.8,
    ride?: { choice: string; pLeaving: number },
    here: { choice: string; pMoveOff: number } = { choice: "remain", pMoveOff: 0.1 },
  ) {
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
                here: {
                  type: "choice",
                  choice: here.choice,
                  probabilities: { remain: 1 - here.pMoveOff, move_off: here.pMoveOff },
                  confidence: 0.5,
                },
                ...(ride === undefined
                  ? {}
                  : {
                      ride: {
                        type: "choice",
                        choice: ride.choice,
                        probabilities: { leaving: ride.pLeaving, staying: 1 - ride.pLeaving },
                        confidence: 0.5,
                      },
                    }),
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
    expect(helpLabel(parseClefPolicyId(id))).toBe(
      "words + rules + graph + platform clock + route executor",
    );
  });

  it("is an estimate of the cost until a probe reads the tokens", () => {
    const cost = decisionCost(parseClefPolicyId(id));
    expect(cost.measured).toBe(false);
    expect(cost.tokens).toBeGreaterThan(1000);
  });

  it("asks the four questions in one request, and a cell to stand on means cross", async () => {
    const { client, requests } = clientAnswering("stand", "still", "detour_left");
    const decision = await policyOf(client).decide(observe(new Game({ seed: 1 })));
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual([
      "around",
      "cell",
      "here",
      "moving",
    ]);
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

  it("tells the caller what it asks just before asking, and hands back each answer as the model gave it", async () => {
    const { client, requests } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const asked: Array<{ input: ModelInput; sentSoFar: number }> = [];
    const decision = await policyOf(client).decide(observe(new Game({ seed: 4 })), emptyMemory(), {
      onAsk: (input) => asked.push({ input, sentSoFar: requests.length }),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.sentSoFar).toBe(0); // before the request left
    expect(asked[0]?.input).toBe(decision.sent);
    expect(Object.keys(decision.answers ?? {}).sort()).toEqual([
      "around",
      "cell",
      "here",
      "moving",
    ]);
    expect(decision.answers?.cell).toEqual({
      choice: "no_stand",
      probabilities: { stand: 0.1, no_stand: 0.9 },
    });
    expect(decision.answers?.around?.choice).toBe("detour_right");
  });

  it("does not announce a step the controller takes by itself, which asks nothing", async () => {
    const { client, requests } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const policy = policyOf(client);
    const asked: ModelInput[] = [];
    const hooks = { onAsk: (input: ModelInput) => asked.push(input) };
    const memory = emptyMemory();
    const first = await policy.decide(boxedIn(), memory, hooks);
    const second = await policy.decide(boxedIn(), memory, hooks);
    expect(first.source).toBe("model");
    expect(second.source).toBe("executor");
    expect(second.answers).toBeUndefined();
    expect(second.sent).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("puts the kind of each step on the decision, the model's own and the controller's after it", async () => {
    const { client } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const policy = policyOf(client);
    const memory = emptyMemory();
    const first = await policy.decide(boxedIn(), memory);
    const second = await policy.decide(boxedIn(), memory);
    expect(first.source).toBe("model");
    expect(first.extra).toMatchObject({
      maneuver: "detour_right",
      controller: { kind: "walk", n: 1 },
    });
    expect(first.preview?.steps.map((step) => step.action)).toEqual([
      "hop_back",
      "hop_right",
      "hop_right",
      "hop_forward",
      "hop_forward",
    ]);
    expect(second.source).toBe("executor");
    expect(second.preview).toEqual(first.preview);
    expect(second.extra).toEqual({ controller: { kind: "walk", n: 2, left: expect.any(Number) } });
  });

  it("says a crossing waits for a gap, and that the way ahead is passing, not closed", async () => {
    const { client } = clientAnswering("no_stand", "moving", "detour_left", 0.1);
    const obs = world([grass([], 0), water([{ col: 4, speed: -1, type: "log" }], 1)]);
    const decision = await policyOf(client).decide(obs);
    expect(decision.action).toBe("stay");
    expect(decision.extra).toMatchObject({
      ahead: "passing",
      maneuver: "cross_ahead",
      controller: { kind: "wait", n: 1, of: MAX_CROSS_WAIT, cell: "water" },
    });
  });

  it("keeps the kind of step out of the records of a game, which only the screen needs", async () => {
    const { client } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const episode = await playEpisode(clefPolicy(client, parseClefPolicyId(id)), 4, {
      maxDecisions: 12,
    });
    expect(episode.records.some((record) => record.source === "executor")).toBe(true);
    for (const record of episode.records) {
      expect(record.extra ?? {}).not.toHaveProperty("controller");
      expect(record).not.toHaveProperty("preview");
    }
    // What a strategy reports for the benchmark is kept.
    expect(episode.records.find((record) => record.extra?.maneuver)?.extra).toMatchObject({
      maneuver: expect.any(String),
    });
  });

  it("gives every episode its own controller", () => {
    const { client } = clientAnswering("stand", "still", "wait_here");
    const factory = clefPolicy(client, parseClefPolicyId(id));
    expect(factory.create(1)).not.toBe(factory.create(1));
  });

  describe("on a platform", () => {
    const logAtEdge = (): Observation =>
      world(
        [grass([], -1), water([{ col: 3, speed: 3, type: "log", half: 1.6 }], 0), grass([], 1)],
        3,
        true,
      );
    const sum = (probabilities: Record<string, number> | undefined) =>
      Object.values(probabilities ?? {}).reduce((a, b) => a + b, 0);

    it("sends the clock and asks the fourth question only while the chicken stands on a platform", async () => {
      const { client, requests } = clientAnswering("stand", "still", "wait_here", 0.8, {
        choice: "staying",
        pLeaving: 0.1,
      });
      const policy = policyOf(client);
      await policy.decide(logAtEdge());
      await policy.decide(observe(new Game({ seed: 4 })));
      const [onPlatform, off] = requests as [ClefRequest, ClefRequest];
      const chickenOf = (request: ClefRequest) => (request.state as { chicken: object }).chicken;
      expect(Object.keys(onPlatform.questions).sort()).toEqual([
        "around",
        "cell",
        "here",
        "moving",
        "ride",
      ]);
      expect(chickenOf(onPlatform)).toMatchObject({ edge_in: "a_moment" });
      expect(Object.keys(off.questions).sort()).toEqual(["around", "cell", "here", "moving"]);
      expect(chickenOf(off)).not.toHaveProperty("edge_in");
    });

    it("leaves the platform when the model says it is leaving, whatever it said of the row ahead, and the bars still add up", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9, {
        choice: "leaving",
        pLeaving: 0.8,
      });
      const decision = await policyOf(client).decide(logAtEdge());
      expect(decision).toMatchObject({
        action: "hop_forward",
        extra: {
          maneuver: "leave_platform",
          ahead: "open",
          ride: "leaving",
          controller: { kind: "leave", n: 1 },
        },
      });
      expect(decision.probabilities?.hop_forward).toBeGreaterThan(0.8);
      expect(sum(decision.probabilities)).toBeCloseTo(1, 5);
    });

    it("keeps the other manoeuvres when the model says it is staying, and the bars still add up", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9, {
        choice: "staying",
        pLeaving: 0.2,
      });
      const decision = await policyOf(client).decide(logAtEdge());
      expect(decision.extra).toMatchObject({ maneuver: "cross_ahead", ride: "staying" });
      expect(sum(decision.probabilities)).toBeCloseTo(1, 5);
    });

    it("executes the whole seed 6 exit from one model answer, including the transit over the rail", async () => {
      const game = seed6PlatformExit();
      const { client, requests } = clientAnswering("no_stand", "still", "wait_here", 0.1, {
        choice: "leaving",
        pLeaving: 0.8,
      });
      const policy = policyOf(client);
      const first = await policy.decide(observe(game));
      expect(first).toMatchObject({
        action: "hop_back",
        source: "model",
        extra: { maneuver: "leave_platform", controller: { kind: "leave", n: 1, left: 2 } },
      });
      expect(sum(first.probabilities)).toBeCloseTo(1, 5);
      game.step(first.action);
      const second = await policy.decide(observe(game));
      expect(second).toMatchObject({
        action: "hop_back",
        source: "executor",
        extra: { controller: { kind: "leave", n: 2, left: 1 } },
      });
      expect(second.inputTokens).toBeUndefined();
      expect(requests).toHaveLength(1);
      game.step(second.action);
      game.advance(60);
      expect(game.alive).toBe(true);
    });

    it("does not get the chicken off a drifting log when the model says it is staying: the next decision asks again", async () => {
      const game = warnedRailsExit();
      const { client, requests } = clientAnswering("no_stand", "still", "wait_here", 0.1, {
        choice: "staying",
        pLeaving: 0.1,
      });
      const policy = policyOf(client);
      const first = await policy.decide(observe(game));
      expect(first).toMatchObject({
        action: "stay",
        source: "model",
        extra: { maneuver: "wait_here", controller: { kind: "hold", why: "edge" } },
      });
      expect(first.preview).toBeUndefined();
      game.step(first.action);
      const second = await policy.decide(observe(game));
      expect(second.source).toBe("model");
      expect(requests).toHaveLength(2);
    });

    it("keeps the platform clock first: leaving the platform wins over stepping off", async () => {
      const { client } = clientAnswering(
        "stand",
        "still",
        "wait_here",
        0.9,
        { choice: "leaving", pLeaving: 0.8 },
        { choice: "move_off", pMoveOff: 0.6 },
      );
      const decision = await policyOf(client).decide(logAtEdge());
      expect(decision.extra).toMatchObject({ maneuver: "leave_platform" });
      expect(sum(decision.probabilities)).toBeCloseTo(1);
    });
  });

  describe("the cell under the chicken", () => {
    // A vehicle reaches the chicken's own road row at 0.3 s, with a tree ahead.
    const vehicleOnRow = () =>
      world([grass([], -1), road([{ col: 2.5, speed: -6 }], 0), grass([0], 1)]);
    const sum = (probabilities: Record<string, number> | undefined) =>
      Object.values(probabilities ?? {}).reduce((a, b) => a + b, 0);

    it("steps off it when the model says it cannot stay, whatever it said of the row ahead, and the bars still add up", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9, undefined, {
        choice: "move_off",
        pMoveOff: 0.7,
      });
      const decision = await policyOf(client).decide(vehicleOnRow());
      expect(decision.source).toBe("model");
      expect(decision.action).not.toBe("stay");
      expect(decision.extra).toMatchObject({
        maneuver: "step_off",
        here: "move_off",
        pMoveOff: 0.7,
        controller: { kind: "dodge" },
      });
      expect(sum(decision.probabilities)).toBeCloseTo(1);
      expect(decision.probabilities?.[decision.action]).toBeGreaterThanOrEqual(0.7);
    });

    it("leaves the chicken where it is when the model says it can stay: a wrong answer is not rescued", async () => {
      const wrong = { choice: "remain", pMoveOff: 0.2 };
      const { client } = clientAnswering("no_stand", "still", "wait_here", 0.1, undefined, wrong);
      const decision = await policyOf(client).decide(vehicleOnRow());
      // The way ahead is closed and the model says to wait: nothing moves the chicken off the cell the vehicle reaches.
      expect(decision).toMatchObject({
        action: "stay",
        source: "model",
        extra: {
          maneuver: "wait_here",
          here: "remain",
          controller: { kind: "hold", why: "exposed" },
        },
      });
    });
  });

  describe("when the manoeuvre the model chose cannot begin", () => {
    it.each([
      ["cross_ahead", ["detour_right", "detour_left"]],
      ["detour_right", ["detour_left"]],
      ["detour_left", ["detour_right"]],
      ["wait_here", []],
      ["leave_platform", []],
    ] as const)("%s passes on to %j, by the probabilities the model gave", (chosen, order) => {
      const around = { detour_left: 0.2, detour_right: 0.6, wait_here: 0.2 };
      expect(refusalOrder(chosen, around)).toEqual(order);
    });

    it("takes the model's next answer for water that never changes, without asking again", async () => {
      const { client, requests } = clientAnswering("stand", "still", "detour_right", 0.9);
      const open = world([grass([], -1), grass([], 0), water([{ col: 2 }], 1), grass([], 2)]);
      const decision = await policyOf(client).decide(open);
      expect(requests).toHaveLength(1);
      expect(decision).toMatchObject({
        action: "hop_right",
        extra: { maneuver: "cross_ahead", fallback: "detour_right", controller: { kind: "walk" } },
      });
      expect(decision.note).toContain(
        "cross_ahead: refused, nothing moves on that row, the water stays; detour_right: hop 1",
      );
    });

    it("goes on to the other side when the side it chose has no way", async () => {
      const { client } = clientAnswering("no_stand", "still", "detour_left", 0.1);
      const decision = await policyOf(client).decide(boxedIn());
      expect(decision.note).toContain("detour_left: refused, no way to an opening on the left");
      expect(decision.extra).toMatchObject({ maneuver: "detour_left", fallback: "detour_right" });
    });

    it("says nothing of a fallback when the manoeuvre began", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9);
      const decision = await policyOf(client).decide(world([grass([], 0), grass([], 1)]));
      expect(decision.extra).not.toHaveProperty("fallback");
    });
  });

  describe("route-live: the model times the hop", () => {
    const liveId = "clef:clef-flash:scene:route-live:lookup";
    const liveOf = (client: ClefClient) => {
      const policy = clefPolicy(client, parseClefPolicyId(liveId)).create(1);
      if (policy.kind !== "observation") throw new Error("expected an observation policy");
      return policy;
    };
    const waterAhead = () => world([grass([], 0), water([{ col: 4, speed: -1, type: "log" }], 1)]);

    it("parses and prints back like route, asks the same state but says nothing checks the answers, and labels the help as a path executor", async () => {
      expect(clefPolicyId(parseClefPolicyId(liveId))).toBe(liveId);
      expect(() => parseClefPolicyId("clef:clef-flash:json:route-live:full")).toThrow();
      expect(helpLabel(parseClefPolicyId(liveId))).toBe(
        "words + rules + graph + platform clock + path executor",
      );
      expect(STRATEGY_IDS).toContain("route-live");
      const live = clientAnswering("stand", "still", "wait_here", 0.9);
      await liveOf(live.client).decide(world([grass([], 0), grass([], 1)]));
      const plain = clientAnswering("stand", "still", "wait_here", 0.9);
      await policyOf(plain.client).decide(world([grass([], 0), grass([], 1)]));
      const [asked, control] = [live.requests[0], plain.requests[0]];
      expect(asked?.state).toEqual(control?.state);
      expect(Object.keys(asked?.questions ?? {})).toEqual(Object.keys(control?.questions ?? {}));
      // The game text is the one thing that differs: a controller that waits and checks would be false here.
      const text = (request: ClefRequest | undefined) =>
        JSON.stringify(request?.questions.cell ?? {});
      expect(text(asked)).toContain("nothing checks them");
      expect(text(asked)).not.toContain("waits for the right moment");
      expect(text(control)).toContain("waits for the right moment");
    });

    it("hops on the model's word alone: a cell it called standable is hopped on, however it turns out", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9);
      const decision = await liveOf(client).decide(waterAhead());
      expect(decision).toMatchObject({
        action: "hop_forward",
        source: "model",
        extra: { maneuver: "cross_ahead", controller: { kind: "hop" } },
      });
    });

    it("waits a step when it says things pass, asks again at the next decision, and the bars add up", async () => {
      const { client, requests } = clientAnswering("no_stand", "moving", "wait_here", 0.2);
      const policy = liveOf(client);
      const first = await policy.decide(waterAhead());
      expect(first).toMatchObject({
        action: "stay",
        source: "model",
        extra: {
          maneuver: "wait_gap",
          ahead: "passing",
          controller: { kind: "wait", n: 1, of: null, why: "gap" },
        },
      });
      const second = await policy.decide(waterAhead());
      expect(second.source).toBe("model");
      expect(requests).toHaveLength(2);
      const total = Object.values(first.probabilities ?? {}).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1);
      // 0.2 is the chance of a cell to stand on, so the hop gets that much and the rest is a step of waiting.
      expect(first.probabilities?.hop_forward).toBeCloseTo(0.2, 5);
      expect(first.probabilities?.stay).toBeGreaterThan(first.probabilities?.hop_forward ?? 1);
    });

    it("does not lend the hop the answer to another question: where the chicken did not step off, that mass is left out", async () => {
      const { client } = clientAnswering("stand", "still", "wait_here", 0.9, undefined, {
        choice: "remain",
        pMoveOff: 0.45,
      });
      const decision = await liveOf(client).decide(world([grass([], 0), grass([], 1)]));
      expect(decision.action).toBe("hop_forward");
      expect(decision.probabilities?.hop_forward).toBeCloseTo(0.9, 5);
      const total = Object.values(decision.probabilities ?? {}).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 5);
    });

    it("keeps the other manoeuvres: a closed way is a detour, and the cell under it is still asked", async () => {
      const { client } = clientAnswering("no_stand", "still", "detour_right", 0.1, undefined, {
        choice: "move_off",
        pMoveOff: 0.9,
      });
      const decision = await liveOf(client).decide(
        world([grass([], -1), road([{ col: 2.5, speed: -6 }], 0), grass([0], 1)]),
      );
      expect(decision.extra).toMatchObject({ maneuver: "step_off", controller: { kind: "dodge" } });
    });
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

  it("fromRoute needs the answer about the cell under the chicken", () => {
    const choice = (name: string, options: Record<string, number>) => [
      name,
      { type: "choice", choice: Object.keys(options)[0], probabilities: options, confidence: 0 },
    ];
    expect(() =>
      fromRoute({
        answers: Object.fromEntries([
          choice("cell", { stand: 1, no_stand: 0 }),
          choice("moving", { moving: 1, still: 0 }),
          choice("around", { detour_left: 1, detour_right: 0, wait_here: 0 }),
        ]),
        usage: { inputTokens: 1 },
        latencyMs: 1,
        neurons: 0,
        cached: false,
      } as never),
    ).toThrow(/no `here` choice answer/);
  });
});
