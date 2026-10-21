import type { Action } from "@ccr/core";
import { actionLabel, gameEndTitle } from "../i18n/presentation.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { ChoiceKind } from "../policies.ts";
import type { DecisionLog, SessionState } from "../session.ts";
import { winnerOf } from "./choice.ts";
import { controllerSays, controllerStep } from "./controller.ts";
import { buildFeed, type TurnView } from "./feed.ts";

export type DecisionStage =
  | "waiting"
  | "reading"
  | "holding"
  | "acting"
  | "paused"
  | "ended"
  | "error";

export interface DecisionPresentation {
  stage: DecisionStage;
  title: string;
  explanation: string;
  intent: Action | null;
  actual: Action | null;
  current: DecisionLog | null;
  round: TurnView | null;
  rounds: TurnView[];
  controller: boolean;
  answers: Array<{ id: string; label: string; glyph: string }>;
}

/** A display projection of recorded answers and actions. No inferred route, safety or model reasoning. */
export function buildDecisionPresentation(
  state: SessionState,
  kind: ChoiceKind | undefined,
  translation: Translator = translator("en"),
  selectedIndex?: number,
): DecisionPresentation {
  const { t } = translation;
  const rounds = kind === "model" ? buildFeed(state, translation) : [];
  const round = rounds.find((item) => item.index === selectedIndex) ?? rounds.at(-1) ?? null;
  const current = round?.reading
    ? null
    : ((round && round.index === state.lastModel?.index ? state.last : round?.history.at(-1)) ??
      (kind === "reference" ? state.last : null));
  const pending = round?.pending === true;
  // An earlier consultation keeps its recorded action when the live game pauses or ends.
  const currentRound = round === null || round === rounds.at(-1);
  const stage: DecisionStage =
    currentRound && state.error
      ? "error"
      : currentRound && (!state.alive || state.stalled)
        ? "ended"
        : currentRound && state.paused
          ? "paused"
          : round?.reading
            ? "reading"
            : pending
              ? "holding"
              : current
                ? "acting"
                : "waiting";
  const step = current ? controllerStep(current.decision) : null;
  let title: string;
  if (stage === "error") title = t("error.stopped");
  else if (stage === "ended") title = gameEndTitle(state, translation);
  else if (stage === "paused") title = t("decisions.stage.paused");
  else if (round?.reading) title = t("decisions.reading");
  else if (pending) title = t("decisions.ready");
  else if (current) title = t(`decisions.action.${current.action}`);
  else title = t(kind === "human" ? "theater.human" : "decisions.waiting");
  let explanation = current ? controllerSays(current.decision, translation) : null;
  if (step?.kind === "wait") {
    explanation = t(step.why === "no_rest" ? "decisions.waitLanding" : "decisions.waitPass");
  }
  if (round?.reading) explanation = t("decisions.readingHelp");
  else if (pending) explanation = t("theater.pendingMove");
  else if (!explanation) explanation = t(current ? "decisions.sent" : "theater.pickModel");
  const answers = (round?.questions ?? []).flatMap((question) => {
    const option = question.options.find((item) => item.chosen);
    return option && !question.skipped
      ? [{ id: question.id, label: option.label, glyph: option.glyph }]
      : [];
  });
  return {
    stage,
    title,
    explanation,
    intent: round?.log ? winnerOf(round.log) : null,
    actual: pending ? null : (current?.action ?? null),
    current,
    round,
    rounds,
    controller: step !== null || current?.decision.source === "executor",
    answers,
  };
}

export const intentLabel = (view: DecisionPresentation, translation: Translator): string =>
  view.round?.move?.label ?? (view.current ? actionLabel(view.current.action, translation) : "–");
