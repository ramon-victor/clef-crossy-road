import { useState } from "preact/hooks";
import { parseSeedText } from "../seed.ts";
import type { SessionState, Timing } from "../session.ts";

const SPEEDS = [0.5, 1, 2, 4];
const TIMINGS: readonly { value: Timing; label: string; title: string }[] = [
  { value: "step", label: "Step", title: "The world waits while the model thinks" },
  { value: "realtime", label: "Real-time", title: "Cars keep moving while the model thinks" },
];

export interface SetupCardProps {
  state: SessionState;
  autoRestart: boolean;
  onTiming(timing: Timing): void;
  onSpeed(speed: number): void;
  onSeed(seed: number): void;
  onAutoRestart(on: boolean): void;
}

export function SetupCard({
  state,
  autoRestart,
  onTiming,
  onSpeed,
  onSeed,
  onAutoRestart,
}: SetupCardProps) {
  const [seedText, setSeedText] = useState("");
  const timing = state.human ? "You" : state.timing === "step" ? "Step" : "Real-time";
  return (
    <details class="card setup">
      <summary>
        <span class="setup-label">Setup</span>
        <span class="setup-current">
          {timing} · {state.speed}× · seed {state.seed}
        </span>
      </summary>
      <div class="setup-body">
        {!state.human && (
          <fieldset class="segmented">
            <legend>Timing</legend>
            {TIMINGS.map((t) => (
              <button
                type="button"
                key={t.value}
                class={state.timing === t.value ? "on" : ""}
                aria-pressed={state.timing === t.value}
                onClick={() => onTiming(t.value)}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
          </fieldset>
        )}
        <fieldset class="speeds">
          <legend>Speed</legend>
          {SPEEDS.map((speed) => (
            <button
              type="button"
              key={speed}
              class={state.speed === speed ? "on" : ""}
              aria-pressed={state.speed === speed}
              onClick={() => onSpeed(speed)}
            >
              {speed}×
            </button>
          ))}
        </fieldset>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const seed = parseSeedText(seedText);
            if (seed !== undefined) {
              onSeed(seed);
              setSeedText("");
            }
          }}
        >
          <label class="field-label" for="map-seed">
            Map seed
          </label>
          <div class="seed">
            <input
              id="map-seed"
              class="input"
              inputMode="numeric"
              placeholder={String(state.seed)}
              value={seedText}
              onInput={(event) => setSeedText(event.currentTarget.value)}
            />
            <button type="submit" class="btn small">
              Go
            </button>
          </div>
        </form>
        <div>
          <label class="check">
            <input
              type="checkbox"
              checked={autoRestart}
              aria-describedby="auto-restart-help"
              onChange={(event) => onAutoRestart(event.currentTarget.checked)}
            />
            Auto-restart
          </label>
          <p id="auto-restart-help" class="hint">
            Only free reference players restart automatically. Models never do.
          </p>
        </div>
      </div>
    </details>
  );
}
