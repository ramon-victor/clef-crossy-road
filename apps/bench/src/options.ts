import { parseArgs } from "node:util";
import { FREE_NEURONS_PER_DAY } from "@ccr/clef";

export const USAGE = `Usage:
  pnpm bench run    --run <name> --policies <ids> --seeds <1..100> [options]
  pnpm bench report --run <name>[,<name>...] [--ref always-forward] [--out reports/<name>.md]
  pnpm bench plan   --policies <ids> --seeds <1..100> [--assume-decisions n]   (estimates neurons, no API call)
  pnpm bench diagnose --run <name>[,<name>...]            (does P(hop_forward) predict safety? reads files, no API call)
  pnpm bench export   --run <name>[,<name>...] [--policy <id>] [--min-score n]   (RL trajectories as NDJSON, no API call)
  pnpm bench show-input   --seed <n> [--actions hop_forward,hop_left] [--policy <id>]   (the exact request a model would get for a state; sends nothing)
  pnpm bench probe-sample [--seeds 1..300] [--out file]    (pick ~90 labelled decision points from free games, no API call)
  pnpm bench probe-run    --run <name> --policies <ids> [--states file] [run options]   (one call per policy and state)
  pnpm bench probe-report --run <name>[,<name>...] [--ref <control id>]   (score the answers against the labels, no API call)

Policies: always-forward, random, lookahead, lookahead-<depth>, rule-view, rule-view-fx (scripted players
          that read the same view as the view / view-fx encoders: references, not models),
          clef   (the app's Clef: clef-flash, json, choice, full manual),
          clef:<model>:<encoder>:<strategy>[:<manual>]   (model: clef-flash|clef|clef-omni,
          encoder: json|json-rel|grid|image|view|view-fx|json-fx, strategy: choice|critic|critic-go, manual: full|minimal)

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

const stringOptions = [
  "run",
  "policies",
  "seeds",
  "concurrency",
  "max-decisions",
  "stall-limit",
  "latency",
  "policy",
  "min-score",
  "assume-decisions",
  "decision-ticks",
  "max-calls",
  "cache",
  "daily-neurons",
  "root",
  "states",
  "seed",
  "actions",
  "ref",
  "out",
  "note",
] as const;

const OPTIONS = Object.fromEntries(stringOptions.map((name) => [name, { type: "string" }])) as {
  [K in (typeof stringOptions)[number]]: { type: "string" };
};

export function parseCli(argv: string[]) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false });
  return { command, values };
}

export type CliValues = ReturnType<typeof parseCli>["values"];

/** NaN must never get through: it silently turns a cap into "no cap". */
function parseNumber(name: string, raw: string, min: number, integer: boolean): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min) {
    throw new Error(
      `Bad --${name} "${raw}": expected ${integer ? "an integer" : "a number"} >= ${min}`,
    );
  }
  return n;
}

export const intOption = (name: string, raw: string | undefined, fallback: number, min = 0) =>
  raw === undefined ? fallback : parseNumber(name, raw, min, true);

export const optionalIntOption = (name: string, raw: string | undefined, min = 0) =>
  raw === undefined ? undefined : parseNumber(name, raw, min, true);

export const optionalNumberOption = (name: string, raw: string | undefined, min = 0) =>
  raw === undefined ? undefined : parseNumber(name, raw, min, false);

/** Splits `a,b, c` into its trimmed parts. */
export const csv = (list: string): string[] => list.split(",").map((part) => part.trim());

/** The run names given with `--run`. */
export function runNames(values: CliValues): string[] {
  if (!values.run) throw new Error("--run <name> is required");
  return csv(values.run);
}
