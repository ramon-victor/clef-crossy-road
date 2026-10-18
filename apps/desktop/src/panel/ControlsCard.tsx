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
  return (
    <section class="controls" aria-label="Playback controls">
      <button
        type="button"
        class="btn primary"
        onClick={onPause}
        title="Space"
        disabled={minimized}
      >
        {state.paused ? "▶ Resume" : "⏸ Pause"}
      </button>
      <button
        type="button"
        class="btn"
        onClick={onStep}
        disabled={minimized || state.human || state.timing !== "step" || !state.paused}
        title="N: one decision while paused"
      >
        ⏭ Step
      </button>
      <button type="button" class="btn" onClick={onRetry} title="R">
        ↺ Retry
      </button>
      <button type="button" class="btn" onClick={onNewMap} title="M">
        ✦ New map
      </button>
    </section>
  );
}
