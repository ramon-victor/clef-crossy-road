import { alwaysForward, lookaheadPolicy, playEpisode, randomPolicy } from "@ccr/agent";
import { DECISION_TICKS, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { toNdjson, trajectorySteps } from "./export.ts";

describe("trajectory export", () => {
  it("one step per recorded decision, with rewards that add up to the episode score", async () => {
    const episodes = [];
    for (let seed = 1; seed <= 20; seed++) episodes.push(await playEpisode(randomPolicy, seed));
    const steps = [...trajectorySteps(episodes)];
    expect(steps.length).toBe(episodes.reduce((n, e) => n + e.records.length, 0));

    for (const episode of episodes) {
      const mine = steps.filter((s) => s.seed === episode.seed);
      expect(mine.reduce((sum, s) => sum + s.reward, 0)).toBe(episode.score);
      expect(mine.map((s) => s.action)).toEqual(episode.actions);
      expect(mine.at(-1)?.done).toBe(!episode.alive);
      expect(mine.slice(0, -1).every((s) => !s.done)).toBe(true);
      if (!episode.alive) expect(mine.at(-1)?.deathCause).toBe(episode.deathCause);
    }
  });

  it("each observation is what the policy would have seen at that point", async () => {
    const episode = await playEpisode(alwaysForward, 5);
    const steps = [...trajectorySteps([episode])];
    const game = new Game({ seed: 5 });
    expect(steps[0]?.observation.player.col).toBe(0);
    game.step("hop_forward", DECISION_TICKS);
    expect(steps[1]?.observation.player.standing_on).toBe(game.row(game.heroRow)?.kind);
  });

  it("observations carry only the fairness-rule keys (no safety labels leak into training data)", async () => {
    const steps = [...trajectorySteps([await playEpisode(randomPolicy, 9)])];
    for (const s of steps) {
      expect(Object.keys(s.observation).sort()).toEqual(["player", "rows"]);
    }
    expect(JSON.stringify(steps)).not.toMatch(/safe|danger|collision|legal/i);
  });

  it("filters by minimum score and by policy", async () => {
    const episodes = [];
    for (let seed = 1; seed <= 15; seed++) {
      episodes.push(await playEpisode(lookaheadPolicy(3), seed));
      episodes.push(await playEpisode(alwaysForward, seed));
    }
    const good = [...trajectorySteps(episodes, { minScore: 10 })];
    expect(good.length).toBeGreaterThan(0);
    expect(new Set(good.map((s) => s.policy))).toEqual(new Set(["lookahead-3"]));
    const only = [...trajectorySteps(episodes, { policy: "always-forward" })];
    expect(new Set(only.map((s) => s.policy))).toEqual(new Set(["always-forward"]));
  });

  it("writes one JSON object per line", async () => {
    const { text, count } = toNdjson(trajectorySteps([await playEpisode(alwaysForward, 2)]));
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(count);
    expect(JSON.parse(lines[0] as string).seed).toBe(2);
    expect(toNdjson([]).text).toBe("");
  });
});
