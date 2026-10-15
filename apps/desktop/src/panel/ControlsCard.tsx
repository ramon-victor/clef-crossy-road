import type { SessionState } from "../session.ts";

export interface ControlsCardProps {
  state: SessionState;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
}

export function ControlsCard({ state, onPause, onStep, onRetry, onNewMap }: ControlsCardProps) {
  return (
    <section class="controls" aria-label="Playback controls">
      <button type="button" class="btn primary" onClick={onPause} title="Space">
        {state.paused ? "▶ Resume" : "⏸ Pause"}
      </button>
      <button
        type="button"
        class="btn"
        onClick={onStep}
        disabled={state.human || state.timing !== "step" || !state.paused}
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
