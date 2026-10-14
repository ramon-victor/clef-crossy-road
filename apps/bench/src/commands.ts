import { join, resolve } from "node:path";
import { DEFAULT_MAX_DECISIONS, DEFAULT_STALL_LIMIT, PROMPT_VERSION } from "@ccr/agent";
import { ClefClient, FREE_NEURONS_PER_DAY } from "@ccr/clef";
import { createNodeTransport, type FileBudget, FileCache } from "@ccr/clef/node";
import { DECISION_TICKS } from "@ccr/core";
import { collectSamples, diagnose, renderDiagnosis } from "./diagnose.ts";
import { toNdjson, trajectorySteps } from "./export.ts";
import { parseLatency, withLatencySuffix } from "./latency.ts";
import {
  type CliValues,
  csv,
  intOption,
  optionalIntOption,
  optionalNumberOption,
  runNames,
} from "./options.ts";
import { planRun, renderPlan } from "./plan.ts";
import { isClefPolicy, parsePolicy, parseSeeds } from "./registry.ts";
import { renderReport } from "./report.ts";
import { type RunMeta, runEpisodes } from "./run.ts";
import { CACHE_FILE, loadEpisodes, openBudget, runDir, writeOutput } from "./workspace.ts";

/** Exit codes of `run`, so a script can tell why it stopped. */
const EXIT_FATAL = 2;
const EXIT_CALL_CAP = 3;

const ticksOption = (v: CliValues): number =>
  intOption("decision-ticks", v["decision-ticks"], DECISION_TICKS, 1);

/** Prints a text report and saves it under `out`. */
function publish(root: string, out: string, text: string): void {
  console.log(text);
  console.log(`written to ${writeOutput(root, out, text)}`);
}

export function reportCommand(root: string, v: CliValues): void {
  const names = runNames(v);
  const episodes = loadEpisodes(root, names);
  if (episodes.length === 0) throw new Error(`No episodes found for run(s): ${names.join(", ")}`);
  const text = renderReport(`Benchmark: ${names.join(" + ")}`, episodes, v.ref ?? "always-forward");
  publish(root, v.out ?? join("reports", `${names.join("+")}.md`), text);
}

/** Scores each model's P(hop_forward) against what really happens. Reads files only: no API call. */
export function diagnoseCommand(root: string, v: CliValues): void {
  const names = runNames(v);
  const samples = collectSamples(loadEpisodes(root, names), ticksOption(v));
  if (samples.length === 0) throw new Error("No decisions with probabilities found in those runs");
  const policies = [...new Set(samples.map((s) => s.policy))].sort();
  const text = renderDiagnosis(policies.map((p) => diagnose(p, samples)));
  publish(root, v.out ?? join("reports", `diagnose-${names.join("+")}.md`), text);
}

/** Writes RL trajectories (observation, action, reward, done) from recorded episodes. No API call. */
export function exportCommand(root: string, v: CliValues): void {
  const names = runNames(v);
  const minScore = optionalIntOption("min-score", v["min-score"]);
  const { text, count } = toNdjson(
    trajectorySteps(loadEpisodes(root, names), {
      ...(v.policy ? { policy: v.policy } : {}),
      ...(minScore === undefined ? {} : { minScore }),
      decisionTicks: ticksOption(v),
    }),
  );
  if (count === 0) throw new Error("No steps matched; check --run, --policy and --min-score");
  const out = v.out ?? join("reports", `trajectories-${names.join("+")}.ndjson`);
  console.log(`${count} steps written to ${writeOutput(root, out, text)}`);
}

/** Estimates the cost of a run and how to spread it over days. Makes no API call. */
export function planCommand(root: string, v: CliValues): void {
  if (!v.policies || !v.seeds) throw new Error("plan needs --policies and --seeds");
  const spent = openBudget(root, FREE_NEURONS_PER_DAY).spentToday();
  const decisionsPerEpisode = optionalNumberOption("assume-decisions", v["assume-decisions"]);
  const plan = planRun({
    policies: csv(v.policies),
    seeds: parseSeeds(v.seeds),
    spentToday: spent,
    ...(decisionsPerEpisode === undefined ? {} : { decisionsPerEpisode }),
  });
  console.log(renderPlan(plan, spent));
}

/** Creates a value on first use, so runs made only of baselines never need credentials. */
function lazy<T>(create: () => T) {
  let value: T | undefined;
  return { get: (): T => (value ??= create()), created: (): T | undefined => value };
}

export async function runCommand(root: string, v: CliValues): Promise<void> {
  if (!v.run || !v.policies || !v.seeds) throw new Error("run needs --run, --policies and --seeds");
  const ids = csv(v.policies);
  const seeds = parseSeeds(v.seeds);
  const usesApi = ids.some(isClefPolicy);
  const concurrency = intOption("concurrency", v.concurrency, usesApi ? 4 : 1, 1);
  // The ceiling can be lowered but never raised above the free tier from the command line.
  const dailyNeurons = Math.min(
    intOption("daily-neurons", v["daily-neurons"], FREE_NEURONS_PER_DAY),
    FREE_NEURONS_PER_DAY,
  );
  const budget = openBudget(root, dailyNeurons);
  const client = lazy(
    () =>
      new ClefClient({
        transport: createNodeTransport(),
        cache: new FileCache(resolve(root, v.cache ?? CACHE_FILE)),
        budget,
        concurrency,
      }),
  );

  const latency = parseLatency(v.latency);
  const episode = {
    decisionTicks: ticksOption(v),
    maxDecisions: intOption("max-decisions", v["max-decisions"], DEFAULT_MAX_DECISIONS, 1),
    stallLimit: intOption("stall-limit", v["stall-limit"], DEFAULT_STALL_LIMIT),
    ...(latency ? { latency } : {}),
  };
  const meta: RunMeta = {
    runId: v.run,
    createdAt: new Date().toISOString(),
    episode,
    promptVersion: PROMPT_VERSION,
    ...(v.note ? { note: v.note } : {}),
  };
  const policies = ids.map((id) => withLatencySuffix(parsePolicy(id, client.get), latency));
  const dir = runDir(root, v.run);
  console.log(`run ${v.run}: ${ids.length} policies x ${seeds.length} seeds -> ${dir}`);
  if (usesApi) {
    console.log(
      `budget: ${Math.round(budget.spentToday())} / ${dailyNeurons} neurons already spent today (UTC); ` +
        "cache hits are free, new calls are refused once the limit is reached",
    );
  }

  const summary = await runEpisodes(meta, {
    runDir: dir,
    policies,
    seeds,
    concurrency,
    episode,
    maxCalls: intOption("max-calls", v["max-calls"], 1500),
    client: client.created(),
    log: (line) => console.log(line),
  });

  console.log(
    `finished: ${summary.completed} played, ${summary.skipped} already on disk, ${summary.failed} failed (${summary.stoppedBecause})`,
  );
  const used = client.created();
  if (used) printApiUsage(used, budget, dailyNeurons);
  if (summary.fatal) {
    console.error(`STOPPED: ${summary.fatal}`);
    process.exitCode = EXIT_FATAL;
  } else if (summary.stoppedBecause === "budget") {
    console.error(
      "STOPPED: reached --max-calls; re-run the same command to continue where it left off.",
    );
    process.exitCode = EXIT_CALL_CAP;
  }
}

function printApiUsage(client: ClefClient, budget: FileBudget, dailyNeurons: number): void {
  const s = client.stats();
  console.log(
    `api: ${s.calls} calls, ${s.cacheHits} cache hits, ${s.retries} retries, ${s.inputTokens} input tokens, ` +
      `${s.neurons.toFixed(0)} neurons (~US$ ${s.usd.toFixed(4)}), concurrency now ${client.concurrencyLimit}`,
  );
  console.log(
    `budget: ${Math.round(budget.spentToday())} / ${dailyNeurons} neurons spent today (UTC)`,
  );
}
