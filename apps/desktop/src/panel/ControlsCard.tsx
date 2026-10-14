import { useState } from "preact/hooks";
import { parseSeedText } from "../seed.ts";
import type { SessionState } from "../session.ts";

const SPEEDS = [0.5, 1, 2, 4];

export interface ControlsCardProps {
  state: SessionState;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
  onSpeed(speed: number): void;
  onSeed(seed: number): void;
}

export function ControlsCard({
  state,
  onPause,
  onStep,
  onRetry,
  onNewMap,
  onSpeed,
  onSeed,
}: ControlsCardProps) {
  const [seedText, setSeedText] = useState("");
  return (
    <section class="card controls">
      <button type="button" class="btn" onClick={onPause} title="Space">
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
      <fieldset class="speeds">
        <legend class="sr-only">Speed</legend>
        {SPEEDS.map((s) => (
          <button
            type="button"
            key={s}
            class={state.speed === s ? "on" : ""}
            onClick={() => onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </fieldset>
      <form
        class="seed"
        onSubmit={(e) => {
          e.preventDefault();
          const seed = parseSeedText(seedText);
          if (seed !== undefined) onSeed(seed);
          setSeedText("");
        }}
      >
        <input
          class="input"
          inputMode="numeric"
          placeholder={`seed ${state.seed}`}
          value={seedText}
          onInput={(e) => setSeedText((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="btn small">
          Go
        </button>
      </form>
    </section>
  );
}
