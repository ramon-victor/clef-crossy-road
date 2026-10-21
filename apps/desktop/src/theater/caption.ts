import { decidedBy, type Initiative } from "@ccr/agent";
import { ACTION_GLYPH } from "../format.ts";
import { actionLabel } from "../i18n/presentation.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { SessionState } from "../session.ts";
import { buildCompass, type StripChip, stripOf } from "./compass.ts";
import { type ControllerStep, controllerStep, waitingStep } from "./controller.ts";
import type { ExecutionView } from "./execution.ts";

export interface CaptionView {
  text: string;
  glyph: string;
  active: boolean;
  /** Who made the move on screen; null when there is none to credit (reading, idle, paused). */
  by: { who: Initiative; label: string } | null;
  /** The chicken stays where it cannot be held and nobody stepped in: the model's answer is the whole story. */
  unaided: boolean;
  context: string | null;
  strip: StripChip[];
}

function waitText(step: Extract<ControllerStep, { kind: "wait" }>, { t }: Translator): string {
  if (step.why === "no_rest") return t("compass.wait.room");
  switch (step.cell) {
    case "water":
      return t("compass.wait.water");
    case "vehicle":
      return t("compass.wait.vehicle");
    case "train":
    case "train_coming":
      return t("compass.wait.train");
    default:
      return t("compass.wait.clear");
  }
}

/** Readable context between controller steps; never extends the live execution highlight. */
export function buildCaption(
  state: SessionState,
  execution: ExecutionView,
  translation: Translator = translator("en"),
): CaptionView | null {
  if (!state.alive || state.stalled || state.human || state.phase === "error") return null;
  const view = buildCompass(state, translation);
  const { t } = translation;
  const last = state.last;
  const wait = waitingStep(state);
  const betweenWaits =
    wait !== null && !state.asking && !execution.action && !execution.next && !execution.blocked;
  if (view.mode === "hidden" && !last && !execution.action && !execution.next && !execution.blocked)
    return null;

  const context =
    execution.action && execution.next
      ? t("theater.next", { step: actionLabel(execution.next, translation) })
      : state.asking && execution.action
        ? t("decisions.reading")
        : view.verdict
          ? t("compass.chosen", { move: view.verdict })
          : null;
  const strip =
    state.phase === "reading"
      ? stripOf(state.history.filter((entry) => entry.index !== last?.index))
      : view.strip;
  const base = { context, strip, active: false, by: null, unaided: false };
  if (state.paused) return { ...base, text: t("windows.paused"), glyph: "•" };
  const who = last ? decidedBy(last.decision) : null;
  const by = who ? { who, label: t(`compass.by.${who}`) } : null;
  const held = last ? controllerStep(last.decision) : null;
  const unaidedText =
    held?.kind === "hold" && (held.why === "exposed" || held.why === "edge")
      ? t(`compass.${held.why}`)
      : null;
  if (execution.action || betweenWaits) {
    const action = execution.action ?? "stay";
    const unaided = action === "stay" && unaidedText !== null;
    return {
      ...base,
      text: unaided
        ? unaidedText
        : action === "stay" && wait
          ? waitText(wait, translation)
          : t("compass.now", { step: actionLabel(action, translation) }),
      glyph: ACTION_GLYPH[action],
      active: true,
      by: unaided ? null : by,
      unaided,
    };
  }
  if (execution.next)
    return {
      ...base,
      text: t("theater.next", { step: actionLabel(execution.next, translation) }),
      glyph: ACTION_GLYPH[execution.next],
      by,
    };
  if (execution.blocked) return { ...base, text: t("compass.blocked"), glyph: "✗" };
  return {
    ...base,
    text: t(state.asking ? "decisions.reading" : "compass.idle"),
    glyph: state.asking ? "↔" : "•",
  };
}
