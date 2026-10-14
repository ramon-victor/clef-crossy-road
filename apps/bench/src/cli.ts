import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type LatencyModel, type PolicyFactory, PROMPT_VERSION } from "@ccr/agent";
import { ClefClient, FREE_NEURONS_PER_DAY } from "@ccr/clef";
import { createNodeTransport, FileBudget, FileCache } from "@ccr/clef/node";
import { collectSamples, diagnose, renderDiagnosis } from "./diagnose.ts";
import { toNdjson, trajectorySteps } from "./export.ts";
import { planRun, renderPlan } from "./plan.ts";
import { isClefPolicy, parsePolicy, parseSeeds } from "./registry.ts";
import { renderReport } from "./report.ts";
import { type RunMeta, readEpisodes, runEpisodes } from "./run.ts";

const USAGE = `Usage:
  pnpm bench run    --run <name> --policies <ids> --seeds <1..100> [options]
  pnpm bench report --run <name>[,<name>...] [--ref always-forward] [--out reports/<name>.md]
  pnpm bench plan   --policies <ids> --seeds <1..100> [--assume-decisions n]   (estimates neurons, no API call)
  pnpm bench diagnose --run <name>[,<name>...]            (does P(hop_forward) predict safety? reads files, no API call)
  pnpm bench export   --run <name>[,<name>...] [--policy <id>] [--min-score n]   (RL trajectories as NDJSON, no API call)

Policies: always-forward, random, lookahead, lookahead-<depth>,
          clef:<model>:<encoder>:<strategy>[:<manual>]   (model: clef-flash|clef|clef-omni,
          encoder: json|grid|image, strategy: choice|critic|critic-go, manual: full|minimal)

run options:
  --concurrency <n>      parallel episodes (default 1 for baselines, 4 when a Clef policy is used)
  --max-decisions <n>    cap per episode (default 300)
  --stall-limit <n>      end an episode after n decisions without a new furthest row (default 40, 0 = off)
  --decision-ticks <n>   world ticks after each action (default 12, one full hop)
  --latency <spec>       none | fixed:<ms> | recorded, optionally + ":pipelined". The world keeps running
                         while the model thinks. Serial: hero idles while waiting. Pipelined: the next
                         question is asked right after an action, so the hop overlaps the wait.
  --max-calls <n>        stop starting episodes after this many API calls (default 1500)
  --cache <file>         decision cache (default runs/cache/clef.ndjson)
  --daily-neurons <n>    LOWER the daily spending ceiling (default and maximum: the free tier,
                         ${FREE_NEURONS_PER_DAY} neurons per UTC day). Calls are refused locally, before being
                         sent, once the ledger in runs/cache/spend.ndjson reaches it. Cache hits are free.
  --root <dir>           where runs/ and reports/ live (default: current directory)
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      run: { type: "string" },
      policies: { type: "string" },
      seeds: { type: "string" },
      concurrency: { type: "string" },
      "max-decisions": { type: "string" },
      "stall-limit": { type: "string" },
      latency: { type: "string" },
      policy: { type: "string" },
      "min-score": { type: "string" },
      "assume-decisions": { type: "string" },
      "decision-ticks": { type: "string" },
      "max-calls": { type: "string" },
      cache: { type: "string" },
      "daily-neurons": { type: "string" },
      root: { type: "string" },
      ref: { type: "string" },
      out: { type: "string" },
      note: { type: "string" },
    },
    allowPositionals: false,
  });

  const root = resolve(values.root ?? ".");
  if (command === "plan") return planCommand(root, values as PlanValues);
  if (!command || !values.run) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }

  if (command === "run") return runCommand(root, values as RunValues);
  if (command === "report") return reportCommand(root, values as ReportValues);
  if (command === "diagnose") return diagnoseCommand(root, values as ReportValues);
  if (command === "export") return exportCommand(root, values as ExportValues);
  console.log(USAGE);
  process.exit(1);
}

interface ExportValues {
  run: string;
  "decision-ticks"?: string;
  policy?: string;
  "min-score"?: string;
  out?: string;
}

/** Writes RL trajectories (observation, action, reward, done) from recorded episodes. No API call. */
function exportCommand(root: string, v: ExportValues): void {
  const names = v.run.split(",").map((s) => s.trim());
  const episodes = names.flatMap((name) => readEpisodes(join(root, "runs", name)));
  const { text, count } = toNdjson(
    trajectorySteps(episodes, {
      ...(v.policy ? { policy: v.policy } : {}),
      ...(v["min-score"] ? { minScore: Number(v["min-score"]) } : {}),
      decisionTicks: intOption("decision-ticks", v["decision-ticks"], 12, 1),
    }),
  );
  if (count === 0) throw new Error("No steps matched; check --run, --policy and --min-score");
  const target = resolve(root, v.out ?? join("reports", `trajectories-${names.join("+")}.ndjson`));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, text);
  console.log(`${count} steps written to ${target}`);
}

/** Scores each model's P(hop_forward) against what really happens. Reads files only: no API call. */
function diagnoseCommand(root: string, v: ReportValues): void {
  const names = v.run.split(",").map((s) => s.trim());
  const episodes = names.flatMap((name) => readEpisodes(join(root, "runs", name)));
  const samples = collectSamples(episodes, intOption("decision-ticks", v["decision-ticks"], 12, 1));
  if (samples.length === 0) throw new Error("No decisions with probabilities found in those runs");
  const policies = [...new Set(samples.map((s) => s.policy))].sort();
  const text = renderDiagnosis(policies.map((p) => diagnose(p, samples)));
  console.log(text);
  const target = resolve(root, v.out ?? join("reports", `diagnose-${names.join("+")}.md`));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, text);
  console.log(`written to ${target}`);
}

interface PlanValues {
  policies?: string;
  seeds?: string;
  "assume-decisions"?: string;
}

/** Estimates the cost of a run and how to spread it over days. Makes no API call. */
function planCommand(root: string, v: PlanValues): void {
  if (!v.policies || !v.seeds) throw new Error("plan needs --policies and --seeds");
  const policies = v.policies.split(",").map((s) => s.trim());
  const seeds = parseSeeds(v.seeds);
  const budget = new FileBudget(
    resolve(root, "runs/cache/spend.ndjson"),
    FREE_NEURONS_PER_DAY,
    undefined,
    process.env.CF_ACCOUNT_ID,
  );
  const spent = budget.spentToday();
  const plan = planRun({
    policies,
    seeds,
    spentToday: spent,
    ...(v["assume-decisions"] ? { decisionsPerEpisode: Number(v["assume-decisions"]) } : {}),
  });
  console.log(renderPlan(plan, spent));
}

/** A non-negative integer option; NaN would silently turn a cap into "no cap" or an episode into nothing. */
function intOption(name: string, raw: string | undefined, fallback: number, min = 0): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(n) || n < min) {
    throw new Error(`Bad --${name} "${raw}": expected an integer >= ${min}`);
  }
  return n;
}

function parseLatency(spec: string | undefined): LatencyModel | undefined {
  if (!spec || spec === "none") return undefined;
  const pipelined = spec.endsWith(":pipelined");
  const base = pipelined ? spec.slice(0, -":pipelined".length) : spec;
  if (base === "recorded") return { kind: "recorded", ...(pipelined ? { pipelined } : {}) };
  const fixed = /^fixed:(\d+)$/.exec(base);
  if (fixed) return { kind: "fixed", ms: Number(fixed[1]), ...(pipelined ? { pipelined } : {}) };
  throw new Error(
    `Bad --latency "${spec}": use none, fixed:<ms>, recorded, optionally with :pipelined`,
  );
}

/** Result-id suffix that keeps different latency settings apart when runs are compared. */
function latencySuffix(latency: LatencyModel | undefined): string {
  if (!latency || latency.kind === "none") return "";
  const mode = latency.pipelined ? "p" : "";
  return latency.kind === "fixed" ? `@lat${mode}${latency.ms}` : `@lat${mode}rec`;
}

/** Keeps results with different latency settings apart when runs are compared. */
function withSuffix(factory: PolicyFactory, suffix: string): PolicyFactory {
  return suffix
    ? { id: `${factory.id}${suffix}`, create: (seed) => factory.create(seed) }
    : factory;
}

interface RunValues {
  run: string;
  policies?: string;
  seeds?: string;
  concurrency?: string;
  "max-decisions"?: string;
  "stall-limit"?: string;
  latency?: string;
  "decision-ticks"?: string;
  "max-calls"?: string;
  cache?: string;
  "daily-neurons"?: string;
  note?: string;
}

interface ReportValues {
  run: string;
  "decision-ticks"?: string;
  ref?: string;
  out?: string;
}

async function runCommand(root: string, v: RunValues): Promise<void> {
  if (!v.policies || !v.seeds) throw new Error("run needs --policies and --seeds");
  const ids = v.policies.split(",").map((s) => s.trim());
  const seeds = parseSeeds(v.seeds);

  let client: ClefClient | undefined;
  const concurrency = intOption("concurrency", v.concurrency, ids.some(isClefPolicy) ? 4 : 1, 1);
  // The ceiling can be lowered but never raised above the free tier from the command line.
  const requested = Number(v["daily-neurons"] ?? FREE_NEURONS_PER_DAY);
  const dailyNeurons = Math.min(Number.isFinite(requested) ? requested : 0, FREE_NEURONS_PER_DAY);
  const budget = new FileBudget(
    resolve(root, "runs/cache/spend.ndjson"),
    dailyNeurons,
    undefined,
    process.env.CF_ACCOUNT_ID,
  );
  const getClient = (): ClefClient => {
    client ??= new ClefClient({
      transport: createNodeTransport(),
      cache: new FileCache(resolve(root, v.cache ?? "runs/cache/clef.ndjson")),
      budget,
      concurrency,
    });
    return client;
  };
  const latency = parseLatency(v.latency);
  const suffix = latencySuffix(latency);
  const factories = ids.map((id) => withSuffix(parsePolicy(id, getClient), suffix));

  const episode = {
    decisionTicks: intOption("decision-ticks", v["decision-ticks"], 12, 1),
    maxDecisions: intOption("max-decisions", v["max-decisions"], 300, 1),
    stallLimit: intOption("stall-limit", v["stall-limit"], 40),
    ...(latency ? { latency } : {}),
  };
  const meta: RunMeta = {
    runId: v.run,
    createdAt: new Date().toISOString(),
    episode,
    promptVersion: PROMPT_VERSION,
    ...(v.note ? { note: v.note } : {}),
  };
  const runDir = join(root, "runs", v.run);
  console.log(`run ${v.run}: ${ids.length} policies x ${seeds.length} seeds -> ${runDir}`);
  if (ids.some(isClefPolicy)) {
    console.log(
      `budget: ${Math.round(budget.spentToday())} / ${dailyNeurons} neurons already spent today (UTC); ` +
        "cache hits are free, new calls are refused once the limit is reached",
    );
  }

  const summary = await runEpisodes(meta, {
    runDir,
    policies: factories,
    seeds,
    concurrency,
    episode,
    maxCalls: intOption("max-calls", v["max-calls"], 1500),
    client,
    log: (line) => console.log(line),
  });

  console.log(
    `finished: ${summary.completed} played, ${summary.skipped} already on disk, ${summary.failed} failed (${summary.stoppedBecause})`,
  );
  if (client) {
    const s = (client as ClefClient).stats();
    console.log(
      `api: ${s.calls} calls, ${s.cacheHits} cache hits, ${s.retries} retries, ${s.inputTokens} input tokens, ` +
        `${s.neurons.toFixed(0)} neurons (~US$ ${s.usd.toFixed(4)}), concurrency now ${(client as ClefClient).concurrencyLimit}`,
    );
    console.log(
      `budget: ${Math.round(budget.spentToday())} / ${dailyNeurons} neurons spent today (UTC)`,
    );
  }
  if (summary.fatal) {
    console.error(`STOPPED: ${summary.fatal}`);
    process.exitCode = 2;
  } else if (summary.stoppedBecause === "budget") {
    console.error(
      "STOPPED: reached --max-calls; re-run the same command to continue where it left off.",
    );
    process.exitCode = 3;
  }
}

function reportCommand(root: string, v: ReportValues): void {
  const names = v.run.split(",").map((s) => s.trim());
  const episodes = names.flatMap((name) => readEpisodes(join(root, "runs", name)));
  if (episodes.length === 0) throw new Error(`No episodes found for run(s): ${names.join(", ")}`);
  const text = renderReport(`Benchmark: ${names.join(" + ")}`, episodes, v.ref ?? "always-forward");
  console.log(text);
  const out = v.out ?? join("reports", `${names.join("+")}.md`);
  const target = resolve(root, out);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, text);
  console.log(`written to ${target}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
