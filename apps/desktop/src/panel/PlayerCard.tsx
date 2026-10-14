import type { ChoiceKind, PolicyChoice } from "../policies.ts";
import type { Timing } from "../session.ts";

const GROUPS: readonly { kind: ChoiceKind; label: string }[] = [
  { kind: "model", label: "Models (Workers AI)" },
  { kind: "human", label: "You" },
  { kind: "reference", label: "References (no API)" },
];

const TIMINGS: readonly { value: Timing; label: string; title: string }[] = [
  { value: "step", label: "Step", title: "The world waits while the model thinks" },
  { value: "realtime", label: "Real-time", title: "Cars keep moving while the model thinks" },
];

export interface PlayerCardProps {
  choices: readonly PolicyChoice[];
  selectedId: string;
  human: boolean;
  timing: Timing;
  onSelect(id: string): void;
  onTiming(timing: Timing): void;
}

export function PlayerCard({
  choices,
  selectedId,
  human,
  timing,
  onSelect,
  onTiming,
}: PlayerCardProps) {
  const choice = choices.find((c) => c.id === selectedId);
  return (
    <section class="card">
      <label class="field-label" for="player">
        Who plays
      </label>
      <select
        id="player"
        class="select"
        value={selectedId}
        onChange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
      >
        {GROUPS.map(({ kind, label }) => (
          <optgroup label={label} key={kind}>
            {choices
              .filter((c) => c.kind === kind)
              .map((c) => (
                <option value={c.id} key={c.id} disabled={kind === "model" && !c.factory}>
                  {c.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {choice && <p class="hint">{choice.detail}</p>}
      {choice?.freeReplay && (
        <p class="hint">
          Seeds {choice.freeReplay} replay from the cache <strong>for free</strong>; other maps ask
          the model and spend neurons.
        </p>
      )}

      {!human && (
        <fieldset class="segmented">
          <legend class="sr-only">Timing</legend>
          {TIMINGS.map((t) => (
            <button
              type="button"
              key={t.value}
              class={timing === t.value ? "on" : ""}
              onClick={() => onTiming(t.value)}
              title={t.title}
            >
              {t.label}
            </button>
          ))}
        </fieldset>
      )}
    </section>
  );
}
