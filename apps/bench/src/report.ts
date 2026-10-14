import type { EpisodeResult } from "@ccr/agent";
import { code, fixed, markdownTable, percent } from "./format.ts";
import { bootstrapMean, bootstrapPairedDiff, mean, median, percentile } from "./stats.ts";

export interface PolicySummary {
  policy: string;
  episodes: number;
  score: { mean: number; lo: number; hi: number; median: number; p90: number; max: number };
  decisionsPerEpisode: number;
  invalidPerDecision: number;
  deaths: Record<string, number>;
  capped: number;
  latencyMs?: { p50: number; p95: number; n: number };
  inputTokensPerDecision?: number;
  neurons?: number;
  cacheHitRate?: number;
}

export function summarize(policy: string, episodes: readonly EpisodeResult[]): PolicySummary {
  const scores = episodes.map((e) => e.score);
  const ci = bootstrapMean(scores);
  const deaths: Record<string, number> = {};
  let decisions = 0;
  let invalid = 0;
  let capped = 0;
  for (const e of episodes) {
    const key = e.alive ? (e.stalled ? "stalled" : "capped") : (e.deathCause ?? "unknown");
    deaths[key] = (deaths[key] ?? 0) + 1;
    decisions += e.decisions;
    invalid += e.invalidMoves;
    if (e.capped) capped++;
  }

  const records = episodes.flatMap((e) => e.records);
  const fresh = records.filter((r) => r.cached === false && r.latencyMs !== undefined);
  const withTokens = records.filter((r) => r.inputTokens !== undefined);
  const cachedKnown = records.filter((r) => r.cached !== undefined);

  const summary: PolicySummary = {
    policy,
    episodes: episodes.length,
    score: {
      mean: ci.estimate,
      lo: ci.lo,
      hi: ci.hi,
      median: median(scores),
      p90: percentile(scores, 0.9),
      max: Math.max(...scores),
    },
    decisionsPerEpisode: decisions / Math.max(1, episodes.length),
    invalidPerDecision: invalid / Math.max(1, decisions),
    deaths,
    capped,
  };
  if (fresh.length > 0) {
    const latencies = fresh.map((r) => r.latencyMs as number);
    summary.latencyMs = {
      p50: median(latencies),
      p95: percentile(latencies, 0.95),
      n: latencies.length,
    };
  }
  if (withTokens.length > 0) {
    summary.inputTokensPerDecision = mean(withTokens.map((r) => r.inputTokens as number));
    summary.neurons = records.reduce((total, r) => total + (r.neurons ?? 0), 0);
  }
  if (cachedKnown.length > 0) {
    summary.cacheHitRate = cachedKnown.filter((r) => r.cached).length / cachedKnown.length;
  }
  return summary;
}

export interface Comparison {
  policy: string;
  reference: string;
  pairedSeeds: number;
  diff: { estimate: number; lo: number; hi: number };
}

/** Paired difference in score (policy minus reference) over the seeds both policies completed. */
export function compare(
  policy: string,
  reference: string,
  byPolicy: ReadonlyMap<string, readonly EpisodeResult[]>,
): Comparison | undefined {
  const a = byPolicy.get(policy);
  const b = byPolicy.get(reference);
  if (!a || !b) return undefined;
  const refScore = new Map(b.map((e) => [e.seed, e.score]));
  const seeds = a.filter((e) => refScore.has(e.seed)).sort((x, y) => x.seed - y.seed);
  if (seeds.length === 0) return undefined;
  const diff = bootstrapPairedDiff(
    seeds.map((e) => e.score),
    seeds.map((e) => refScore.get(e.seed) as number),
  );
  return { policy, reference, pairedSeeds: seeds.length, diff };
}

export function verdict(c: Comparison): string {
  if (c.diff.lo > 0) return "better";
  if (c.diff.hi < 0) return "worse";
  return "indistinguishable";
}

function groupByPolicy(episodes: readonly EpisodeResult[]): Map<string, EpisodeResult[]> {
  const byPolicy = new Map<string, EpisodeResult[]>();
  for (const e of episodes) {
    const list = byPolicy.get(e.policy) ?? [];
    list.push(e);
    byPolicy.set(e.policy, list);
  }
  return byPolicy;
}

const scoreSection = (summaries: readonly PolicySummary[]): string[] =>
  markdownTable(
    [
      "Policy",
      "Seeds",
      "Rows: mean [95% CI]",
      "Median",
      "p90",
      "Max",
      "Decisions/ep",
      "Invalid/decision",
    ],
    summaries.map((s) => [
      code(s.policy),
      s.episodes,
      `${fixed(s.score.mean)} [${fixed(s.score.lo)}, ${fixed(s.score.hi)}]`,
      fixed(s.score.median, 1),
      fixed(s.score.p90, 1),
      s.score.max,
      fixed(s.decisionsPerEpisode, 1),
      fixed(s.invalidPerDecision, 3),
    ]),
  );

const endingsSection = (summaries: readonly PolicySummary[]): string[] => [
  "## How episodes ended",
  "",
  ...markdownTable(
    ["Policy", "Water", "Car", "Train", "Out of bounds", "Stalled", "Capped"],
    summaries.map((s) => [
      code(s.policy),
      ...["water", "car", "train", "out_of_bounds", "stalled", "capped"].map((ending) =>
        percent(s.deaths[ending] ?? 0, s.episodes),
      ),
    ]),
  ),
  "",
  "_Stalled: no new furthest row for `stallLimit` decisions. Capped: reached `maxDecisions` while still making progress._",
];

function modelCallsSection(summaries: readonly PolicySummary[]): string[] {
  const models = summaries.filter((s) => s.inputTokensPerDecision !== undefined);
  if (models.length === 0) return [];
  return [
    "",
    "## Model calls",
    "",
    ...markdownTable(
      ["Policy", "Round trip p50 / p95 (ms)", "Input tokens/decision", "Neurons", "Cache hits"],
      models.map((s) => [
        code(s.policy),
        s.latencyMs
          ? `${fixed(s.latencyMs.p50, 0)} / ${fixed(s.latencyMs.p95, 0)} (n=${s.latencyMs.n})`
          : "all cached",
        fixed(s.inputTokensPerDecision ?? Number.NaN, 0),
        fixed(s.neurons ?? 0, 0),
        `${Math.round((s.cacheHitRate ?? 0) * 100)}%`,
      ]),
    ),
  ];
}

function pairedSection(
  summaries: readonly PolicySummary[],
  byPolicy: ReadonlyMap<string, readonly EpisodeResult[]>,
  reference: string | undefined,
): string[] {
  if (!reference || !byPolicy.has(reference)) return [];
  const comparisons = summaries
    .filter((s) => s.policy !== reference)
    .map((s) => compare(s.policy, reference, byPolicy))
    .filter((c): c is Comparison => c !== undefined);
  return [
    "",
    `## Paired difference vs \`${reference}\` (same seeds, 95% bootstrap CI of the mean)`,
    "",
    ...markdownTable(
      ["Policy", "Paired seeds", "Δ rows [95% CI]", "Verdict"],
      comparisons.map((c) => [
        code(c.policy),
        c.pairedSeeds,
        `${fixed(c.diff.estimate)} [${fixed(c.diff.lo)}, ${fixed(c.diff.hi)}]`,
        verdict(c),
      ]),
    ),
    "",
    '_Verdict: "better" only if the whole interval is above zero; "indistinguishable" if it contains zero._',
  ];
}

export function renderReport(
  title: string,
  episodes: readonly EpisodeResult[],
  reference: string | undefined,
): string {
  const byPolicy = groupByPolicy(episodes);
  const summaries = [...byPolicy].map(([policy, list]) => summarize(policy, list));
  return [
    `# ${title}`,
    "",
    ...scoreSection(summaries),
    "",
    ...endingsSection(summaries),
    ...modelCallsSection(summaries),
    ...pairedSection(summaries, byPolicy, reference),
    "",
  ].join("\n");
}
