import { type EpisodeResult, type PolicyFactory, playEpisode } from "@ccr/agent";
import { type Action, DECISION_TICKS, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { auc, collectSamples, diagnose } from "./diagnose.ts";

describe("auc", () => {
  it("is 1 for a perfect predictor, 0 for an inverted one, 0.5 for no information", () => {
    expect(auc([0.9, 0.8], [0.2, 0.1])).toBe(1);
    expect(auc([0.1, 0.2], [0.8, 0.9])).toBe(0);
    expect(auc([0.5, 0.5], [0.5, 0.5])).toBe(0.5);
    expect(auc([0.9, 0.1], [0.5])).toBe(0.5);
  });

  it("is NaN when a class is empty", () => {
    expect(Number.isNaN(auc([], [0.1]))).toBe(true);
  });
});

/** A policy that reports a fixed P(hop_forward) and walks forward, so the samples are predictable. */
const forwardWith = (p: number): PolicyFactory => ({
  id: `fixed-${p}`,
  create: () => ({
    kind: "observation",
    id: `fixed-${p}`,
    decide: async () => ({
      action: "hop_forward" as Action,
      probabilities: { hop_forward: p },
    }),
  }),
});

describe("collectSamples", () => {
  it("replays each decision and labels it with what really happens on the simulator", async () => {
    const episodes: EpisodeResult[] = [];
    for (let seed = 1; seed <= 25; seed++) episodes.push(await playEpisode(forwardWith(0.6), seed));
    const samples = collectSamples(episodes);
    expect(samples.length).toBe(episodes.reduce((n, e) => n + e.records.length, 0));

    // Independent check on a few episodes: walking forward until death, the last forward hop is the fatal one.
    for (const e of episodes.filter((x) => !x.alive).slice(0, 8)) {
      const mine = samples.filter((s) => s.seed === e.seed);
      expect(mine.at(-1)?.forwardSafe).toBe(false);
      expect(mine.slice(0, -1).every((s) => s.forwardSafe)).toBe(true);

      const game = new Game({ seed: e.seed });
      for (let i = 0; i < e.actions.length - 1; i++)
        game.step(e.actions[i] as Action, DECISION_TICKS);
      const probe = game.clone();
      probe.step("hop_forward", DECISION_TICKS);
      expect(probe.alive).toBe(false);
    }
  });

  it("skips decisions without probabilities (baselines)", async () => {
    const plain: PolicyFactory = {
      id: "plain",
      create: () => ({
        kind: "observation",
        id: "plain",
        decide: async () => ({ action: "hop_forward" as Action }),
      }),
    };
    expect(collectSamples([await playEpisode(plain, 3)])).toEqual([]);
  });
});

describe("diagnose", () => {
  it("a policy with a constant probability has no information (AUC 0.5)", async () => {
    const episodes: EpisodeResult[] = [];
    for (let seed = 1; seed <= 60; seed++) episodes.push(await playEpisode(forwardWith(0.5), seed));
    const d = diagnose("fixed-0.5", collectSamples(episodes));
    expect(d.auc).toBe(0.5);
    expect(d.baseRateSafe).toBeGreaterThan(0.3);
    expect(d.baseRateSafe).toBeLessThan(1);
    expect(d.byTerrain.length).toBeGreaterThan(1);
  });
});
