import { alwaysForward, type EpisodeResult, playEpisode, randomPolicy } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { compare, perceptionOf, renderReport, summarize, verdict } from "./report.ts";

function fixture(overrides: Partial<EpisodeResult> = {}): EpisodeResult {
  return {
    policy: "p",
    seed: 1,
    score: 0,
    decisions: 0,
    alive: false,
    deathCause: "car",
    invalidMoves: 0,
    ticks: 0,
    capped: false,
    stalled: false,
    actions: [],
    records: [],
    ...overrides,
  };
}

const record = (extra: object) => ({
  index: 0,
  tick: 0,
  row: 0,
  action: "hop_forward" as const,
  outcome: "hop" as const,
  ...extra,
});

describe("summarize", () => {
  it("counts how episodes ended and keeps still-alive ones apart", () => {
    const summary = summarize("p", [
      fixture({ deathCause: "water" }),
      fixture({ deathCause: "water" }),
      fixture({ deathCause: "train" }),
      fixture({ alive: true, deathCause: null, stalled: true }),
      fixture({ alive: true, deathCause: null, capped: true }),
    ]);
    expect(summary.deaths).toEqual({ water: 2, train: 1, stalled: 1, capped: 1 });
    expect(summary.capped).toBe(1);
  });

  it("measures latency only on answers that really went to the model", () => {
    const summary = summarize("p", [
      fixture({
        records: [
          record({ cached: true, latencyMs: 5 }),
          record({ cached: false, latencyMs: 300, inputTokens: 1000, neurons: 3.5 }),
          record({ cached: false, latencyMs: 500, inputTokens: 1200, neurons: 4.1 }),
        ],
      }),
    ]);
    expect(summary.latencyMs).toEqual({ p50: 400, p95: 490, n: 2 });
    expect(summary.neurons).toBeCloseTo(7.6, 10);
    expect(summary.cacheHitRate).toBeCloseTo(1 / 3, 10);
  });

  it("reports nothing about model calls for a policy that never calls one", () => {
    const summary = summarize("p", [fixture({ score: 4, records: [record({})] })]);
    expect(summary).not.toHaveProperty("latencyMs");
    expect(summary).not.toHaveProperty("inputTokensPerDecision");
    expect(summary.score.mean).toBe(4);
  });
});

describe("perceptionOf", () => {
  it("says what each kind of policy gets to know, also under a latency suffix", () => {
    expect(perceptionOf("clef:clef-flash:json:choice:full")).toBe("now");
    expect(perceptionOf("clef:clef-flash:view:choice:full@latp350")).toBe("memory");
    expect(perceptionOf("clef:clef-flash:view-fx:choice:full")).toBe("forecast");
    expect(perceptionOf("clef:clef-flash:json-fx:choice:full")).toBe("forecast");
    expect(perceptionOf("rule-view-fx")).toBe("forecast (scripted)");
    expect(perceptionOf("lookahead-comp:300@lat300")).toBe("simulator");
    expect(perceptionOf("always-forward")).toBe("none");
  });
});

describe("compare and report", () => {
  it("pairs policies on the seeds both completed", () => {
    const byPolicy = new Map([
      ["a", [fixture({ seed: 1, score: 5 }), fixture({ seed: 2, score: 7 })]],
      ["b", [fixture({ seed: 2, score: 3 }), fixture({ seed: 3, score: 9 })]],
    ]);
    expect(compare("a", "b", byPolicy)).toMatchObject({ pairedSeeds: 1, diff: { estimate: 4 } });
    expect(compare("a", "missing", byPolicy)).toBeUndefined();
  });

  it("says better, worse or indistinguishable from the whole interval", () => {
    const interval = (lo: number, hi: number) => ({
      policy: "a",
      reference: "b",
      pairedSeeds: 10,
      diff: { estimate: (lo + hi) / 2, lo, hi },
    });
    expect(verdict(interval(0.5, 2))).toBe("better");
    expect(verdict(interval(-2, -0.5))).toBe("worse");
    expect(verdict(interval(-1, 1))).toBe("indistinguishable");
  });

  it("renders every section for real episodes", async () => {
    const episodes: EpisodeResult[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      episodes.push(await playEpisode(alwaysForward, seed), await playEpisode(randomPolicy, seed));
    }
    const text = renderReport("T", episodes, "always-forward");
    expect(text).toContain("| `always-forward` | none | 80 |");
    expect(text).toContain("## How episodes ended");
    expect(text).not.toContain("## Model calls"); // neither policy calls a model
    expect(text).toContain("Paired difference vs `always-forward`");
    expect(text).toMatch(/\| `random` \| 80 \| .* \| worse \|/);
  });
});
