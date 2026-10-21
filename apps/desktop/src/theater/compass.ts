import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH } from "../format.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { SessionState } from "../session.ts";
import { barsOf, winnerOf } from "./choice.ts";
import { controllerSays, controllerStep, foldWaits, waitsForGap } from "./controller.ts";
import { pickMode } from "./frame.ts";
import { decisionLabel } from "./labels.ts";
import { asText } from "./view.ts";

/** How many of the latest moves the strip under the game shows. */
export const STRIP_MOVES = 6;

export interface CompassMove {
  action: Action;
  glyph: string;
  /** Drawn as a block, not as a bar: the way ahead is closed. */
  blocked: boolean;
  /** The model's share of this move within its routing fork; null while it reads, when closed, or with no probabilities. */
  p: number | null;
  /** The model's own pick, which the controller may not start with. */
  chosen: boolean;
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
  /** What the controller is doing now, in words ("waiting for a vehicle to pass 2/15"); null when nothing to say. */
  doing: string | null;
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
  doing: null,
  verdict: null,
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

export const moveOf = (action: Action, shown: Partial<CompassMove> = {}): CompassMove => ({
  action,
  glyph: ACTION_GLYPH[action],
  blocked: false,
  p: null,
  chosen: false,
  ...shown,
});

export function buildCompass(
  state: SessionState,
  translation: Translator = translator("en"),
): CompassView {
  const strip = stripOf(state.history);
  if (!state.alive || state.stalled || state.phase === "error") return { ...ASLEEP, strip };
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
  if (mode !== "answered" || !log) return { ...ASLEEP, strip };

  const chosen = winnerOf(log);
  const turn = state.turns.find((t) => t.model === log);
  const decision = decisionLabel(asText(log.decision.extra?.maneuver), log.action, translation);
  const go = state.phase !== "reading";
  const latest = state.last;
  const step = latest ? controllerStep(latest.decision) : null;
  const says = step && latest ? controllerSays(latest.decision, translation) : null;
  return {
    ...ASLEEP,
    mode,
    index: log.index,
    moves: ACTIONS.map((action) => {
      const blocked = bars?.blocked.has(action) ?? false;
      return moveOf(action, {
        blocked,
        p: blocked ? null : (bars?.p[action] ?? null),
        chosen: action === chosen,
      });
    }),
    doing: says === null ? null : go ? says : translation.t("theater.next", { step: says }),
    verdict:
      turn && waitsForGap(turn)
        ? translation.t("theater.whenClear", { move: decision.label })
        : decision.label,
    strip,
  };
}
