import { useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";

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
        disabled={minimized}
        aria-pressed={state.paused}
      >
        {state.paused ? `▶ ${t("controls.resume")}` : `⏸ ${t("controls.pause")}`}
      </button>
      <button
        type="button"
        class="btn"
        onClick={onStep}
        disabled={minimized || state.human || state.timing !== "step" || !state.paused}
        title={t("controls.stepHelp")}
      >
        ⏭ {t("controls.step")}
      </button>
      <button type="button" class="btn" onClick={onRetry} title="R">
        ↺ {t("controls.retry")}
      </button>
      <button type="button" class="btn" onClick={onNewMap} title="M">
        ✦ {t("controls.newMap")}
      </button>
    </section>
  );
}
