import type { EpisodeResult } from "@ccr/agent";
import { DECISION_TICKS, Game, type RowKind } from "@ccr/core";
import { isPipelined, replayDecision } from "./export.ts";

/**
 * Does the model's P(hop_forward) carry any information about whether hopping forward is safe?
 * Every recorded decision is replayed on the simulator (episodes store their actions, and the
 * simulator is deterministic), and the model's probability is scored against what really happens.
 * This needs no API call: it only re-reads decisions already on disk.
 */
export interface Sample {
  policy: string;
  seed: number;
  index: number;
  pForward: number;
  /** Still alive after hopping forward from this state (a blocked hop counts as alive). */
  forwardSafe: boolean;
  /** Kind of the row the hop would enter. */
  ahead: RowKind | "unknown";
}

export function collectSamples(
  episodes: readonly EpisodeResult[],
  decisionTicks: number = DECISION_TICKS,
): Sample[] {
  const samples: Sample[] = [];
  for (const episode of episodes) {
    const game = new Game({ seed: episode.seed });
    const replay = { decisionTicks, pipelined: isPipelined(episode.policy) };
    episode.records.forEach((record, index) => {
      const pForward = record.probabilities?.hop_forward;
      if (pForward !== undefined && game.alive) {
        const probe = game.clone();
        replayDecision(probe, "hop_forward", record, replay);
        samples.push({
          policy: episode.policy,
          seed: episode.seed,
          index,
          pForward,
          forwardSafe: probe.alive,
          ahead: game.row(game.heroRow + 1)?.kind ?? "unknown",
        });
      }
      const action = episode.actions[index];
      if (action) replayDecision(game, action, record, replay);
    });
  }
  return samples;
}

/**
 * Area under the ROC curve (Mann-Whitney): the probability that a random positive scores higher
 * than a random negative, ties counting half. 0.5 means no information, 1 means perfect.
 */
export function auc(positives: readonly number[], negatives: readonly number[]): number {
  if (positives.length === 0 || negatives.length === 0) return Number.NaN;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  }
  return wins / (positives.length * negatives.length);
}

export interface Diagnosis {
  policy: string;
  decisions: number;
  baseRateSafe: number;
  meanPSafe: number;
  meanPUnsafe: number;
  auc: number;
  byTerrain: { kind: string; decisions: number; unsafe: number; auc: number }[];
}

export function diagnose(policy: string, samples: readonly Sample[]): Diagnosis {
  const mine = samples.filter((s) => s.policy === policy);
  const split = (list: readonly Sample[]) => ({
    safe: list.filter((s) => s.forwardSafe).map((s) => s.pForward),
    unsafe: list.filter((s) => !s.forwardSafe).map((s) => s.pForward),
  });
  const mean = (xs: readonly number[]) =>
    xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

  const all = split(mine);
  const kinds = [...new Set(mine.map((s) => s.ahead))].sort();
  return {
    policy,
    decisions: mine.length,
    baseRateSafe: all.safe.length / Math.max(1, mine.length),
    meanPSafe: mean(all.safe),
    meanPUnsafe: mean(all.unsafe),
    auc: auc(all.safe, all.unsafe),
    byTerrain: kinds.map((kind) => {
      const part = split(mine.filter((s) => s.ahead === kind));
      return {
        kind,
        decisions: part.safe.length + part.unsafe.length,
        unsafe: part.unsafe.length,
        auc: auc(part.safe, part.unsafe),
      };
    }),
  };
}

export function renderDiagnosis(list: readonly Diagnosis[]): string {
  const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");
  const lines = [
    "# Does P(hop_forward) predict that hopping forward is safe?",
    "",
    "AUC 0.5 = no information, 1.0 = perfect. 'Safe' = still alive after the hop, replayed on the simulator.",
    "",
    "| Policy | Decisions | Safe rate | mean P(fwd) when safe | when unsafe | AUC all |",
    "|---|---|---|---|---|---|",
  ];
  for (const d of list) {
    lines.push(
      `| \`${d.policy}\` | ${d.decisions} | ${f(d.baseRateSafe)} | ${f(d.meanPSafe, 3)} | ${f(d.meanPUnsafe, 3)} | **${f(d.auc, 3)}** |`,
    );
  }
  lines.push(
    "",
    "## By the terrain the hop would enter",
    "",
    "| Policy | Terrain | Decisions | Unsafe | AUC |",
    "|---|---|---|---|---|",
  );
  for (const d of list) {
    for (const t of d.byTerrain) {
      lines.push(`| \`${d.policy}\` | ${t.kind} | ${t.decisions} | ${t.unsafe} | ${f(t.auc, 3)} |`);
    }
  }
  lines.push(
    "",
    "_A within-terrain AUC needs both safe and unsafe examples; `n/a` means one class was empty. Samples come from each policy's own trajectories._",
  );
  return lines.join("\n");
}
