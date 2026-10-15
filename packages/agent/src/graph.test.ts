import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { ACTIONS, Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { clefPolicy, clefPolicyId, helpLabel, parseClefPolicyId } from "./clef-policy.ts";
import { decisionCost } from "./cost.ts";
import { MANEUVER_IDS } from "./executor.ts";
import { ACTION_NAMES, lanesState, MANEUVER_NAMES, movesState } from "./lanes.ts";
import {
  EXCLUSIVE_CRITERIA,
  GRAPH_GO_CRITERIA,
  GRAPH_MANEUVER_GO_CRITERIA,
  GRAPH_MANEUVER_SIDE_CRITERIA,
  GRAPH_SIDE_CRITERIA,
  graphInstructions,
  graphManeuverInstructions,
  MANUALS,
  ORDERED_CRITERIA,
  ORDERED_MANEUVER_CRITERIA,
} from "./prompts.ts";

describe("ids of the moves view", () => {
  it("parse and print back", () => {
    for (const id of [
      "clef:clef-flash:moves:choice:ordered",
      "clef:clef-flash:moves:choice:exclusive",
      "clef:clef-flash:moves:maneuver:ordered",
      "clef:clef-flash:moves:graph:ordered",
      "clef:clef-flash:moves:graph-maneuver:ordered",
    ]) {
      expect(clefPolicyId(parseClefPolicyId(id)), id).toBe(id);
    }
  });

  it("refuse the pairs that mean nothing", () => {
    for (const id of [
      "clef:clef-flash:moves:choice:rules",
      "clef:clef-flash:lanes:choice:ordered",
      "clef:clef-flash:lanes:choice:exclusive",
      "clef:clef-flash:json:graph:ordered",
      "clef:clef-flash:moves:graph:full",
      "clef:clef-flash:moves:graph-maneuver:exclusive",
      "clef:clef-flash:lanes:graph:rules",
      "clef:clef-flash:moves:critic:ordered",
      "clef:clef-flash:moves:maneuver:exclusive",
    ]) {
      expect(() => parseClefPolicyId(id), id).toThrow();
    }
  });

  it("label the help, so a result is never read without it", () => {
    const label = (id: string) => helpLabel(parseClefPolicyId(id));
    expect(label("clef:clef-flash:moves:choice:ordered")).toBe("words + rules");
    expect(label("clef:clef-flash:moves:choice:exclusive")).toBe("words + rules");
    expect(label("clef:clef-flash:moves:graph:ordered")).toBe("words + rules + graph");
    expect(label("clef:clef-flash:moves:graph-maneuver:ordered")).toBe(
      "words + rules + graph + executor",
    );
  });

  it("the graph asks two questions, so it costs more than one, and is flagged as an estimate", () => {
    const choice = decisionCost({ model: "clef-flash", encoder: "moves", strategy: "choice" });
    const graph = decisionCost({ model: "clef-flash", encoder: "moves", strategy: "graph" });
    expect(graph.tokens).toBeGreaterThan(choice.tokens);
    expect(graph.measured).toBe(false);
    expect(
      decisionCost({ model: "clef-flash", encoder: "moves", strategy: "graph-maneuver" }).tokens,
    ).toBe(graph.tokens);
  });
});

/** Every `entry.field` the options mention has to exist in the state they will be read with. */
function mentioned(text: string): Array<[string, string]> {
  const names = [...Object.values(ACTION_NAMES), ...Object.values(MANEUVER_NAMES)].join("|");
  return [...text.matchAll(new RegExp(`\\b(${names})\\.([a-z_]+)`, "g"))].map(
    (m) => [m[1] ?? "", m[2] ?? ""] as [string, string],
  );
}

describe("the options of the moves view", () => {
  const game = new Game({ seed: 3 });
  game.step("hop_forward");
  const lanes = lanesState(observe(game));
  const hops = movesState(lanes, ACTION_NAMES) as Record<string, Record<string, unknown>>;
  const moves = movesState(lanes, MANEUVER_NAMES, { movement: true }) as Record<
    string,
    Record<string, unknown>
  >;

  it("have one option per move and per manoeuvre", () => {
    expect(Object.keys(ORDERED_CRITERIA).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(EXCLUSIVE_CRITERIA).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(ORDERED_MANEUVER_CRITERIA).sort()).toEqual([...MANEUVER_IDS].sort());
    expect(Object.keys(GRAPH_GO_CRITERIA).sort()).toEqual(["go", "hold"]);
    expect(Object.keys(GRAPH_SIDE_CRITERIA).sort()).toEqual(
      ["hop_back", "hop_left", "hop_right", "stay"].sort(),
    );
    expect(Object.keys(GRAPH_MANEUVER_GO_CRITERIA).sort()).toEqual(["go", "hold"]);
    expect(Object.keys(GRAPH_MANEUVER_SIDE_CRITERIA).sort()).toEqual(
      ["back_off", "sidestep_left", "sidestep_right", "wait_here"].sort(),
    );
  });

  it("only name entries and fields that the state has", () => {
    const texts: Array<[string, Record<string, unknown>]> = [
      [[...Object.values(ORDERED_CRITERIA), ...Object.values(EXCLUSIVE_CRITERIA)].join(" "), hops],
      [
        [
          ...Object.values(GRAPH_GO_CRITERIA),
          ...Object.values(GRAPH_SIDE_CRITERIA),
          graphInstructions("go"),
          graphInstructions("side"),
        ].join(" "),
        hops,
      ],
      [
        [
          ...Object.values(ORDERED_MANEUVER_CRITERIA),
          ...Object.values(GRAPH_MANEUVER_GO_CRITERIA),
          ...Object.values(GRAPH_MANEUVER_SIDE_CRITERIA),
          graphManeuverInstructions("go"),
          graphManeuverInstructions("side"),
        ].join(" "),
        moves,
      ],
    ];
    for (const [text, state] of texts) {
      const found = mentioned(text);
      expect(found.length).toBeGreaterThan(8);
      for (const [entry, field] of found) {
        // "then_hop_forward_lands_on" is read as a whole field, so the regex above stops at "then_..." only when the entry is a prefix.
        expect(Object.keys(state[entry] ?? {}), `${entry}.${field}`).toContain(field);
      }
    }
  });

  it("say what the game is and which words mean what, and never which move is good", () => {
    const text = [
      MANUALS.ordered,
      ...Object.values(ORDERED_CRITERIA),
      ...Object.values(EXCLUSIVE_CRITERIA),
      ...Object.values(GRAPH_SIDE_CRITERIA),
    ].join(" ");
    expect(text).not.toMatch(/\bsafe\b|\bunsafe\b|danger|best move|you should/i);
  });
});

/** The options of the second question of a request. */
function sideCriteria(request: ClefRequest): Record<string, string> {
  const question = request.questions.side;
  return question?.type === "choice" ? question.criteria : {};
}

describe("the graph strategies through the Clef policy", () => {
  function clientAnswering(go: string, side: string, pGo = 0.9) {
    const requests: ClefRequest[] = [];
    const transport: Transport = {
      async post(req) {
        requests.push(req.body as ClefRequest);
        const names = Object.keys(sideCriteria(req.body as ClefRequest));
        const sideP = Object.fromEntries(names.map((n) => [n, n === side ? 0.7 : 0.1]));
        return {
          status: 200,
          json: {
            result: {
              answers: {
                go: {
                  type: "choice",
                  choice: go,
                  probabilities: { go: pGo, hold: 1 - pGo },
                  confidence: 0.5,
                },
                side: { type: "choice", choice: side, probabilities: sideP, confidence: 0.4 },
              },
              usage: { input_tokens: 1200, output_tokens: 0 },
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

  const policyOf = (strategy: "graph" | "graph-maneuver", client: ClefClient) => {
    const factory = clefPolicy(client, {
      model: "clef-flash",
      encoder: "moves",
      strategy,
      manual: "ordered",
    });
    const policy = factory.create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    return policy;
  };

  it("asks the two questions in one request", async () => {
    const { client, requests } = clientAnswering("go", "stay");
    await policyOf("graph", client).decide(observe(new Game({ seed: 1 })));
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {}).sort()).toEqual(["go", "side"]);
  });

  it("go means hop forward, whatever the second answer says", async () => {
    const { client } = clientAnswering("go", "hop_left", 0.8);
    const decision = await policyOf("graph", client).decide(observe(new Game({ seed: 1 })));
    expect(decision.action).toBe("hop_forward");
    expect(decision.probabilities?.hop_forward).toBeCloseTo(0.8);
    expect(decision.extra).toMatchObject({ side: "hop_left" });
  });

  it("hold means the answer to the second question, and the probabilities add up to one", async () => {
    const { client } = clientAnswering("hold", "hop_left", 0.2);
    const decision = await policyOf("graph", client).decide(observe(new Game({ seed: 1 })));
    expect(decision.action).toBe("hop_left");
    const total = Object.values(decision.probabilities ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(decision.probabilities?.hop_forward).toBeCloseTo(0.2);
  });

  it("with the executor, go starts crossing ahead, and the model's pick keeps its record", async () => {
    const { client, requests } = clientAnswering("go", "sidestep_left");
    const decision = await policyOf("graph-maneuver", client).decide(
      observe(new Game({ seed: 1 })),
    );
    expect(decision.action).toBe("hop_forward");
    expect(decision.source).toBe("model");
    expect(decision.extra).toMatchObject({ maneuver: "cross_ahead", side: "sidestep_left" });
    expect(Object.keys(sideCriteria(requests[0] as ClefRequest)).sort()).toEqual(
      ["back_off", "sidestep_left", "sidestep_right", "wait_here"].sort(),
    );
    expect(Object.keys(requests[0]?.state as object)).toContain("cross_ahead");
  });

  it("with the executor, hold starts the side manoeuvre the second question picked", async () => {
    const { client } = clientAnswering("hold", "sidestep_right", 0.1);
    const decision = await policyOf("graph-maneuver", client).decide(
      observe(new Game({ seed: 1 })),
    );
    expect(decision.extra).toMatchObject({ maneuver: "sidestep_right" });
  });
});
