import { applyDecision, type EpisodeResult } from "@ccr/agent";
import type { Action, Game } from "@ccr/core";
import { isPipelinedPolicyId } from "./latency.ts";

/**
 * Re-applies decision `index` of a stored episode to a game, under the same latency rules the run
 * used (the ticks it waited, serial or pipelined). Without that, an episode played with `--latency`
 * would be replayed on a different game than the one the policy actually saw.
 */
export function replayer(
  episode: EpisodeResult,
  decisionTicks: number,
): (game: Game, action: Action, index: number) => void {
  const pipelined = isPipelinedPolicyId(episode.policy);
  return (game, action, index) => {
    const waitedTicks = episode.records[index]?.waitedTicks ?? 0;
    applyDecision(game, action, { waitedTicks, pipelined, decisionTicks });
  };
}
