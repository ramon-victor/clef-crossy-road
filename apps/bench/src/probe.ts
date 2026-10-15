import {
  actionValues,
  alwaysForward,
  emptyMemory,
  lanesState,
  lookaheadPolicy,
  type Memory,
  type PolicyFactory,
  parseClefPolicyId,
  randomPolicy,
  readLanes,
  readOrdered,
  remember,
  routeChoice,
  sceneState,
} from "@ccr/agent";
import { ACTIONS, type Action, createRng, Game, observe, type RowKind } from "@ccr/core";
import { auc } from "./diagnose.ts";
import { code, fixed, markdownTable } from "./format.ts";
import { bootstrapPairedDiff, mean } from "./stats.ts";

/**
 * A probe asks a policy about hand-picked decision points instead of playing whole games: about a
 * tenth of the cost, and it says where a view helps. The states are sampled from the games of three
 * free players, and each one carries labels worked out on the simulator. The labels only mark the
 * answers; they are never part of what a model reads.
 */
export type Outcome = "dies" | "blocked" | "ok";

export const STRATA = [
  { id: "water-deadly", quota: 24, about: "water ahead, hopping forward drowns" },
  { id: "water-open", quota: 12, about: "water ahead, a platform is under the column" },
  { id: "road-deadly", quota: 12, about: "road ahead, a vehicle is there when the hop lands" },
  { id: "road-open", quota: 8, about: "road ahead, it is clear" },
  { id: "tree", quota: 10, about: "a tree straight ahead (first time)" },
  { id: "tree-stuck", quota: 10, about: "the same tree after 1 or 3 bumps, so the memory says so" },
  { id: "grass-open", quota: 8, about: "open grass ahead" },
  { id: "rail", quota: 6, about: "rail ahead" },
] as const;

export type Stratum = (typeof STRATA)[number]["id"];

/** Hops that the stuck states have already bumped, cycling through these. */
const BUMPS = [1, 3] as const;

/** A good move is one the look-ahead rates within one row of the best (a row is worth 10). */
const GOOD_MARGIN = 10;

const PROBE_DOMAIN = 0x50524f42; // "PROB": independent of every game stream

export interface ProbeState {
  id: string;
  stratum: Stratum;
  seed: number;
  /** Full hops played from the start (decision-length steps) to reach the state. */
  actions: Action[];
  /** What each action does here on the simulator. Labels, never shown to a model. */
  outcomes: Record<Action, Outcome>;
  /** The actions the look-ahead rates within a row of the best one. Labels. */
  good: Action[];
}

/** The world and the memory of a probe state, rebuilt by replaying its actions. */
export function rebuild(state: Pick<ProbeState, "seed" | "actions">): {
  game: Game;
  memory: Memory;
} {
  const game = new Game({ seed: state.seed });
  let memory = emptyMemory();
  for (const action of state.actions) {
    const { outcome } = game.step(action);
    memory = remember(memory, { action, outcome }, game.score, game.heroRow);
  }
  return { game, memory };
}

function outcomesAt(game: Game): Record<Action, Outcome> {
  const outcomes = {} as Record<Action, Outcome>;
  for (const action of ACTIONS) {
    const probe = game.clone();
    const { outcome } = probe.step(action);
    outcomes[action] = outcome === "blocked" ? "blocked" : probe.alive ? "ok" : "dies";
  }
  return outcomes;
}

export function classify(ahead: RowKind | undefined, forward: Outcome): Stratum | undefined {
  switch (ahead) {
    case "water":
      return forward === "dies" ? "water-deadly" : "water-open";
    case "road":
      return forward === "dies" ? "road-deadly" : "road-open";
    case "rail":
      return "rail";
    case "grass":
      return forward === "blocked" ? "tree" : forward === "ok" ? "grass-open" : undefined;
    default:
      return undefined;
  }
}

interface Candidate {
  stratum: Stratum;
  seed: number;
  actions: Action[];
  outcomes: Record<Action, Outcome>;
}

const FREE_PLAYERS: readonly PolicyFactory[] = [alwaysForward, randomPolicy, lookaheadPolicy()];

/** Every decision point the free players reach on these seeds, sorted into strata. */
async function candidatesFor(seeds: readonly number[], maxDecisions: number): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const factory of FREE_PLAYERS) {
    for (const seed of seeds) {
      const game = new Game({ seed });
      const policy = factory.create(seed);
      const actions: Action[] = [];
      let memory = emptyMemory();
      for (let i = 0; i < maxDecisions && game.alive; i++) {
        const outcomes = outcomesAt(game);
        const stratum = classify(game.row(game.heroRow + 1)?.kind, outcomes.hop_forward);
        if (stratum) found.push({ stratum, seed, actions: [...actions], outcomes });
        const decision =
          policy.kind === "oracle"
            ? await policy.decide(game)
            : await policy.decide(observe(game), memory);
        const { outcome } = game.step(decision.action);
        actions.push(decision.action);
        memory = remember(memory, { action: decision.action, outcome }, game.score, game.heroRow);
      }
    }
  }
  return found;
}

/** The first candidate of each seed, in the order given. */
function onePerSeed(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<number>();
  return candidates.filter((c) => {
    if (seen.has(c.seed)) return false;
    seen.add(c.seed);
    return true;
  });
}

function shuffled<T>(items: readonly T[], rng: ReturnType<typeof createRng>): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Bumps into the tree ahead `count` times, so the state has the memory of having been stuck. */
function bumped(candidate: Candidate, count: number): Candidate {
  const actions = [...candidate.actions, ...Array<Action>(count).fill("hop_forward")];
  const { game } = rebuild({ seed: candidate.seed, actions });
  return { ...candidate, stratum: "tree-stuck", actions, outcomes: outcomesAt(game) };
}

function labelled(candidate: Candidate): Omit<ProbeState, "id"> {
  const { game } = rebuild(candidate);
  const values = actionValues(game);
  const best = Math.max(...Object.values(values));
  const good = ACTIONS.filter((a) => {
    const value = values[a];
    return value !== undefined && value >= best - GOOD_MARGIN;
  });
  return {
    stratum: candidate.stratum,
    seed: candidate.seed,
    actions: candidate.actions,
    outcomes: candidate.outcomes,
    good,
  };
}

export interface SampleOptions {
  seeds: readonly number[];
  /** Decisions followed per game when collecting decision points. */
  maxDecisions?: number;
  /** Replaces the default quota of a stratum (tests use small ones). */
  quotas?: Partial<Record<Stratum, number>>;
  /** Picks which of the candidates are kept. The same value gives the same states. */
  pickSeed?: number;
}

/**
 * A fixed-size, stratified, deterministic sample of decision points: the same seeds and options give
 * the same states, at most one per seed in each stratum so they do not all look alike.
 */
export async function sampleStates(options: SampleOptions): Promise<ProbeState[]> {
  const rng = createRng(options.pickSeed ?? 1, 0, PROBE_DOMAIN);
  const candidates = await candidatesFor(options.seeds, options.maxDecisions ?? 60);
  const quota = (id: Stratum): number =>
    options.quotas?.[id] ?? (STRATA.find((s) => s.id === id)?.quota as number);

  const chosen: Candidate[] = [];
  for (const { id } of STRATA) {
    const stuck = id === "tree-stuck";
    // Both tree strata come from the same candidates; the stuck ones skip the seeds already used.
    const usedSeeds = new Set(chosen.filter((c) => c.stratum === "tree").map((c) => c.seed));
    const pool = onePerSeed(
      shuffled(
        candidates.filter(
          (c) => c.stratum === (stuck ? "tree" : id) && !(stuck && usedSeeds.has(c.seed)),
        ),
        rng,
      ),
    ).slice(0, quota(id));
    chosen.push(
      ...(stuck ? pool.map((c, i) => bumped(c, BUMPS[i % BUMPS.length] as number)) : pool),
    );
  }
  const counts = new Map<Stratum, number>();
  return chosen.map((candidate) => {
    const n = (counts.get(candidate.stratum) ?? 0) + 1;
    counts.set(candidate.stratum, n);
    return { id: `${candidate.stratum}-${n}`, ...labelled(candidate) };
  });
}

export interface ProbeResult {
  policy: string;
  state: string;
  action: Action;
  probabilities?: Partial<Record<Action, number>>;
  inputTokens?: number;
  neurons?: number;
  cached?: boolean;
  /** The manoeuvre a route policy chose (the action is only its first step). */
  maneuver?: string;
  /** What the route policy answered to each of its questions. */
  extra?: Record<string, unknown>;
}

/**
 * The states in an order where any prefix covers every stratum: the first of each, then the second of
 * each, and so on. A run that stops early (a call cap, an empty budget) still has a balanced sample.
 */
export function interleaveStrata<T extends { stratum: Stratum }>(states: readonly T[]): T[] {
  const lanes = STRATA.map(({ id }) => states.filter((s) => s.stratum === id));
  const longest = Math.max(0, ...lanes.map((lane) => lane.length));
  return Array.from({ length: longest }, (_, i) => lanes.flatMap((lane) => lane[i] ?? [])).flat();
}

const massOn = (
  probabilities: Partial<Record<Action, number>>,
  pick: (action: Action) => boolean,
): number => ACTIONS.reduce((sum, a) => sum + (pick(a) ? (probabilities[a] ?? 0) : 0), 0);

/** How one answer fares against the labels of its state. */
export function scoreAnswer(state: ProbeState, result: ProbeResult) {
  const probabilities = result.probabilities;
  return {
    fatal: state.outcomes[result.action] === "dies",
    good: state.good.includes(result.action),
    bumped: state.outcomes[result.action] === "blocked",
    forward: result.action === "hop_forward",
    // How much of the model's own distribution sits on dying moves and on good ones: what sampling
    // from it, instead of taking its top answer, would do.
    deathMass: probabilities
      ? massOn(probabilities, (a) => state.outcomes[a] === "dies")
      : undefined,
    goodMass: probabilities ? massOn(probabilities, (a) => state.good.includes(a)) : undefined,
  };
}

const rate = (flags: readonly boolean[]): number =>
  flags.length === 0 ? Number.NaN : flags.filter(Boolean).length / flags.length;

const pct = (value: number): string =>
  Number.isNaN(value) ? "n/a" : `${Math.round(value * 100)}%`;

const WATER: readonly Stratum[] = ["water-deadly", "water-open"];

export interface ProbeSummary {
  policy: string;
  stratum: Stratum | "water";
  n: number;
  fatal: number;
  good: number;
  bumped: number;
  /** Mean probability the model put on dying moves / on good moves (NaN without probabilities). */
  deathMass: number;
  goodMass: number;
}

export function summarizeProbe(
  states: readonly ProbeState[],
  results: readonly ProbeResult[],
): ProbeSummary[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  const policies = [...new Set(results.map((r) => r.policy))].sort();
  const rows: ProbeSummary[] = [];
  const groups: Array<[ProbeSummary["stratum"], readonly Stratum[]]> = [
    ...STRATA.map((s): [Stratum, readonly Stratum[]] => [s.id, [s.id]]),
    ["water", WATER],
  ];
  for (const policy of policies) {
    for (const [stratum, members] of groups) {
      const scored = results
        .filter((r) => r.policy === policy)
        .flatMap((r) => {
          const state = byId.get(r.state);
          return state && members.includes(state.stratum) ? [scoreAnswer(state, r)] : [];
        });
      if (scored.length === 0) continue;
      rows.push({
        policy,
        stratum,
        n: scored.length,
        fatal: rate(scored.map((s) => s.fatal)),
        good: rate(scored.map((s) => s.good)),
        bumped: rate(scored.map((s) => s.bumped)),
        deathMass: mean(scored.flatMap((s) => (s.deathMass === undefined ? [] : [s.deathMass]))),
        goodMass: mean(scored.flatMap((s) => (s.goodMass === undefined ? [] : [s.goodMass]))),
      });
    }
  }
  return rows;
}

/** Paired difference in the share of good moves (policy minus control) over the same states. */
export function pairedGood(
  states: readonly ProbeState[],
  results: readonly ProbeResult[],
  policy: string,
  control: string,
  members: readonly Stratum[],
) {
  const byId = new Map(states.map((s) => [s.id, s]));
  const answer = (p: string) =>
    new Map(results.filter((r) => r.policy === p).map((r) => [r.state, r]));
  const mine = answer(policy);
  const theirs = answer(control);
  const ids = states.filter(
    (s) => members.includes(s.stratum) && mine.has(s.id) && theirs.has(s.id),
  );
  const flags = (from: Map<string, ProbeResult>) =>
    ids.map((s) =>
      scoreAnswer(byId.get(s.id) as ProbeState, from.get(s.id) as ProbeResult).good ? 1 : 0,
    );
  return { n: ids.length, diff: bootstrapPairedDiff(flags(mine), flags(theirs)) };
}

/**
 * Does P(hop_forward) tell the states where forward is fine from the states where it dies? 0.5 means
 * no information (the same measure `bench diagnose` uses on whole games).
 */
export function forwardAuc(
  states: readonly ProbeState[],
  results: readonly ProbeResult[],
  policy: string,
  members: readonly Stratum[],
): number {
  const byId = new Map(states.map((s) => [s.id, s]));
  const safe: number[] = [];
  const unsafe: number[] = [];
  for (const r of results) {
    const state = byId.get(r.state);
    const p = r.probabilities?.hop_forward;
    if (r.policy !== policy || !state || p === undefined || !members.includes(state.stratum)) {
      continue;
    }
    (state.outcomes.hop_forward === "dies" ? unsafe : safe).push(p);
  }
  return auc(safe, unsafe);
}

/**
 * What the ideal follower of a words condition would pick in this state: `readLanes` for the `lanes` view,
 * `readOrdered` for the `moves` view. Undefined for every other policy, and for the manoeuvre strategy (the
 * first step of a manoeuvre is not the move it was chosen as).
 */
export function idealMove(policy: string, state: ProbeState): Action | undefined {
  if (!policy.startsWith("clef:")) return undefined;
  const config = parseClefPolicyId(policy);
  if (config.strategy === "maneuver") return undefined;
  if (config.encoder !== "lanes" && config.encoder !== "moves") return undefined;
  const { game, memory } = rebuild(state);
  const words = lanesState(observe(game), memory);
  return config.encoder === "lanes" ? readLanes(words) : readOrdered(words);
}

/**
 * How often the model picks the move the ideal follower of the written rules would pick. It measures
 * obedience to the rules, not skill: the rules are ours (ADR-0010).
 */
/**
 * What the ideal follower of the options would pick and what the policy picked, as comparable words: a move
 * for the words views, a manoeuvre for the route strategy. Undefined for any other policy.
 */
function idealAndChosen(
  policy: string,
  state: ProbeState,
  result: ProbeResult,
): { ideal: string; chosen: string } | undefined {
  if (policy.startsWith("clef:") && parseClefPolicyId(policy).strategy === "route") {
    if (result.maneuver === undefined) return undefined;
    const { game, memory } = rebuild(state);
    return {
      ideal: routeChoice(sceneState(observe(game), memory)),
      chosen: result.maneuver,
    };
  }
  const ideal = idealMove(policy, state);
  return ideal === undefined ? undefined : { ideal, chosen: result.action };
}

export function agreementWithWords(
  states: readonly ProbeState[],
  results: readonly ProbeResult[],
  policy: string,
): { n: number; agree: number; byStratum: Map<Stratum, [number, number]> } | undefined {
  const byId = new Map(states.map((s) => [s.id, s]));
  const byStratum = new Map<Stratum, [number, number]>();
  let n = 0;
  let agree = 0;
  for (const r of results) {
    const state = byId.get(r.state);
    if (r.policy !== policy || !state) continue;
    const pair = idealAndChosen(policy, state, r);
    if (pair === undefined) return undefined;
    const same = pair.ideal === pair.chosen;
    n++;
    if (same) agree++;
    const cell = byStratum.get(state.stratum) ?? [0, 0];
    cell[0]++;
    if (same) cell[1]++;
    byStratum.set(state.stratum, cell);
  }
  return n === 0 ? undefined : { n, agree, byStratum };
}

export function renderProbeReport(
  title: string,
  states: readonly ProbeState[],
  results: readonly ProbeResult[],
  control: string,
): string {
  const summary = summarizeProbe(states, results);
  const policies = [...new Set(results.map((r) => r.policy))].sort();
  const sections = [`# ${title}`, ""];

  sections.push(
    "Each row is a policy's answer on states with known outcomes. **fatal** = the move chosen dies; " +
      "**good** = the move chosen is one the look-ahead rates within a row of the best; " +
      "**bumped** = the move chosen runs into a tree again. " +
      "**P(dies)** and **P(good)** are the share of the model's own probabilities on dying and on good " +
      "moves, which is what sampling from its distribution would give instead of taking its top answer.",
    "",
    ...markdownTable(
      ["Policy", "Stratum", "States", "Fatal", "Good", "Bumped", "P(dies)", "P(good)"],
      summary.map((r) => [
        code(r.policy),
        r.stratum,
        r.n,
        pct(r.fatal),
        pct(r.good),
        pct(r.bumped),
        pct(r.deathMass),
        pct(r.goodMass),
      ]),
    ),
    "",
    "## Does P(hop_forward) tell open states from deadly ones? (AUC, 0.5 = no information)",
    "",
    ...markdownTable(
      ["Policy", "Water", "Road"],
      policies.map((policy) => [
        code(policy),
        fixed(forwardAuc(states, results, policy, WATER), 2),
        fixed(forwardAuc(states, results, policy, ["road-deadly", "road-open"]), 2),
      ]),
    ),
  );

  const followers = policies.flatMap((policy) => {
    const found = agreementWithWords(states, results, policy);
    return found ? [{ policy, ...found }] : [];
  });
  if (followers.length > 0) {
    sections.push(
      "",
      "## Does it pick the move the written rules give? (agreement with the ideal follower of the words)",
      "",
      "Obedience to our rules, not skill; only for the conditions that read the words.",
      "",
      ...markdownTable(
        ["Policy", "States", "Agree", ...STRATA.map((s) => s.id)],
        followers.map(({ policy, n, agree, byStratum }) => [
          code(policy),
          n,
          pct(agree / n),
          ...STRATA.map((s) => {
            const cell = byStratum.get(s.id);
            return cell ? `${cell[1]}/${cell[0]}` : "n/a";
          }),
        ]),
      ),
    );
  }

  const others = policies.filter((p) => p !== control);
  if (policies.includes(control) && others.length > 0) {
    const groups: Array<[string, readonly Stratum[]]> = [
      ["water", WATER],
      ["tree-stuck", ["tree-stuck"]],
      ["all", STRATA.map((s) => s.id)],
    ];
    sections.push(
      "",
      `## Share of good moves, paired against ${code(control)} (95% bootstrap CI)`,
      "",
      ...markdownTable(
        ["Policy", "Strata", "States", "Δ good [95% CI]"],
        others.flatMap((policy) =>
          groups.map(([name, members]) => {
            const { n, diff } = pairedGood(states, results, policy, control, members);
            return [
              code(policy),
              name,
              n,
              n === 0
                ? "n/a"
                : `${fixed(diff.estimate * 100, 0)} pts [${fixed(diff.lo * 100, 0)}, ${fixed(diff.hi * 100, 0)}]`,
            ];
          }),
        ),
      ),
    );
  }
  return sections.join("\n");
}
