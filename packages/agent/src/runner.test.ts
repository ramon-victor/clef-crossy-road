import { DECISION_TICKS, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward, randomPolicy } from "./baselines.ts";
import type { Memory } from "./memory.ts";
import { constantPolicy } from "./policy.testing.ts";
import type { PolicyFactory } from "./policy.ts";
import { applyDecision, isPipelined, type LatencyModel, playEpisode } from "./runner.ts";

const stay = constantPolicy("stay");

/** The memory the runner gave the policy at each of its first `decisions` decisions. */
async function remembered(factory: PolicyFactory, seed: number, decisions: number) {
  const seen: Memory[] = [];
  const spy: PolicyFactory = {
    id: "spy",
    create: (s) => {
      const inner = factory.create(s);
      return {
        kind: "observation",
        id: "spy",
        decide: async (obs, memory) => {
          if (memory) seen.push(memory);
          return inner.kind === "observation" ? inner.decide(obs, memory) : { action: "stay" };
        },
      };
    },
  };
  await playEpisode(spy, seed, { maxDecisions: decisions, stallLimit: 0 });
  return seen;
}

describe("playEpisode", () => {
  it("replays exactly: same policy and seed give the same episode", async () => {
    const a = await playEpisode(randomPolicy, 11);
    expect(await playEpisode(randomPolicy, 11)).toEqual(a);
    expect((await playEpisode(randomPolicy, 12)).actions).not.toEqual(a.actions);
  });

  it("stops at maxDecisions and flags the episode as capped", async () => {
    const result = await playEpisode(stay, 3, { maxDecisions: 5 });
    expect(result).toMatchObject({ decisions: 5, capped: true, alive: true, score: 0 });
  });

  it("ends an episode that stops making progress (stall limit) instead of running to the cap", async () => {
    const stalled = await playEpisode(stay, 3, { stallLimit: 7 });
    expect(stalled).toMatchObject({ decisions: 7, stalled: true, capped: false });

    const off = await playEpisode(stay, 3, { stallLimit: 0, maxDecisions: 25 });
    expect(off).toMatchObject({ decisions: 25, stalled: false, capped: true });
  });

  it("does not count a stall while the policy keeps reaching new rows", async () => {
    const result = await playEpisode(alwaysForward, 9, { stallLimit: 1 });
    expect(result.stalled).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("tells the policy what it remembers: its moves, what they did, the score", async () => {
    const seen = await remembered(constantPolicy("hop_forward"), 3, 2);
    expect(seen[0]).toEqual({ recent: [], score: 0, sinceProgress: 0, behindFrontier: 0 });
    expect(seen[1]).toEqual({
      recent: [{ action: "hop_forward", outcome: "hop" }],
      score: 1,
      sinceProgress: 0,
      behindFrontier: 0,
    });
  });

  it("shows a policy that keeps bumping into a tree that its moves were blocked and that it is stuck", async () => {
    // Seed 1 has a tree to the right of the start, so every hop_right is blocked.
    const seen = await remembered(constantPolicy("hop_right"), 1, 4);
    const last = seen[3];
    expect(last?.recent.map((m) => m.outcome)).toEqual(["blocked", "blocked", "blocked"]);
    expect(last).toMatchObject({ score: 0, sinceProgress: 3 });
  });
});

describe("latency injection", () => {
  const options = { maxDecisions: 5, stallLimit: 0 };

  it("lets the world run between the observation and the action", async () => {
    expect((await playEpisode(stay, 3, options)).ticks).toBe(5 * 12);

    const slow = await playEpisode(stay, 3, { ...options, latency: { kind: "fixed", ms: 300 } });
    expect(slow.ticks).toBe(5 * (12 + 18)); // 300 ms = 18 ticks of world time per decision
    expect(slow.records.every((r) => r.waitedTicks === 18)).toBe(true);
  });

  it("recorded latency replays the latency stored with each answer", async () => {
    const stored = constantPolicy("stay", { latencyMs: 500 });
    const result = await playEpisode(stored, 3, {
      maxDecisions: 2,
      stallLimit: 0,
      latency: { kind: "recorded" },
    });
    expect(result.records.map((r) => r.waitedTicks)).toEqual([30, 30]); // 500 ms = 30 ticks
  });

  it("pipelined overlaps the hop with the wait: cadence is max(latency, hop), not the sum", async () => {
    const serial = await playEpisode(stay, 3, { ...options, latency: { kind: "fixed", ms: 300 } });
    const pipelined = await playEpisode(stay, 3, {
      ...options,
      latency: { kind: "fixed", ms: 300, pipelined: true },
    });
    expect(serial.ticks).toBe(5 * (18 + 12));
    expect(pipelined.ticks).toBe(5 * 18); // the 12-tick hop happens inside the 18-tick wait
  });

  it("pipelined always lets time advance, even with zero latency", async () => {
    const result = await playEpisode(stay, 3, {
      maxDecisions: 3,
      stallLimit: 0,
      latency: { kind: "fixed", ms: 0, pipelined: true },
    });
    expect(result.ticks).toBe(3);
  });

  it("a slow policy plays worse than the same policy answering instantly", async () => {
    let instant = 0;
    let slow = 0;
    for (let seed = 1; seed <= 60; seed++) {
      instant += (await playEpisode(randomPolicy, seed)).score;
      slow += (await playEpisode(randomPolicy, seed, { latency: { kind: "fixed", ms: 600 } }))
        .score;
    }
    expect(slow).toBeLessThan(instant);
  });
});

describe("applyDecision", () => {
  it.each<[string, LatencyModel | undefined]>([
    ["no latency", undefined],
    ["serial latency", { kind: "fixed", ms: 300 }],
    ["pipelined latency", { kind: "fixed", ms: 300, pipelined: true }],
  ])(
    "replaying the stored actions reproduces the game that was played (%s)",
    async (_name, latency) => {
      const episode = await playEpisode(randomPolicy, 21, latency ? { latency } : {});
      const game = new Game({ seed: 21 });
      const pipelined = isPipelined(latency);
      episode.actions.forEach((action, i) => {
        const waitedTicks = episode.records[i]?.waitedTicks ?? 0;
        applyDecision(game, action, { waitedTicks, pipelined, decisionTicks: DECISION_TICKS });
      });
      expect({
        tick: game.tick,
        score: game.score,
        alive: game.alive,
        cause: game.deathCause,
      }).toEqual({
        tick: episode.ticks,
        score: episode.score,
        alive: episode.alive,
        cause: episode.deathCause,
      });
    },
  );

  it("only a latency model that asks for it is pipelined", () => {
    expect(isPipelined(undefined)).toBe(false);
    expect(isPipelined({ kind: "none" })).toBe(false);
    expect(isPipelined({ kind: "fixed", ms: 100 })).toBe(false);
    expect(isPipelined({ kind: "recorded", pipelined: true })).toBe(true);
  });
});
