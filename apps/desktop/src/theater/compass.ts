import { MANEUVER_ACTION, ROUTE_ACTION } from "@ccr/agent";
import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH, percent } from "../format.ts";
import type { DecisionLog, SessionState } from "../session.ts";
import { controllerSays, controllerStep, waitsForGap } from "./controller.ts";
import { pickMode } from "./frame.ts";
import { decisionLabel } from "./labels.ts";
import { asText, questionsOf } from "./view.ts";

/** How many of the latest moves the strip under the game shows. */
export const STRIP_MOVES = 12;

export interface CompassMove {
  action: Action;
  glyph: string;
  /** The model's probability for this move; null while it is still reading. */
  p: number | null;
  /** The move the model chose. */
  winner: boolean;
  /** The way ahead is closed, so this move is not on the table this time (drawn as a block, not as a bar). */
  blocked: boolean;
}

/** What the model's answers came to before they were split among the moves: which fork the routing took, and how sure. */
export interface BranchView {
  text: string;
  p: number;
}

export interface CompassAnswer {
  glyph: string;
  short: string;
  /** The routing never looked at this answer. */
  skipped: boolean;
}

/** One chip of the strip under the game: a move, or a run of the same wait. */
export interface StripChip {
  index: number;
  glyph: string;
  /** The model's own move, as against a step of the controller's. */
  big: boolean;
  /** How many steps the chip stands for (a run of waits is one chip). */
  count: number;
}

export interface CompassView {
  mode: "hidden" | "reading" | "answered";
  /** The number of the decision, to tell one from the next. */
  index: number | null;
  moves: CompassMove[];
  /** The move has been let go: the chicken is on its way. */
  go: boolean;
  /** The chicken does what the model chose, so the choice leaves. */
  launch: boolean;
  /** The crossing waits for a gap: the choice stays, pulsing with a pause, until the way clears. */
  waiting: boolean;
  /**
   * The move the chicken makes when it is not the choice itself: a hop of a detour, or the hop of a refusal that
   * steps aside. Null while the choice is simply what happens (or what is waited for).
   */
  actual: Action | null;
  /** What the controller is doing now, in words ("waiting for a vehicle to pass 2/15"); null when nothing to say. */
  doing: string | null;
  answers: CompassAnswer[];
  /** What the answers come to ("Go straight · when clear"). */
  verdict: string | null;
  /** The fork the routing took ("way ahead closed 58%"); null for a strategy with no routing. */
  branch: BranchView | null;
  /** When the question went out, in the session's clock; set while the model reads. */
  since: number | null;
  /** The latest moves, the model's own big and the controller's small. */
  strip: StripChip[];
}

const ASLEEP: Omit<CompassView, "strip"> = {
  mode: "hidden",
  index: null,
  moves: [],
  go: false,
  launch: false,
  waiting: false,
  actual: null,
  doing: null,
  answers: [],
  verdict: null,
  branch: null,
  since: null,
};

/** The move each manoeuvre is made of, for both families of manoeuvres (they agree where their names meet). */
const ACTION_OF: Readonly<Record<string, Action>> = { ...MANEUVER_ACTION, ...ROUTE_ACTION };

/**
 * The move the model chose. For the strategies with a controller that is the manoeuvre it picked, which the
 * controller may start with another move (a detour that begins by stepping back), so the decision's own
 * `action` is only the answer when there was no manoeuvre.
 */
export function winnerOf(log: DecisionLog): Action {
  const maneuver = asText(log.decision.extra?.maneuver);
  // Getting off a platform is made of whichever hop gets the chicken off it, which is the decision's own.
  if (maneuver === "leave_platform") return log.action;
  return (maneuver ? ACTION_OF[maneuver] : undefined) ?? log.action;
}

export interface Bars {
  /** How much the model wants each move, within the fork the routing took. */
  p: Readonly<Record<Action, number>>;
  /** Moves that are not on the table this time. */
  blocked: ReadonlySet<Action>;
  branch: BranchView | null;
}

const NONE: Record<Action, number> = {
  hop_forward: 0,
  hop_back: 0,
  hop_left: 0,
  hop_right: 0,
  stay: 0,
};

const probabilityOf = (log: DecisionLog, question: string, option: string): number | undefined =>
  log.decision.answers?.[question]?.probabilities[option];

/**
 * How much the model wants each move, said within the fork the routing took, so that the move that is lit is
 * always the biggest one. The routing is a chain of forks (a platform that is leaving the world; else a cell to
 * stand on or things that pass, which mean "go straight"; else the way is closed and the third answer picks a
 * side), and the joint probabilities the benchmark records add the forks up in one row of bars: a closed way
 * could then show "go straight" as the biggest bar (22% of the answers recorded on seeds 6 to 8). Here a closed
 * way shows the three ways round and a block where "go straight" would be, and says how sure the fork was.
 * A strategy with no routing keeps the probabilities it reported.
 */
export function barsOf(log: DecisionLog): Bars | null {
  const { decision } = log;
  const pStand = probabilityOf(log, "cell", "stand");
  const pMoving = probabilityOf(log, "moving", "moving");
  const maneuver = asText(decision.extra?.maneuver);
  if (pStand === undefined || pMoving === undefined || maneuver === undefined) {
    return decision.probabilities
      ? {
          p: { ...NONE, ...decision.probabilities },
          blocked: new Set(),
          branch: null,
        }
      : null;
  }
  const around = (option: string) => probabilityOf(log, "around", option) ?? 0;
  const pCross = pStand + (1 - pStand) * pMoving;
  const pClosed = 1 - pCross;
  const pLeaving = probabilityOf(log, "ride", "leaving");
  if (maneuver === "leave_platform") {
    return {
      p: { ...NONE, [log.action]: pLeaving ?? 1 },
      blocked: new Set(),
      branch: { text: "its platform is leaving the world", p: pLeaving ?? 1 },
    };
  }
  const ways = {
    hop_left: around("detour_left"),
    hop_right: around("detour_right"),
    stay: around("wait_here"),
  };
  if (decision.extra?.ahead === "closed") {
    return {
      p: { ...NONE, ...ways },
      blocked: new Set<Action>(["hop_forward"]),
      branch: { text: "the way ahead is closed", p: pClosed },
    };
  }
  const text =
    decision.extra?.ahead === "passing" ? "things pass on the way ahead" : "the way ahead is open";
  return {
    p: {
      ...NONE,
      hop_forward: pCross,
      hop_left: pClosed * ways.hop_left,
      hop_right: pClosed * ways.hop_right,
      stay: pClosed * ways.stay,
    },
    blocked: new Set(),
    branch: { text, p: pCross },
  };
}

/** The fork of a decision in a few words, for a caption: "the way ahead is closed 58%". */
export const branchText = (branch: BranchView): string => `${branch.text} ${percent(branch.p)}`;

/**
 * The latest moves for the strip under the game. A chicken that waits for a gap takes the same step again and
 * again, so a run of them is one chip with a count instead of a row of pauses.
 */
export function stripOf(history: SessionState["history"]): StripChip[] {
  const chips: StripChip[] = [];
  let inRunOfWaits = false;
  for (const entry of history) {
    const waits =
      entry.decision.source === "executor" && controllerStep(entry.decision)?.kind === "wait";
    const last = chips.at(-1);
    if (waits && inRunOfWaits && last) {
      chips[chips.length - 1] = { ...last, count: last.count + 1 };
      continue;
    }
    chips.push({
      index: entry.index,
      glyph: ACTION_GLYPH[entry.action],
      big: entry.decision.source !== "executor",
      count: 1,
    });
    inRunOfWaits = waits;
  }
  return chips.slice(-STRIP_MOVES);
}

/** The five moves around the chicken, how much the model wants each, and the caption under the game. */
export function buildCompass(state: SessionState): CompassView {
  const strip = stripOf(state.history);
  if (!state.alive || state.stalled) return { ...ASLEEP, strip };
  const mode = pickMode(state);

  if (mode === "reading") {
    return {
      ...ASLEEP,
      mode,
      index: state.decisions,
      moves: ACTIONS.map((action) => ({
        action,
        glyph: ACTION_GLYPH[action],
        p: null,
        winner: false,
        blocked: false,
      })),
      since: state.asking?.since ?? null,
      strip,
    };
  }

  const log = state.lastModel;
  const bars = log ? barsOf(log) : null;
  const input = log?.decision.sent;
  if (mode !== "answered" || !log || !bars || !input) return { ...ASLEEP, strip };

  const turn = state.turns.find((t) => t.model === log);
  const winner = winnerOf(log);
  const decision = decisionLabel(asText(log.decision.extra?.maneuver), log.action);
  const go = state.phase !== "reading";
  // What the chicken does: the model's own decision is the controller's first step, and each later step is a
  // decision of its own. A strategy with no controller reports no step: its move is simply made. The step the
  // chicken is about to take is known as soon as the model answers, so it is shown while the move is still held
  // for reading, as what comes next.
  const latest = state.last;
  const step = latest ? controllerStep(latest.decision) : null;
  const says = step && latest ? controllerSays(latest.decision) : null;
  return {
    ...ASLEEP,
    mode,
    index: log.index,
    moves: ACTIONS.map((action) => ({
      action,
      glyph: ACTION_GLYPH[action],
      p: bars.p[action],
      winner: action === winner,
      blocked: bars.blocked.has(action),
    })),
    go,
    launch:
      go &&
      (step === null ||
        step.kind === "hop" ||
        (step.kind === "leave" && latest?.action === winner)),
    waiting: go && step?.kind === "wait",
    actual:
      latest && (step?.kind === "walk" || step?.kind === "hold" || step?.kind === "leave")
        ? latest.action
        : null,
    doing: says === null ? null : go ? says : `next: ${says}`,
    branch: bars.branch,
    answers: questionsOf(input, log).flatMap((q) => {
      const pick = q.options.find((o) => o.chosen);
      return pick ? [{ glyph: pick.glyph, short: pick.short, skipped: q.skipped !== null }] : [];
    }),
    verdict: turn && waitsForGap(turn) ? `${decision.label} · when clear` : decision.label,
    strip,
  };
}
