import { type ClefPolicyConfig, decisionCost, parseClefPolicyId } from "@ccr/agent";
import { FREE_NEURONS_PER_DAY } from "@ccr/clef";
import { code, markdownTable } from "./format.ts";
import { isClefPolicy } from "./registry.ts";

/**
 * Budget planning. The owner's rule is to stay inside the free tier (10,000 neurons per UTC day),
 * so before spending anything we estimate what a run costs and how many days it needs.
 */
export interface Estimate {
  policy: string;
  usesApi: boolean;
  /** Input tokens per decision, or null for policies that never call the API. */
  tokensPerDecision: number | null;
  /** False when the token count is an estimate rather than a figure read back from the API. */
  measured: boolean;
  neuronsPerDecision: number;
  decisionsPerEpisode: number;
}

/**
 * Mean decisions per episode observed in the gate run (a policy that mostly hops forward dies early).
 * Critic episodes are shorter because the critic is more cautious near danger.
 */
function observedDecisionsPerEpisode({ encoder, strategy }: ClefPolicyConfig): number {
  // Not measured yet: a model that reads the words well lives much longer than one that always hops
  // forward, so the plan assumes long games (model calls per game) rather than short ones.
  // The route strategy plays long games and asks the model only when a manoeuvre ends (40 is an estimate).
  if (encoder === "scene") return 40;
  if (encoder === "lanes" || encoder === "moves")
    return strategy === "maneuver" || strategy === "graph-maneuver" ? 30 : 45;
  if (encoder === "image") return 5;
  if (strategy !== "choice") return 3.4;
  return encoder === "grid" ? 5 : 4.2;
}

export function estimatePolicy(id: string, decisionsOverride?: number): Estimate {
  if (!isClefPolicy(id)) {
    return {
      policy: id,
      usesApi: false,
      tokensPerDecision: null,
      measured: true,
      neuronsPerDecision: 0,
      decisionsPerEpisode: decisionsOverride ?? 1,
    };
  }
  const config = parseClefPolicyId(id);
  const cost = decisionCost(config);
  return {
    policy: id,
    usesApi: true,
    tokensPerDecision: cost.tokens,
    measured: cost.measured,
    neuronsPerDecision: cost.neurons,
    decisionsPerEpisode: decisionsOverride ?? observedDecisionsPerEpisode(config),
  };
}

export interface PlanInput {
  policies: string[];
  seeds: number[];
  spentToday: number;
  dailyLimit?: number;
  /** Fraction of each day's allowance left unused as a safety margin. Default 10%. */
  margin?: number;
  decisionsPerEpisode?: number;
}

export interface DayPlan {
  day: number;
  /** "today" or "+1 day" ... */
  label: string;
  seeds: number[];
  neurons: number;
}

export interface Plan {
  estimates: Estimate[];
  neuronsPerSeed: number;
  totalNeurons: number;
  remainingToday: number;
  fitsToday: boolean;
  days: DayPlan[];
  /** True if even one seed needs more than a whole day's usable allowance. */
  impossible: boolean;
}

const MAX_PLANNED_DAYS = 365;

const dayLabel = (day: number): string =>
  day === 0 ? "today" : `+${day} day${day > 1 ? "s" : ""}`;

/** Packs seeds into days: what is left of today first, then whole usable days. */
function scheduleDays(
  seeds: readonly number[],
  neuronsPerSeed: number,
  remainingToday: number,
  usablePerDay: number,
): DayPlan[] {
  if (neuronsPerSeed === 0) return [{ day: 0, label: "today", seeds: [...seeds], neurons: 0 }];
  const days: DayPlan[] = [];
  let next = 0;
  for (let day = 0; next < seeds.length && day <= MAX_PLANNED_DAYS; day++) {
    const count = Math.floor((day === 0 ? remainingToday : usablePerDay) / neuronsPerSeed);
    if (count === 0) continue;
    const chunk = seeds.slice(next, next + count);
    days.push({ day, label: dayLabel(day), seeds: chunk, neurons: chunk.length * neuronsPerSeed });
    next += chunk.length;
  }
  return days;
}

export function planRun(input: PlanInput): Plan {
  const limit = input.dailyLimit ?? FREE_NEURONS_PER_DAY;
  const usablePerDay = limit * (1 - (input.margin ?? 0.1));
  const estimates = input.policies.map((p) => estimatePolicy(p, input.decisionsPerEpisode));
  const neuronsPerSeed = estimates.reduce(
    (sum, e) => sum + e.neuronsPerDecision * e.decisionsPerEpisode,
    0,
  );
  const totalNeurons = neuronsPerSeed * input.seeds.length;
  const remainingToday = Math.max(0, usablePerDay - input.spentToday);
  const impossible = neuronsPerSeed > usablePerDay && neuronsPerSeed > 0;
  return {
    estimates,
    neuronsPerSeed,
    totalNeurons,
    remainingToday,
    fitsToday: !impossible && totalNeurons <= remainingToday,
    days: impossible ? [] : scheduleDays(input.seeds, neuronsPerSeed, remainingToday, usablePerDay),
    impossible,
  };
}

/** Compresses [1,2,3,7,8] into "1..3,7..8" for printing and for pasting into `--seeds`. */
export function formatSeeds(seeds: number[]): string {
  if (seeds.length === 0) return "(none)";
  const parts: string[] = [];
  let start = seeds[0] as number;
  let prev = start;
  for (const s of seeds.slice(1)) {
    if (s === prev + 1) {
      prev = s;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}..${prev}`);
    start = prev = s;
  }
  parts.push(start === prev ? `${start}` : `${start}..${prev}`);
  return parts.join(",");
}

export function renderPlan(
  plan: Plan,
  spentToday: number,
  dailyLimit = FREE_NEURONS_PER_DAY,
): string {
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const rows = plan.estimates.map((e) => [
    code(e.policy),
    e.tokensPerDecision === null ? "–" : `${e.tokensPerDecision}${e.measured ? "" : " (est.)"}`,
    e.usesApi ? e.neuronsPerDecision.toFixed(2) : "0 (no API)",
    e.decisionsPerEpisode,
    (e.neuronsPerDecision * e.decisionsPerEpisode).toFixed(1),
  ]);
  const lines = [
    `Budget today: ${f(spentToday)} / ${f(dailyLimit)} neurons spent (UTC). Usable remaining (10% margin): ${f(plan.remainingToday)}.`,
    "",
    ...markdownTable(
      ["Policy", "Tokens/decision", "Neurons/decision", "Decisions/seed", "Neurons/seed"],
      rows,
    ),
  ];
  lines.push(
    "",
    `Worst case (no cache hits): ${f(plan.neuronsPerSeed)} neurons per seed, ${f(plan.totalNeurons)} in total.`,
    plan.fitsToday
      ? "FITS TODAY inside the free tier."
      : plan.impossible
        ? "DOES NOT FIT: a single seed exceeds a whole day's allowance. Use fewer or cheaper policies."
        : `Does NOT fit today. Split it over ${plan.days.length} day(s):`,
  );
  if (!plan.fitsToday && !plan.impossible) {
    for (const d of plan.days) {
      lines.push(
        `  ${d.label.padEnd(9)} --seeds ${formatSeeds(d.seeds)}   (~${f(d.neurons)} neurons)`,
      );
    }
  }
  lines.push(
    "",
    "Cache hits are free, so replaying seeds already run costs nothing; this is an upper bound.",
  );
  return lines.join("\n");
}
