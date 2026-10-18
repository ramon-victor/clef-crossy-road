import type { PlayerOption } from "../controls.ts";
import { type ChoiceKind, CLEF_27B_ID, CLEF_ID } from "../policies.ts";

const GROUPS: readonly { kind: ChoiceKind; label: string }[] = [
  { kind: "model", label: "Models (Workers AI)" },
  { kind: "human", label: "You" },
  { kind: "reference", label: "References (no API)" },
];

export interface PlayerCardProps {
  choices: readonly PlayerOption[];
  selectedId: string;
  bridgeKind: "tauri" | "http";
  onSelect(id: string): void;
}

export function PlayerCard({ choices, selectedId, bridgeKind, onSelect }: PlayerCardProps) {
  const choice = choices.find((c) => c.id === selectedId);
  return (
    <section class="card player-card">
      <div class="player-label">
        <label class="field-label" for="player">
          Who plays
        </label>
        <span class="player-kind">
          {choice?.kind === "model"
            ? selectedId === CLEF_ID || selectedId === CLEF_27B_ID
              ? "Model + controller"
              : "Model player"
            : choice?.kind === "reference"
              ? "Reference · no API"
              : "Arrows / WASD"}
        </span>
      </div>
      <div class="player-row">
        <select
          id="player"
          class="select"
          value={selectedId}
          aria-describedby={choice?.usesApi ? "player-cost" : undefined}
          onChange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
        >
          {GROUPS.map(({ kind, label }) => (
            <optgroup label={label} key={kind}>
              {choices
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <option value={c.id} key={c.id} disabled={!c.available}>
                    {c.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          class="info-button"
          popovertarget="player-info"
          aria-label={`About ${choice?.label ?? "this player"} and Clef Crossy Road`}
          title="About this player and keyboard controls"
        >
          i
        </button>
      </div>
      {choice?.usesApi && (
        <p id="player-cost" class="hint spend-note">
          {choice.freeReplay ? (
            <>Cache {choice.freeReplay} free · other maps spend neurons.</>
          ) : (
            "New model decisions spend neurons."
          )}
        </p>
      )}
      <section
        id="player-info"
        class="player-info"
        popover="auto"
        role="dialog"
        aria-labelledby="player-info-title"
      >
        <header class="info-head">
          <h2 id="player-info-title">Clef Crossy Road</h2>
          <button
            type="button"
            class="info-button"
            popovertarget="player-info"
            popovertargetaction="hide"
            aria-label="Close player information"
          >
            ×
          </button>
        </header>
        <p class="hint">Watch a decision model cross the road, or take the controls yourself.</p>
        <h3>{choice?.label}</h3>
        <p>{choice?.detail}</p>
        {choice?.usesApi && (
          <p>
            ≈ {choice.neuronsPerDecision?.toFixed(1)} neurons per new decision. Cache hits and
            controller steps are free. The daily free tier resets at 00:00 UTC.
          </p>
        )}
        {choice?.freeReplay && (
          <p>
            Seeds {choice.freeReplay} replay from the cache for free. Other maps ask the model and
            spend neurons.
          </p>
        )}
        <h3>Keyboard controls</h3>
        <dl class="key-help">
          <dt>↑ ← ↓ → / WASD</dt>
          <dd>Move when you play</dd>
          <dt>Space</dt>
          <dd>Pause / resume</dd>
          <dt>N</dt>
          <dd>One decision while paused in Step mode</dd>
          <dt>R / M</dt>
          <dd>Retry / new map</dd>
          <dt>I</dt>
          <dd>What the model read</dd>
          {bridgeKind === "tauri" && (
            <>
              <dt>F2</dt>
              <dd>Open controls window</dd>
            </>
          )}
        </dl>
        <p class="hint">Click the game to use its shortcuts. Esc closes this information.</p>
        <p class="hint">{bridgeKind === "tauri" ? "Desktop · Tauri" : "Browser development"}</p>
      </section>
    </section>
  );
}
