import type { EpisodeResult } from "@ccr/agent";
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

const f = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : "n/a");
const pct = (n: number, total: number) => `${((100 * n) / Math.max(1, total)).toFixed(0)}%`;

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

export function renderReport(
  title: string,
  episodes: readonly EpisodeResult[],
  reference: string | undefined,
): string {
  const byPolicy = new Map<string, EpisodeResult[]>();
  for (const e of episodes) {
    const list = byPolicy.get(e.policy) ?? [];
    list.push(e);
    byPolicy.set(e.policy, list);
  }
  const summaries = [...byPolicy.entries()].map(([policy, list]) => summarize(policy, list));

  const out: string[] = [`# ${title}`, ""];
  out.push(
    "| Policy | Seeds | Rows: mean [95% CI] | Median | p90 | Max | Decisions/ep | Invalid/decision |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    out.push(
      `| \`${s.policy}\` | ${s.episodes} | ${f(s.score.mean)} [${f(s.score.lo)}, ${f(s.score.hi)}] | ${f(s.score.median, 1)} | ${f(s.score.p90, 1)} | ${s.score.max} | ${f(s.decisionsPerEpisode, 1)} | ${f(s.invalidPerDecision, 3)} |`,
    );
  }

  out.push(
    "",
    "## How episodes ended",
    "",
    "| Policy | Water | Car | Train | Out of bounds | Stalled | Capped |",
    "|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    const d = s.deaths;
    out.push(
      `| \`${s.policy}\` | ${pct(d.water ?? 0, s.episodes)} | ${pct(d.car ?? 0, s.episodes)} | ${pct(d.train ?? 0, s.episodes)} | ${pct(d.out_of_bounds ?? 0, s.episodes)} | ${pct(d.stalled ?? 0, s.episodes)} | ${pct(d.capped ?? 0, s.episodes)} |`,
    );
  }
  out.push(
    "",
    "_Stalled: no new furthest row for `stallLimit` decisions. Capped: reached `maxDecisions` while still making progress._",
  );

  const modelRows = summaries.filter((s) => s.inputTokensPerDecision !== undefined);
  if (modelRows.length > 0) {
    out.push(
      "",
      "## Model calls",
      "",
      "| Policy | Round trip p50 / p95 (ms) | Input tokens/decision | Neurons | Cache hits |",
      "|---|---|---|---|---|",
    );
    for (const s of modelRows) {
      const lat = s.latencyMs
        ? `${f(s.latencyMs.p50, 0)} / ${f(s.latencyMs.p95, 0)} (n=${s.latencyMs.n})`
        : "all cached";
      out.push(
        `| \`${s.policy}\` | ${lat} | ${f(s.inputTokensPerDecision ?? Number.NaN, 0)} | ${f(s.neurons ?? 0, 0)} | ${pct(Math.round((s.cacheHitRate ?? 0) * 100), 100)} |`,
      );
    }
  }

  if (reference && byPolicy.has(reference)) {
    out.push(
      "",
      `## Paired difference vs \`${reference}\` (same seeds, 95% bootstrap CI of the mean)`,
      "",
      "| Policy | Paired seeds | Δ rows [95% CI] | Verdict |",
      "|---|---|---|---|",
    );
    for (const s of summaries) {
      if (s.policy === reference) continue;
      const c = compare(s.policy, reference, byPolicy);
      if (!c) continue;
      out.push(
        `| \`${s.policy}\` | ${c.pairedSeeds} | ${f(c.diff.estimate)} [${f(c.diff.lo)}, ${f(c.diff.hi)}] | ${verdict(c)} |`,
      );
    }
    out.push(
      "",
      '_Verdict: "better" only if the whole interval is above zero; "indistinguishable" if it contains zero._',
    );
  }
  out.push("");
  return out.join("\n");
}
