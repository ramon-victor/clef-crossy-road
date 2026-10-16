import { MANEUVER_ACTION, ROUTE_ACTION } from "@ccr/agent";
import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH } from "../format.ts";
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
  return (maneuver ? ACTION_OF[maneuver] : undefined) ?? log.action;
}

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
      })),
      since: state.asking?.since ?? null,
      strip,
    };
  }

  const log = state.lastModel;
  const probabilities = log?.decision.probabilities;
  const input = log?.decision.sent;
  if (mode !== "answered" || !log || !probabilities || !input) return { ...ASLEEP, strip };

  const turn = state.turns.find((t) => t.model === log);
  const winner = winnerOf(log);
  const decision = decisionLabel(asText(log.decision.extra?.maneuver), log.action);
  const go = state.phase !== "reading";
  // What the chicken is doing now: the model's own decision is the controller's first step, and each later step
  // is a decision of its own. A strategy with no controller reports no step: its move is simply made.
  const latest = state.last;
  const step = go && latest ? controllerStep(latest.decision) : null;
  return {
    ...ASLEEP,
    mode,
    index: log.index,
    moves: ACTIONS.map((action) => ({
      action,
      glyph: ACTION_GLYPH[action],
      p: probabilities[action] ?? 0,
      winner: action === winner,
    })),
    go,
    launch: go && (step === null || step.kind === "hop"),
    waiting: step?.kind === "wait",
    actual: latest && (step?.kind === "walk" || step?.kind === "hold") ? latest.action : null,
    doing: step && latest ? controllerSays(latest.decision) : null,
    answers: questionsOf(input, log).flatMap((q) => {
      const pick = q.options.find((o) => o.chosen);
      return pick ? [{ glyph: pick.glyph, short: pick.short, skipped: q.skipped !== null }] : [];
    }),
    verdict: turn && waitsForGap(turn) ? `${decision.label} · when clear` : decision.label,
    strip,
  };
}
