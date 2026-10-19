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
import { boxedIn, grass, water, world } from "./route.testing.ts";
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

  it("tells the caller what it asks just before asking, and hands back each answer as the model gave it", async () => {
    const { client, requests } = clientAnswering("no_stand", "still", "detour_right", 0.1);
    const asked: Array<{ input: ModelInput; sentSoFar: number }> = [];
    const decision = await policyOf(client).decide(observe(new Game({ seed: 4 })), emptyMemory(), {
      onAsk: (input) => asked.push({ input, sentSoFar: requests.length }),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.sentSoFar).toBe(0); // before the request left
    expect(asked[0]?.input).toBe(decision.sent);
    expect(Object.keys(decision.answers ?? {}).sort()).toEqual(["around", "cell", "moving"]);
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
        "moving",
        "ride",
      ]);
      expect(chickenOf(onPlatform)).toMatchObject({ edge_in: "a_moment" });
      expect(Object.keys(off.questions).sort()).toEqual(["around", "cell", "moving"]);
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
