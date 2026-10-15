import { join, resolve } from "node:path";
import {
  DEFAULT_CLEF_ID,
  DEFAULT_MAX_DECISIONS,
  DEFAULT_STALL_LIMIT,
  PROMPT_VERSION,
} from "@ccr/agent";
import { ClefClient, FREE_NEURONS_PER_DAY } from "@ccr/clef";
import {
  CACHE_FILE,
  createNodeTransport,
  type FileBudget,
  FileCache,
  readNdjson,
} from "@ccr/clef/node";
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
import { type ProbeState, renderProbeReport, STRATA, sampleStates } from "./probe.ts";
import { PROBE_STATES_FILE, readProbeResults, runProbe } from "./probe-run.ts";
import { isClefPolicy, parsePolicy, parseSeeds } from "./registry.ts";
import { renderReport } from "./report.ts";
import { type RunMeta, runEpisodes } from "./run.ts";
import { parseActions, renderShownInput, showInput } from "./show-input.ts";
import { loadEpisodes, openBudget, runDir, writeOutput } from "./workspace.ts";

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

/** The ceiling can be lowered but never raised above the free tier from the command line. */
const dailyCeiling = (v: CliValues): number =>
  Math.min(
    intOption("daily-neurons", v["daily-neurons"], FREE_NEURONS_PER_DAY),
    FREE_NEURONS_PER_DAY,
  );

/** The only way these commands reach the API: through the client, the cache and the spend ledger. */
function apiClient(root: string, v: CliValues, budget: FileBudget, concurrency: number) {
  return lazy(
    () =>
      new ClefClient({
        transport: createNodeTransport(),
        cache: new FileCache(resolve(root, v.cache ?? CACHE_FILE)),
        budget,
        concurrency,
      }),
  );
}

export async function runCommand(root: string, v: CliValues): Promise<void> {
  if (!v.run || !v.policies || !v.seeds) throw new Error("run needs --run, --policies and --seeds");
  const ids = csv(v.policies);
  const seeds = parseSeeds(v.seeds);
  const usesApi = ids.some(isClefPolicy);
  const concurrency = intOption("concurrency", v.concurrency, usesApi ? 4 : 1, 1);
  const dailyNeurons = dailyCeiling(v);
  const budget = openBudget(root, dailyNeurons);
  const client = apiClient(root, v, budget, concurrency);

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

const PROBE_DIR = join("runs", "probe");

const asNdjson = (items: readonly unknown[]): string =>
  items
    .map(
      (item) => `${JSON.stringify(item)}
`,
    )
    .join("");

const statesPath = (root: string, v: CliValues): string =>
  resolve(root, v.states ?? join(PROBE_DIR, PROBE_STATES_FILE));

function loadProbeStates(root: string, v: CliValues): ProbeState[] {
  const states = readNdjson(statesPath(root, v)) as ProbeState[];
  if (states.length === 0) throw new Error("No probe states found; run `probe-sample` first");
  return states;
}

/** Picks the probe states from the games of the free players. Makes no API call. */
export async function probeSampleCommand(root: string, v: CliValues): Promise<void> {
  const seeds = parseSeeds(v.seeds ?? "1..300");
  const states = await sampleStates({ seeds });
  const out = v.out ?? join(PROBE_DIR, PROBE_STATES_FILE);
  console.log(`${states.length} states written to ${writeOutput(root, out, asNdjson(states))}`);
  for (const { id, quota } of STRATA) {
    const found = states.filter((s) => s.stratum === id).length;
    console.log(
      `  ${id.padEnd(13)} ${found}/${quota}${found < quota ? "  (fewer than wanted)" : ""}`,
    );
  }
}

/** Asks each policy about each probe state. Goes through the same client, cache and ledger as `run`. */
export async function probeRunCommand(root: string, v: CliValues): Promise<void> {
  if (!v.run || !v.policies) throw new Error("probe-run needs --run and --policies");
  const ids = csv(v.policies);
  const states = loadProbeStates(root, v);
  const usesApi = ids.some(isClefPolicy);
  const concurrency = intOption("concurrency", v.concurrency, usesApi ? 4 : 1, 1);
  const dailyNeurons = dailyCeiling(v);
  const budget = openBudget(root, dailyNeurons);
  const client = apiClient(root, v, budget, concurrency);
  const policies = ids.map((id) => parsePolicy(id, client.get));
  if (usesApi) {
    console.log(
      `budget: ${Math.round(budget.spentToday())} / ${dailyNeurons} neurons already spent today (UTC); ` +
        "cache hits are free, new calls are refused once the limit is reached",
    );
  }

  const summary = await runProbe({
    runDir: join(root, PROBE_DIR, v.run),
    states,
    policies,
    concurrency,
    maxCalls: intOption("max-calls", v["max-calls"], 400),
    client: client.created(),
    log: (line) => console.log(line),
  });
  console.log(
    `finished: ${summary.asked} answered, ${summary.skipped} already on disk, ${summary.failed} failed (${summary.stoppedBecause})`,
  );
  const used = client.created();
  if (used) printApiUsage(used, budget, dailyNeurons);
  if (summary.fatal) {
    console.error(`STOPPED: ${summary.fatal}`);
    process.exitCode = EXIT_FATAL;
  } else if (summary.stoppedBecause === "budget") {
    console.error("STOPPED: reached --max-calls; re-run the same command to continue.");
    process.exitCode = EXIT_CALL_CAP;
  }
}

/** Scores the recorded answers against the labels. Reads files only: no API call. */
export function probeReportCommand(root: string, v: CliValues): void {
  const names = runNames(v);
  const states = loadProbeStates(root, v);
  const results = names.flatMap((name) => readProbeResults(join(root, PROBE_DIR, name)));
  if (results.length === 0)
    throw new Error(`No probe answers found for run(s): ${names.join(", ")}`);
  const text = renderProbeReport(
    `Probe: ${names.join(" + ")}`,
    states,
    results,
    v.ref ?? "clef:clef-flash:json:choice:full",
  );
  publish(root, v.out ?? join("reports", `probe-${names.join("+")}.md`), text);
}

/** Prints the exact request a policy would send for a state. Nothing is sent, so no key is needed. */
export function showInputCommand(_root: string, v: CliValues): void {
  const offline = new ClefClient({
    transport: {
      post: async () => {
        throw new Error("show-input never sends anything");
      },
    },
  });
  const factory = parsePolicy(v.policy ?? DEFAULT_CLEF_ID, () => offline);
  const shown = showInput(factory, intOption("seed", v.seed, 1), parseActions(v.actions));
  console.log(renderShownInput(shown));
}
