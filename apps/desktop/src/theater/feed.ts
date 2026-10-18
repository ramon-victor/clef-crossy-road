import { ACTION_GLYPH } from "../format.ts";
import { actionLabel } from "../i18n/presentation.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { DecisionLog, SessionState, Turn } from "../session.ts";
import { controllerSays, controllerStep, foldWaits, waitsForGap } from "./controller.ts";
import { decisionLabel, type SceneView, sceneOf } from "./labels.ts";
import { asText, type QuestionView, questionsOf } from "./view.ts";

/** How many rounds of the conversation are kept on screen. */
export const TURNS_SHOWN = 7;

export interface TurnFacts {
  model: string;
  latencyMs: number | undefined;
  neurons: number | undefined;
  inputTokens: number | undefined;
  /** Served from the cache: `latencyMs` is then the round trip recorded when it was first asked. */
  cached: boolean;
}

export interface TurnView {
  /** The number of the decision, to tell one round from the next. */
  index: number;
  row: number;
  log: DecisionLog | null;
  controller: boolean;
  pending: boolean;
  firstStep: string | null;
  /** Original records of this round only, including its model answer. */
  history: readonly DecisionLog[];
  scene: SceneView | null;
  questions: QuestionView[];
  /** The model has not answered yet. */
  reading: boolean;
  /** When the question went out, in the session's clock; set while the model reads. */
  since: number | null;
  facts: TurnFacts;
  /** What the model's answers come to, in words: its manoeuvre, or else the move itself. */
  move: { glyph: string; label: string } | null;
  /** What the controller did with the answer when it was not simply the crossing (waited, refused and why, detoured, left a platform). */
  said: string | null;
  /** The controller's steps after the answer, in order; a run of waits is one step with a count. */
  steps: Array<{ glyph: string; note: string; count: number }>;
  /** Earlier rounds shrink to one line: the move and the pick of each question. */
  old: boolean;
  summary: string[];
}

function stepText(log: DecisionLog, translation: Translator): string {
  const action = actionLabel(log.action, translation);
  const detail = controllerSays(log.decision, translation);
  return detail ? `${action} · ${detail}` : action;
}

function stepsOf(turn: Turn, translation: Translator): TurnView["steps"] {
  return foldWaits(
    turn.steps,
    (step) => controllerStep(step.decision)?.kind === "wait",
    (step) => ({
      glyph: ACTION_GLYPH[step.action],
      note: stepText(step, translation),
      count: 1,
    }),
    (item, step) => ({ ...item, note: stepText(step, translation) }),
  );
}

function answered(turn: Turn, translation: Translator): TurnView | null {
  const log = turn.model;
  const input = log.decision.sent;
  if (!input) return null;
  const questions = questionsOf(input, log, translation);
  const move = decisionLabel(asText(log.decision.extra?.maneuver), log.action, translation);
  return {
    index: log.index,
    row: log.row,
    log,
    controller: controllerStep(log.decision) !== null,
    pending: false,
    firstStep: stepText(log, translation),
    history: [log, ...turn.steps],
    scene: sceneOf(input.state, translation),
    questions,
    reading: false,
    since: null,
    facts: {
      model: input.model,
      latencyMs: log.decision.latencyMs,
      neurons: log.decision.neurons,
      inputTokens: log.decision.inputTokens,
      cached: log.decision.cached ?? false,
    },
    move: {
      glyph: move.glyph,
      label: waitsForGap(turn)
        ? translation.t("theater.whenClear", { move: move.label })
        : move.label,
    },
    said: controllerSays(log.decision, translation),
    steps: stepsOf(turn, translation),
    old: false,
    summary: questions.flatMap((q) => {
      const pick = q.options.find((o) => o.chosen);
      return pick ? [pick.glyph || pick.short] : [];
    }),
  };
}

function reading(state: SessionState, translation: Translator): TurnView | null {
  const asking = state.asking;
  if (!asking) return null;
  return {
    index: state.decisions,
    row: asking.row ?? state.last?.row ?? state.score,
    log: null,
    controller: false,
    pending: false,
    firstStep: null,
    history: [],
    scene: sceneOf(asking.input.state, translation),
    questions: questionsOf(asking.input, null, translation),
    reading: true,
    since: asking.since,
    facts: {
      model: asking.input.model,
      latencyMs: undefined,
      neurons: undefined,
      inputTokens: undefined,
      cached: false,
    },
    move: null,
    said: null,
    steps: [],
    old: false,
    summary: [],
  };
}

/**
 * The conversation: one round per question to the model, oldest first, the last of them the live one. Each
 * round is what the game told the model, what it answered to each question with the options it was given,
 * and what the controller did next. Worked out from the session alone (no DOM, no clock).
 */
export function buildFeed(
  state: SessionState,
  translation: Translator = translator("en"),
): TurnView[] {
  const live = reading(state, translation);
  // One round per decision: an answered round is never listed beside the question that is out for the same one.
  const rounds = state.turns.flatMap((turn) =>
    live && turn.model.index >= live.index ? [] : (answered(turn, translation) ?? []),
  );
  if (live) rounds.push(live);
  return rounds.slice(-TURNS_SHOWN).map((round, i, shown) => ({
    ...round,
    old: i < shown.length - 1,
    pending: state.phase === "reading" && round.index === state.last?.index,
  }));
}
