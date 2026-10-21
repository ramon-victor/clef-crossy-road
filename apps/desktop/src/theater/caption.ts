import { ACTION_GLYPH } from "../format.ts";
import { actionLabel } from "../i18n/presentation.ts";
import { type Translator, translator } from "../i18n/translate.ts";
import type { SessionState } from "../session.ts";
import { buildCompass, type StripChip, stripOf } from "./compass.ts";
import { type ControllerStep, controllerStep } from "./controller.ts";
import type { ExecutionView } from "./execution.ts";

export interface CaptionView {
  text: string;
  glyph: string;
  active: boolean;
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
  const step = last ? controllerStep(last.decision) : null;
  const confirmedWait =
    step?.kind === "wait" &&
    last?.action === "stay" &&
    state.playback?.index === last.index &&
    state.playback.outcome === "stay" &&
    state.phase !== "reading";
  const betweenWaits =
    confirmedWait && !state.asking && !execution.action && !execution.next && !execution.blocked;
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
  const base = { context, strip, active: false };
  if (state.paused) return { ...base, text: t("windows.paused"), glyph: "•" };
  if (execution.action || betweenWaits) {
    const action = execution.action ?? "stay";
    return {
      ...base,
      text:
        action === "stay" && confirmedWait
          ? waitText(step, translation)
          : t("compass.now", { step: actionLabel(action, translation) }),
      glyph: ACTION_GLYPH[action],
      active: true,
    };
  }
  if (execution.next)
    return {
      ...base,
      text: t("theater.next", { step: actionLabel(execution.next, translation) }),
      glyph: ACTION_GLYPH[execution.next],
    };
  if (execution.blocked) return { ...base, text: t("compass.blocked"), glyph: "✗" };
  return {
    ...base,
    text: t(state.asking ? "decisions.reading" : "compass.idle"),
    glyph: state.asking ? "↔" : "•",
  };
}
