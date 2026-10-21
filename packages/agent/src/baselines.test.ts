import { ACTIONS, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward, lookaheadPolicy, randomPolicy } from "./baselines.ts";
import type { PolicyFactory } from "./policy.ts";
import { playEpisode } from "./runner.ts";

async function meanScore(factory: PolicyFactory, seeds: number[]) {
  let total = 0;
  for (const seed of seeds) total += (await playEpisode(factory, seed)).score;
  return total / seeds.length;
}

const seeds = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe("baselines", () => {
  it("always-forward only ever hops forward", async () => {
    const result = await playEpisode(alwaysForward, 7);
    expect(new Set(result.actions)).toEqual(new Set(["hop_forward"]));
    expect(result.policy).toBe("always-forward");
  });

  // 180 full games: about 2 s here and on a busy CI runner, so it gets a 30 s budget.
  it("look-ahead is far better than the trivial baselines (it reads the simulator)", {
    timeout: 30_000,
  }, async () => {
    const [ahead, forward, random] = await Promise.all(
      [lookaheadPolicy(3), alwaysForward, randomPolicy].map((p) => meanScore(p, seeds(60))),
    );
    expect(ahead).toBeGreaterThan((forward as number) * 2);
    expect(forward).toBeGreaterThan(random as number);
  });
});

describe("look-ahead", () => {
  it("never walks into a death it could have avoided within its horizon", async () => {
    // If the chosen action kills at once, every alternative must kill too.
    const policy = lookaheadPolicy(3).create(0);
    if (policy.kind !== "oracle") throw new Error("expected an oracle");
    for (const seed of seeds(25)) {
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

  it("a latency-compensated look-ahead recovers most of what plain look-ahead loses to delay", async () => {
    const latency = { kind: "fixed", ms: 300 } as const;
    let plain = 0;
    let compensated = 0;
    for (const seed of seeds(40)) {
      plain += (await playEpisode(lookaheadPolicy(3), seed, { latency })).score;
      compensated += (await playEpisode(lookaheadPolicy(3, undefined, 300), seed, { latency }))
        .score;
    }
    expect(lookaheadPolicy(3, undefined, 300).id).toBe("lookahead-comp:300");
    // Compensation fixes the stale information, but the hero still idles on dangerous tiles while it
    // waits, which no prediction removes. So it helps clearly without restoring the no-latency score.
    expect(compensated).toBeGreaterThan(plain * 1.3);
  });
});
