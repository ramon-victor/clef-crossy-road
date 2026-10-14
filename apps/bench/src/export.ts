import type { DecisionRecord, EpisodeResult } from "@ccr/agent";
import {
  type Action,
  DECISION_TICKS,
  type DeathCause,
  Game,
  type Observation,
  observe,
} from "@ccr/core";

/**
 * Reinforcement-learning trajectories (ADR-0006, Phase 5): every recorded decision becomes a
 * (observation, action, reward, done) step, re-created by replaying the stored actions on the
 * deterministic simulator. Nothing here calls any API: it only re-reads decisions already on disk.
 *
 * The observation obeys the fairness rule (physical facts only), so a model fine-tuned on these
 * steps learns from exactly what it would be shown when playing.
 */
export interface TrajectoryStep {
  policy: string;
  seed: number;
  step: number;
  observation: Observation;
  action: Action;
  /** Rows gained by this decision: +1 each time a new furthest row is reached, otherwise 0. */
  reward: number;
  /** The episode ended during this decision (the chicken died). */
  done: boolean;
  deathCause: DeathCause | null;
  /** Probabilities the original policy reported, if it was a model (useful for distillation). */
  probabilities?: Partial<Record<Action, number>>;
}

/** Policy ids get "@lat[p]..." appended by the bench; the "p" marks the pipelined latency model. */
export const isPipelined = (policyId: string): boolean => /@latp(\d+|rec)$/.test(policyId);

/**
 * Re-plays one stored decision exactly as `playEpisode` did: the world first runs for the ticks the
 * model took to answer (`waitedTicks`, latency injection), then the action is applied (pipelined: the
 * hop plays out during the next wait; serial: it plays out now). Without this, runs made with
 * `--latency` would be replayed on a different game than the one the policy actually saw.
 */
export function replayDecision(
  game: Game,
  action: Action,
  record: Pick<DecisionRecord, "waitedTicks"> | undefined,
  options: { decisionTicks: number; pipelined: boolean },
): void {
  const waited = record?.waitedTicks ?? 0;
  if (waited > 0) game.advance(waited);
  if (options.pipelined) game.act(action);
  else game.step(action, options.decisionTicks);
}

export interface ExportOptions {
  /** Keep only episodes whose score is at least this (e.g. to imitate the good ones). */
  minScore?: number;
  /** Keep only steps of this policy id. */
  policy?: string;
  decisionTicks?: number;
}

export function* trajectorySteps(
  episodes: readonly EpisodeResult[],
  options: ExportOptions = {},
): Generator<TrajectoryStep> {
  const ticks = options.decisionTicks ?? DECISION_TICKS;
  for (const episode of episodes) {
    if (options.policy && episode.policy !== options.policy) continue;
    if (options.minScore !== undefined && episode.score < options.minScore) continue;

    const game = new Game({ seed: episode.seed });
    const pipelined = isPipelined(episode.policy);
    let best = 0;
    for (let i = 0; i < episode.actions.length; i++) {
      const action = episode.actions[i] as Action;
      const observation = observe(game);
      replayDecision(game, action, episode.records[i], { decisionTicks: ticks, pipelined });
      const reward = Math.max(0, game.score - best);
      best = Math.max(best, game.score);
      const done = !game.alive;
      const probabilities = episode.records[i]?.probabilities;
      yield {
        policy: episode.policy,
        seed: episode.seed,
        step: i,
        observation,
        action,
        reward,
        done,
        deathCause: done ? game.deathCause : null,
        ...(probabilities ? { probabilities } : {}),
      };
    }
  }
}

export function toNdjson(steps: Iterable<TrajectoryStep>): { text: string; count: number } {
  const lines: string[] = [];
  for (const step of steps) lines.push(JSON.stringify(step));
  return { text: lines.length ? `${lines.join("\n")}\n` : "", count: lines.length };
}
