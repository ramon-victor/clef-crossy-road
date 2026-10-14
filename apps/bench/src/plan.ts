import { type ClefModel, FREE_NEURONS_PER_DAY, neuronsForTokens } from "@ccr/clef";

/**
 * Budget planning. The owner's rule is to stay inside the free tier (10,000 neurons per UTC day),
 * so before spending anything we estimate what a run costs and how many days it needs.
 *
 * Tokens per decision were measured on 2026-10-14 (docs/05). The image encoder has not been
 * measured yet and is a rough estimate, flagged as such.
 */
export interface Estimate {
  policy: string;
  usesApi: boolean;
  /** Input tokens per decision, or null for policies that never call the API. */
  tokensPerDecision: number | null;
  measured: boolean;
  neuronsPerDecision: number;
  decisionsPerEpisode: number;
}

/** Mean decisions per episode observed in the gate run (always-forward style play dies early). */
const DECISIONS_PER_EPISODE = { choice: 4.2, grid: 5, critic: 3.4, image: 5 } as const;

export function estimatePolicy(id: string, decisionsOverride?: number): Estimate {
  if (!id.startsWith("clef:")) {
    return {
      policy: id,
      usesApi: false,
      tokensPerDecision: null,
      measured: true,
      neuronsPerDecision: 0,
      decisionsPerEpisode: decisionsOverride ?? 1,
    };
  }
  const [, model, encoder, strategy] = id.split(":");
  let tokens = 1120;
  let measured = true;
  let decisions: number = DECISIONS_PER_EPISODE.choice;
  if (encoder === "grid") {
    tokens = 1320;
    decisions = DECISIONS_PER_EPISODE.grid;
  }
  if (strategy === "critic" || strategy === "critic-go") {
    tokens = 3070;
    decisions = DECISIONS_PER_EPISODE.critic;
  }
  if (encoder === "image") {
    tokens = 900; // ~159 image tokens + the instruction text; not measured yet
    measured = false;
    decisions = DECISIONS_PER_EPISODE.image;
  }
  return {
    policy: id,
    usesApi: true,
    tokensPerDecision: tokens,
    measured,
    neuronsPerDecision: neuronsForTokens(model as ClefModel, tokens),
    decisionsPerEpisode: decisionsOverride ?? decisions,
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

  const days: DayPlan[] = [];
  const impossible = neuronsPerSeed > usablePerDay && neuronsPerSeed > 0;
  if (neuronsPerSeed === 0) {
    days.push({ day: 0, label: "today", seeds: [...input.seeds], neurons: 0 });
  } else if (!impossible) {
    let index = 0;
    let day = 0;
    while (index < input.seeds.length) {
      const allowance = day === 0 ? remainingToday : usablePerDay;
      const count = Math.floor(allowance / neuronsPerSeed);
      if (count > 0) {
        const chunk = input.seeds.slice(index, index + count);
        days.push({
          day,
          label: day === 0 ? "today" : `+${day} day${day > 1 ? "s" : ""}`,
          seeds: chunk,
          neurons: chunk.length * neuronsPerSeed,
        });
        index += chunk.length;
      }
      day++;
      if (day > 365) break;
    }
  }
  return {
    estimates,
    neuronsPerSeed,
    totalNeurons,
    remainingToday,
    fitsToday: !impossible && totalNeurons <= remainingToday,
    days,
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
  const lines = [
    `Budget today: ${f(spentToday)} / ${f(dailyLimit)} neurons spent (UTC). Usable remaining (10% margin): ${f(plan.remainingToday)}.`,
    "",
    "| Policy | Tokens/decision | Neurons/decision | Decisions/seed | Neurons/seed |",
    "|---|---|---|---|---|",
  ];
  for (const e of plan.estimates) {
    const tokens =
      e.tokensPerDecision === null ? "–" : `${e.tokensPerDecision}${e.measured ? "" : " (est.)"}`;
    lines.push(
      `| \`${e.policy}\` | ${tokens} | ${e.usesApi ? e.neuronsPerDecision.toFixed(2) : "0 (no API)"} | ${e.decisionsPerEpisode} | ${(e.neuronsPerDecision * e.decisionsPerEpisode).toFixed(1)} |`,
    );
  }
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
