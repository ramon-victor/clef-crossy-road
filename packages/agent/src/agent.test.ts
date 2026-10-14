import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { ACTIONS, type Action, Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward, lookaheadPolicy, randomPolicy } from "./baselines.ts";
import { clefPolicy, clefPolicyId, selectByRisk, selectGoUnlessRisky } from "./clef-policy.ts";
import { encodeState } from "./encode.ts";
import { MANUALS, riskQuestionId } from "./prompts.ts";
import { playEpisode } from "./runner.ts";

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

async function meanScore(factory: Parameters<typeof playEpisode>[0], seeds = SEEDS) {
  let total = 0;
  for (const seed of seeds) total += (await playEpisode(factory, seed)).score;
  return total / seeds.length;
}

describe("baselines and runner", () => {
  it("always-forward only ever hops forward", async () => {
    const result = await playEpisode(alwaysForward, 7);
    expect(new Set(result.actions)).toEqual(new Set(["hop_forward"]));
    expect(result.policy).toBe("always-forward");
  });

  it("replays exactly: same policy and seed give the same episode", async () => {
    const a = await playEpisode(randomPolicy, 11);
    const b = await playEpisode(randomPolicy, 11);
    expect(a).toEqual(b);
    const c = await playEpisode(randomPolicy, 12);
    expect(c.actions).not.toEqual(a.actions);
  });

  it("the recorded actions reproduce the result on a fresh game", async () => {
    const episode = await playEpisode(randomPolicy, 21);
    const game = new Game({ seed: 21 });
    for (const action of episode.actions) game.step(action);
    expect(game.score).toBe(episode.score);
    expect(game.alive).toBe(episode.alive);
    expect(game.deathCause).toBe(episode.deathCause);
  });

  it("stops at maxDecisions and flags the episode as capped", async () => {
    const stayer = {
      id: "stay",
      create: () => ({
        kind: "observation" as const,
        id: "stay",
        decide: async () => ({ action: "stay" as Action }),
      }),
    };
    const result = await playEpisode(stayer, 3, { maxDecisions: 5 });
    expect(result.decisions).toBe(5);
    expect(result.capped).toBe(true);
    expect(result.alive).toBe(true);
    expect(result.score).toBe(0);
  });

  it("ends an episode that stops making progress (stall limit) instead of running to the cap", async () => {
    const dither = {
      id: "dither",
      create: () => ({
        kind: "observation" as const,
        id: "dither",
        decide: async () => ({ action: "stay" as Action }),
      }),
    };
    const stalled = await playEpisode(dither, 3, { stallLimit: 7 });
    expect(stalled.decisions).toBe(7);
    expect(stalled.stalled).toBe(true);
    expect(stalled.capped).toBe(false);

    const off = await playEpisode(dither, 3, { stallLimit: 0, maxDecisions: 25 });
    expect(off.decisions).toBe(25);
    expect(off.stalled).toBe(false);
    expect(off.capped).toBe(true);
  });

  it("latency injection lets the world run between the observation and the action", async () => {
    const waiter = {
      id: "wait",
      create: () => ({
        kind: "observation" as const,
        id: "wait",
        decide: async () => ({ action: "stay" as Action }),
      }),
    };
    const none = await playEpisode(waiter, 3, { maxDecisions: 5, stallLimit: 0 });
    expect(none.ticks).toBe(5 * 12);

    const slow = await playEpisode(waiter, 3, {
      maxDecisions: 5,
      stallLimit: 0,
      latency: { kind: "fixed", ms: 300 },
    });
    expect(slow.ticks).toBe(5 * (12 + 18)); // 300 ms = 18 ticks of world time per decision
    expect(slow.records.every((r) => r.waitedTicks === 18)).toBe(true);
  });

  it("recorded latency replays the latency stored with each answer", async () => {
    const stored = {
      id: "stored",
      create: () => ({
        kind: "observation" as const,
        id: "stored",
        decide: async () => ({ action: "stay" as Action, latencyMs: 500 }),
      }),
    };
    const result = await playEpisode(stored, 3, {
      maxDecisions: 2,
      stallLimit: 0,
      latency: { kind: "recorded" },
    });
    expect(result.records.map((r) => r.waitedTicks)).toEqual([30, 30]); // 500 ms = 30 ticks
  });

  it("a slow policy plays worse than the same policy answering instantly", async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    let instant = 0;
    let slow = 0;
    for (const seed of seeds) {
      instant += (await playEpisode(randomPolicy, seed)).score;
      slow += (await playEpisode(randomPolicy, seed, { latency: { kind: "fixed", ms: 600 } }))
        .score;
    }
    expect(slow).toBeLessThan(instant);
  });

  it("a latency-compensated look-ahead recovers most of what plain look-ahead loses to delay", async () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const latency = { kind: "fixed", ms: 300 } as const;
    let plain = 0;
    let compensated = 0;
    for (const seed of seeds) {
      plain += (await playEpisode(lookaheadPolicy(3), seed, { latency })).score;
      compensated += (await playEpisode(lookaheadPolicy(3, undefined, 300), seed, { latency }))
        .score;
    }
    expect(lookaheadPolicy(3, undefined, 300).id).toBe("lookahead-comp:300");
    // Compensation fixes the stale information, but the hero still idles on dangerous tiles while it
    // waits, which no prediction removes. So it helps clearly without restoring the no-latency score.
    expect(compensated).toBeGreaterThan(plain * 1.3);
  });

  it("pipelined latency overlaps the hop with the wait: cadence is max(latency, hop), not the sum", async () => {
    const hopper = {
      id: "hopper",
      create: () => ({
        kind: "observation" as const,
        id: "hopper",
        decide: async () => ({ action: "stay" as Action }),
      }),
    };
    const serial = await playEpisode(hopper, 3, {
      maxDecisions: 4,
      stallLimit: 0,
      latency: { kind: "fixed", ms: 300 },
    });
    const pipelined = await playEpisode(hopper, 3, {
      maxDecisions: 4,
      stallLimit: 0,
      latency: { kind: "fixed", ms: 300, pipelined: true },
    });
    expect(serial.ticks).toBe(4 * (18 + 12));
    expect(pipelined.ticks).toBe(4 * 18); // the 12-tick hop happens inside the 18-tick wait
  });

  it("pipelined mode always lets time advance, even with zero latency", async () => {
    const hopper = {
      id: "hopper",
      create: () => ({
        kind: "observation" as const,
        id: "hopper",
        decide: async () => ({ action: "stay" as Action }),
      }),
    };
    const result = await playEpisode(hopper, 3, {
      maxDecisions: 3,
      stallLimit: 0,
      latency: { kind: "fixed", ms: 0, pipelined: true },
    });
    expect(result.ticks).toBe(3);
  });

  it("does not count a stall while the policy keeps reaching new rows", async () => {
    const result = await playEpisode(alwaysForward, 9, { stallLimit: 1 });
    expect(result.stalled).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("look-ahead is far better than the trivial baselines (it reads the simulator)", async () => {
    const [ahead, forward, random] = await Promise.all([
      meanScore(lookaheadPolicy(3)),
      meanScore(alwaysForward),
      meanScore(randomPolicy),
    ]);
    expect(ahead).toBeGreaterThan(forward * 2);
    expect(forward).toBeGreaterThan(random);
  });

  it("look-ahead never walks into a death it could have avoided within its horizon", async () => {
    // Re-check each of its first decisions: if the chosen action kills at once, every alternative must too.
    const policy = lookaheadPolicy(3).create(0);
    if (policy.kind !== "oracle") throw new Error("expected an oracle");
    for (const seed of SEEDS.slice(0, 25)) {
      const game = new Game({ seed });
      for (let i = 0; i < 12 && game.alive; i++) {
        const { action } = await policy.decide(game);
        const probe = game.clone();
        probe.step(action);
        if (!probe.alive) {
          const survivors = ACTIONS.filter((a) => {
            const alt = game.clone();
            alt.step(a);
            return alt.alive;
          });
          expect(survivors).toEqual([]);
        }
        game.step(action);
      }
    }
  });
});

describe("encoders", () => {
  const game = new Game({ seed: 4 });
  for (let i = 0; i < 9; i++) game.step("hop_forward");
  const obs = observe(game);

  it("json passes the observation through unchanged", () => {
    expect(encodeState("json", obs)).toBe(obs);
  });

  it("grid draws exactly one chicken, on the dz=0 line, and keeps the exact numbers", () => {
    const grid = encodeState("grid", obs) as string;
    expect(grid.match(/@/g)?.length).toBe(1 + 1); // one cell plus the legend entry
    const own = grid.split("\n").find((l) => l.startsWith("dz=0"));
    expect(own).toContain("@");
    expect(grid).toContain("player: col=");
    for (const row of obs.rows) expect(grid).toContain(`dz=${row.dz > 0 ? "+" : ""}${row.dz}`);
  });

  it("neither encoder adds words that classify moves", () => {
    const text = `${JSON.stringify(encodeState("json", obs))}${encodeState("grid", obs)}`;
    expect(text).not.toMatch(/safe|danger|collision|legal|valid|best|recommend/i);
  });

  it("the manuals describe rules but never recommend a move", () => {
    for (const manual of Object.values(MANUALS)) {
      expect(manual).not.toMatch(/\b(should|safest|best move|you must|avoid)\b/i);
    }
  });
});

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

describe("ClefPolicy", () => {
  const config = {
    model: "clef-flash",
    encoder: "json",
    strategy: "choice",
    manual: "full",
  } as const;

  it("builds ids from the configuration", () => {
    expect(clefPolicyId(config)).toBe("clef:clef-flash:json:choice:full");
  });

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
    const policy = clefPolicy(client, config).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    const decision = await policy.decide(observe(new Game({ seed: 1 })));
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
    const policy = clefPolicy(client, config).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    await expect(policy.decide(observe(new Game({ seed: 1 })))).rejects.toThrow(/unknown option/);
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
    const policy = clefPolicy(client, { ...config, strategy: "critic" }).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    const decision = await policy.decide(observe(new Game({ seed: 1 })));
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

describe("selectGoUnlessRisky", () => {
  const safe = { hop_forward: 0.3, hop_back: 0.02, hop_left: 0.04, hop_right: 0.5, stay: 0.3 };

  it("goes forward unless the model thinks it is more likely than not to die", () => {
    expect(selectGoUnlessRisky(safe)).toBe("hop_forward");
    expect(selectGoUnlessRisky({ ...safe, hop_forward: 0.5 })).toBe("hop_forward");
    expect(selectGoUnlessRisky({ ...safe, hop_forward: 0.51 })).toBe("hop_left");
  });

  it("falls back to the lowest-risk alternative, never back to forward", () => {
    const allBad = { hop_forward: 0.9, hop_back: 0.9, hop_left: 0.9, hop_right: 0.9, stay: 0.9 };
    expect(selectGoUnlessRisky(allBad)).not.toBe("hop_back");
    expect(selectGoUnlessRisky(allBad)).toBe("hop_left");
  });
});

describe("selectByRisk", () => {
  it("prefers progress among equally safe actions and retreat last", () => {
    const flat = { hop_forward: 0.1, hop_back: 0.1, hop_left: 0.1, hop_right: 0.1, stay: 0.1 };
    expect(selectByRisk(flat)).toBe("hop_forward");
    expect(
      selectByRisk({ ...flat, hop_forward: 0.6, hop_left: 0.7, hop_right: 0.7, stay: 0.7 }),
    ).toBe("hop_back");
  });
});
