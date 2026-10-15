import { describe, expect, it } from "vitest";
import { estimatePolicy, formatSeeds, planRun, renderPlan } from "./plan.ts";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("estimatePolicy: the words view", () => {
  it("is an estimate until a probe reads the real tokens, and assumes long games", () => {
    const rules = estimatePolicy("clef:clef-flash:lanes:choice:rules");
    expect(rules).toMatchObject({ measured: false, tokensPerDecision: 1260 });
    expect(rules.decisionsPerEpisode).toBeGreaterThanOrEqual(30);
    const maneuver = estimatePolicy("clef:clef-flash:lanes:maneuver:rules");
    expect(maneuver.tokensPerDecision).toBe(rules.tokensPerDecision);
    expect(maneuver.decisionsPerEpisode).toBeLessThan(rules.decisionsPerEpisode);
  });

  it("the scripted references cost nothing", () => {
    for (const id of ["rule-lanes", "exec-cross", "exec-rules"]) {
      expect(estimatePolicy(id).usesApi).toBe(false);
    }
  });
});

describe("estimatePolicy", () => {
  it("baselines cost nothing", () => {
    const e = estimatePolicy("always-forward");
    expect(e.usesApi).toBe(false);
    expect(e.neuronsPerDecision).toBe(0);
  });

  it("uses the measured tokens and the published neuron rates", () => {
    const flash = estimatePolicy("clef:clef-flash:json:choice:full");
    expect(flash.tokensPerDecision).toBe(1120);
    expect(flash.neuronsPerDecision).toBeCloseTo((1120 / 1e6) * 3454.5, 2);
    const big = estimatePolicy("clef:clef:json:choice:full");
    expect(big.neuronsPerDecision / flash.neuronsPerDecision).toBeCloseTo(6.32, 1);
    const critic = estimatePolicy("clef:clef-flash:json:critic-go:full");
    expect(critic.tokensPerDecision).toBe(3070);
  });

  it("flags what has not been measured, such as the critic with a picture", () => {
    expect(estimatePolicy("clef:clef-flash:image:choice:full")).toMatchObject({
      tokensPerDecision: 972,
      measured: true,
    });
    expect(estimatePolicy("clef:clef-flash:image:critic-go:full")).toMatchObject({
      tokensPerDecision: 3070,
      measured: false,
    });
  });

  it("takes the decisions per episode from the gate run unless told otherwise", () => {
    expect(estimatePolicy("clef:clef-flash:json:choice").decisionsPerEpisode).toBe(4.2);
    expect(estimatePolicy("clef:clef-flash:json:critic-go").decisionsPerEpisode).toBe(3.4);
    expect(estimatePolicy("clef:clef-flash:json:choice", 10).decisionsPerEpisode).toBe(10);
  });

  it("rejects an id that names no real policy, instead of guessing a price for it", () => {
    expect(() => estimatePolicy("clef:clef-flash:json:vote")).toThrow(/strategy/);
  });
});

describe("planRun", () => {
  it("fits a small run inside what is left today", () => {
    const plan = planRun({
      policies: ["clef:clef-flash:json:choice:full"],
      seeds: seeds(100),
      spentToday: 0,
    });
    expect(plan.fitsToday).toBe(true);
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0]?.seeds).toHaveLength(100);
  });

  it("refuses to plan anything today when the budget is already spent", () => {
    const plan = planRun({
      policies: ["clef:clef-flash:json:choice:full"],
      seeds: seeds(10),
      spentToday: 26_347,
    });
    expect(plan.fitsToday).toBe(false);
    expect(plan.remainingToday).toBe(0);
    expect(plan.days[0]?.label).not.toBe("today"); // nothing today: it starts on a later day
    expect(plan.days.flatMap((d) => d.seeds)).toEqual(seeds(10));
  });

  it("splits an expensive run over days, never exceeding a day's usable allowance", () => {
    const plan = planRun({
      policies: ["clef:clef:json:choice:full", "clef:clef-flash:json:critic-go:full"],
      seeds: seeds(100),
      spentToday: 4_000,
    });
    expect(plan.fitsToday).toBe(false);
    expect(plan.days.length).toBeGreaterThan(1);
    for (const d of plan.days) expect(d.neurons).toBeLessThanOrEqual(9_000 + 1e-6);
    expect(plan.days[0]?.neurons).toBeLessThanOrEqual(5_000 + 1e-6); // 9,000 usable minus 4,000 spent
    expect(plan.days.flatMap((d) => d.seeds)).toEqual(seeds(100)); // every seed scheduled exactly once
  });

  it("says so when a single seed is more than a whole day", () => {
    const plan = planRun({
      policies: ["clef:clef:json:choice:full"],
      seeds: seeds(5),
      spentToday: 0,
      decisionsPerEpisode: 100_000,
    });
    expect(plan.impossible).toBe(true);
    expect(plan.fitsToday).toBe(false);
    expect(renderPlan(plan, 0)).toContain("DOES NOT FIT");
  });

  it("a run of free policies always fits", () => {
    const plan = planRun({
      policies: ["random", "lookahead"],
      seeds: seeds(300),
      spentToday: 99_999,
    });
    expect(plan.fitsToday).toBe(true);
    expect(plan.totalNeurons).toBe(0);
  });
});

describe("formatSeeds", () => {
  it("compresses runs into ranges the CLI can parse back", () => {
    expect(formatSeeds([1, 2, 3, 7, 8, 12])).toBe("1..3,7..8,12");
    expect(formatSeeds([5])).toBe("5");
    expect(formatSeeds([])).toBe("(none)");
  });
});

describe("estimatePolicy: the route strategy", () => {
  it("is an estimate until a probe reads the tokens, and assumes long games", () => {
    const route = estimatePolicy("clef:clef-flash:scene:route:lookup");
    expect(route.measured).toBe(false);
    expect(route.tokensPerDecision).toBeGreaterThan(1000);
    expect(route.decisionsPerEpisode).toBeGreaterThanOrEqual(30);
    expect(estimatePolicy("exec-route").usesApi).toBe(false);
  });
});
