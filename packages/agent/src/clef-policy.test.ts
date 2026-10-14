import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { ACTIONS, type Action, Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import {
  type ClefPolicyConfig,
  clefPolicy,
  clefPolicyId,
  parseClefPolicyId,
  selectByRisk,
  selectGoUnlessRisky,
} from "./clef-policy.ts";
import { riskQuestionId } from "./prompts.ts";
import { playEpisode } from "./runner.ts";

const config: ClefPolicyConfig = {
  model: "clef-flash",
  encoder: "json",
  strategy: "choice",
  manual: "full",
};

function choiceBody(choice: string, probabilities: Record<string, number>) {
  return {
    result: {
      answers: { move: { type: "choice", choice, probabilities, confidence: 0.5 } },
      usage: { input_tokens: 500, output_tokens: 0 },
    },
    success: true,
  };
}

function clientReturning(respond: (request: ClefRequest) => unknown) {
  const seen: unknown[] = [];
  const transport: Transport = {
    async post(req) {
      seen.push(req.body);
      return { status: 200, json: respond(req.body as ClefRequest) };
    },
  };
  return {
    client: new ClefClient({ transport, cache: new MemoryCache(), sleep: async () => {} }),
    seen,
  };
}

async function decideOnFirstObservation(client: ClefClient, policyConfig: ClefPolicyConfig) {
  const policy = clefPolicy(client, policyConfig).create(1);
  if (policy.kind !== "observation") throw new Error("expected an observation policy");
  return policy.decide(observe(new Game({ seed: 1 })));
}

describe("Clef policy ids", () => {
  it("parsing is the inverse of building", () => {
    expect(clefPolicyId(config)).toBe("clef:clef-flash:json:choice:full");
    expect(parseClefPolicyId(clefPolicyId(config))).toEqual(config);
  });

  it("the manual defaults to full", () => {
    expect(parseClefPolicyId("clef:clef:grid:critic-go")).toEqual({
      model: "clef",
      encoder: "grid",
      strategy: "critic-go",
      manual: "full",
    });
  });

  it.each([
    ["clef:gpt:json:choice", /Unknown model/],
    ["clef:clef-flash:video:choice", /Unknown encoder/],
    ["clef:clef-flash:json:vote", /Unknown strategy/],
    ["clef:clef-flash:json:choice:huge", /Unknown manual/],
    ["random", /Not a Clef policy id/],
  ])("rejects %s", (id, message) => {
    expect(() => parseClefPolicyId(id)).toThrow(message);
  });
});

describe("ClefPolicy", () => {
  it("asks one choice question over the five actions and returns the model's argmax", async () => {
    const { client, seen } = clientReturning(() =>
      choiceBody("hop_left", {
        hop_forward: 0.2,
        hop_back: 0.05,
        hop_left: 0.6,
        hop_right: 0.1,
        stay: 0.05,
      }),
    );
    const decision = await decideOnFirstObservation(client, config);
    expect(decision.action).toBe("hop_left");
    expect(decision.probabilities?.hop_left).toBe(0.6);
    expect(decision.confidence).toBe(0.5);
    expect(decision.inputTokens).toBe(500);

    const body = seen[0] as {
      questions: Record<string, { criteria: object; instructions: string }>;
    };
    expect(Object.keys(body.questions)).toEqual(["move"]);
    expect(Object.keys(body.questions.move?.criteria ?? {}).sort()).toEqual([...ACTIONS].sort());
    expect(body.questions.move?.instructions.length).toBeGreaterThan(100);
  });

  it("rejects an option id it does not know", async () => {
    const { client } = clientReturning(() => choiceBody("teleport", { teleport: 1 }));
    await expect(decideOnFirstObservation(client, config)).rejects.toThrow(/unknown option/);
  });

  it("critic strategy asks five noul questions and picks by our selection rule", async () => {
    const risks: Record<Action, number> = {
      hop_forward: 0.9,
      hop_back: 0.02,
      hop_left: 0.04,
      hop_right: 0.5,
      stay: 0.3,
    };
    const { client, seen } = clientReturning(() => ({
      result: {
        answers: Object.fromEntries(
          ACTIONS.map((a) => [riskQuestionId(a), { type: "noul", noul: risks[a] }]),
        ),
        usage: { input_tokens: 800, output_tokens: 0 },
      },
    }));
    const decision = await decideOnFirstObservation(client, { ...config, strategy: "critic" });
    // hop_back (0.02) and hop_left (0.04) are within the tolerance; left outranks back in our preference.
    expect(decision.action).toBe("hop_left");
    expect(decision.extra?.risk).toEqual(risks);
    expect(Object.keys((seen[0] as { questions: object }).questions)).toHaveLength(5);
  });

  it("a played episode reaches the end through the full pipeline, caching repeats", async () => {
    let calls = 0;
    const { client } = clientReturning(() => {
      calls++;
      return choiceBody("hop_forward", { hop_forward: 1 });
    });
    const factory = clefPolicy(client, config);
    const first = await playEpisode(factory, 5);
    const callsAfterFirst = calls;
    const second = await playEpisode(factory, 5);
    expect(first.actions.every((a) => a === "hop_forward")).toBe(true);
    expect(second).toEqual({ ...first, records: second.records });
    expect(calls).toBe(callsAfterFirst); // fully served from cache
    expect(second.records.every((r) => r.cached === true)).toBe(true);
  });
});

describe("selection rules", () => {
  const safe = { hop_forward: 0.3, hop_back: 0.02, hop_left: 0.04, hop_right: 0.5, stay: 0.3 };

  it("go-unless-risky goes forward unless the model thinks it is more likely than not to die", () => {
    expect(selectGoUnlessRisky(safe)).toBe("hop_forward");
    expect(selectGoUnlessRisky({ ...safe, hop_forward: 0.5 })).toBe("hop_forward");
    expect(selectGoUnlessRisky({ ...safe, hop_forward: 0.51 })).toBe("hop_left");
  });

  it("go-unless-risky falls back to the lowest-risk alternative, never back to forward", () => {
    const allBad = { hop_forward: 0.9, hop_back: 0.9, hop_left: 0.9, hop_right: 0.9, stay: 0.9 };
    expect(selectGoUnlessRisky(allBad)).toBe("hop_left");
  });

  it("lowest-risk prefers progress among equally safe actions and retreat last", () => {
    const flat = { hop_forward: 0.1, hop_back: 0.1, hop_left: 0.1, hop_right: 0.1, stay: 0.1 };
    expect(selectByRisk(flat)).toBe("hop_forward");
    expect(
      selectByRisk({ ...flat, hop_forward: 0.6, hop_left: 0.7, hop_right: 0.7, stay: 0.7 }),
    ).toBe("hop_back");
  });
});
