import { useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";
import { UiIcon } from "./UiIcon.tsx";

export interface ControlsCardProps {
  state: SessionState;
  minimized: boolean;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
}

export function ControlsCard({
  state,
  minimized,
  onPause,
  onStep,
  onRetry,
  onNewMap,
}: ControlsCardProps) {
  const { t } = useI18n();
  return (
    <section class="controls" aria-label={t("controls.label")}>
      <button
        type="button"
        class="btn primary"
        onClick={onPause}
        title={t("controls.space")}
        disabled={minimized || !state.alive || state.stalled}
        aria-pressed={state.paused}
      >
        <UiIcon name={state.paused ? "play" : "pause"} />
        {t(state.paused ? "controls.resume" : "controls.pause")}
      </button>
      <button
        type="button"
        class="btn"
        onClick={onStep}
        disabled={
          minimized ||
          !state.alive ||
          state.stalled ||
          state.human ||
          state.timing !== "step" ||
          !state.paused
        }
        title={t("controls.stepHelp")}
      >
        <UiIcon name="step" /> {t("controls.step")}
      </button>
      <button type="button" class="btn" onClick={onRetry} title="R">
        <UiIcon name="retry" /> {t("controls.retry")}
      </button>
      <button type="button" class="btn" onClick={onNewMap} title="M">
        <UiIcon name="map" /> {t("controls.newMap")}
      </button>
    </section>
  );
}
