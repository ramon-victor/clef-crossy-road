import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH } from "../format.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { SessionState } from "../session.ts";
import { type BranchView, barsOf, winnerOf } from "./choice.ts";
import { controllerSays, controllerStep, foldWaits, waitsForGap } from "./controller.ts";
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
  /** Drawn as a block, not as a bar: the way ahead is closed. */
  blocked: boolean;
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

export function stripOf(history: SessionState["history"]): StripChip[] {
  const chips = foldWaits(
    history,
    (entry) =>
      entry.decision.source === "executor" && controllerStep(entry.decision)?.kind === "wait",
    (entry): StripChip => ({
      index: entry.index,
      glyph: ACTION_GLYPH[entry.action],
      big: entry.decision.source !== "executor",
      count: 1,
    }),
  );
  return chips.slice(-STRIP_MOVES);
}

const moveOf = (action: Action, shown: Partial<CompassMove> = {}): CompassMove => ({
  action,
  glyph: ACTION_GLYPH[action],
  p: null,
  winner: false,
  blocked: false,
  ...shown,
});

export function buildCompass(
  state: SessionState,
  translation: Translator = translator("en"),
): CompassView {
  const strip = stripOf(state.history);
  if (!state.alive || state.stalled) return { ...ASLEEP, strip };
  const mode = pickMode(state);

  if (mode === "reading") {
    return {
      ...ASLEEP,
      mode,
      index: state.decisions,
      moves: ACTIONS.map((action) => moveOf(action)),
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
  const decision = decisionLabel(asText(log.decision.extra?.maneuver), log.action, translation);
  const go = state.phase !== "reading";
  const latest = state.last;
  const step = latest ? controllerStep(latest.decision) : null;
  const says = step && latest ? controllerSays(latest.decision, translation) : null;
  const leavesAsChosen = step?.kind === "leave" && latest?.action === winner;
  const ringed = step?.kind === "walk" || step?.kind === "hold" || step?.kind === "leave";
  return {
    ...ASLEEP,
    mode,
    index: log.index,
    moves: ACTIONS.map((action) =>
      moveOf(action, {
        p: bars.p[action],
        winner: action === winner,
        blocked: bars.blocked.has(action),
      }),
    ),
    go,
    launch: go && (step === null || step.kind === "hop" || leavesAsChosen),
    waiting: go && step?.kind === "wait",
    actual: ringed && latest ? latest.action : null,
    doing: says === null ? null : go ? says : translation.t("theater.next", { step: says }),
    branch: bars.branch,
    answers: questionsOf(input, log, translation).flatMap((q) => {
      const pick = q.options.find((o) => o.chosen);
      return pick ? [{ glyph: pick.glyph, short: pick.short, skipped: q.skipped !== null }] : [];
    }),
    verdict:
      turn && waitsForGap(turn)
        ? translation.t("theater.whenClear", { move: decision.label })
        : decision.label,
    strip,
  };
}
