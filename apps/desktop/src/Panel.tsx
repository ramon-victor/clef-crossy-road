import { ACTIONS, type Action } from "@ccr/core";
import { useState } from "preact/hooks";
import type { BudgetStatus } from "./bridge/types.ts";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER, ms, percent } from "./format.ts";
import type { PolicyChoice } from "./policies.ts";
import type { SessionState, Timing } from "./session.ts";

export interface PanelProps {
  state: SessionState;
  choices: PolicyChoice[];
  selectedId: string;
  budget: BudgetStatus | null;
  fps: number;
  soundOn: boolean;
  bridgeKind: "tauri" | "http";
  onSelect(id: string): void;
  onTiming(timing: Timing): void;
  onSpeed(speed: number): void;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
  onSeed(seed: number): void;
  onSound(on: boolean): void;
}

const SPEEDS = [0.5, 1, 2, 4];

export function Panel(props: PanelProps) {
  const { state } = props;
  const choice = props.choices.find((c) => c.id === props.selectedId);
  const [seedText, setSeedText] = useState("");
  const budgetLeft = props.budget ? props.budget.limit - props.budget.spent : null;
  const exhausted = budgetLeft !== null && budgetLeft <= 0;

  return (
    <aside class="panel">
      <h1 class="title">
        Clef <span>Crossy Road</span>
      </h1>

      <section class="card">
        <label class="field-label" for="player">
          Who plays
        </label>
        <select
          id="player"
          class="select"
          value={props.selectedId}
          onChange={(e) => props.onSelect((e.currentTarget as HTMLSelectElement).value)}
        >
          <optgroup label="Models (Workers AI)">
            {props.choices
              .filter((c) => c.kind === "model")
              .map((c) => (
                <option value={c.id} key={c.id} disabled={!c.factory}>
                  {c.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="You">
            {props.choices
              .filter((c) => c.kind === "human")
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="References (no API)">
            {props.choices
              .filter((c) => c.kind === "reference")
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.label}
                </option>
              ))}
          </optgroup>
        </select>
        {choice && <p class="hint">{choice.detail}</p>}

        {!state.human && (
          <fieldset class="segmented">
            <legend class="sr-only">Timing</legend>
            <button
              type="button"
              class={state.timing === "step" ? "on" : ""}
              onClick={() => props.onTiming("step")}
              title="The world waits while the model thinks"
            >
              Step
            </button>
            <button
              type="button"
              class={state.timing === "realtime" ? "on" : ""}
              onClick={() => props.onTiming("realtime")}
              title="Cars keep moving while the model thinks"
            >
              Real-time
            </button>
          </fieldset>
        )}
      </section>

      <section class="card controls">
        <button type="button" class="btn" onClick={props.onPause} title="Space">
          {state.paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          type="button"
          class="btn"
          onClick={props.onStep}
          disabled={state.human || state.timing !== "step" || !state.paused}
          title="N: one decision while paused"
        >
          ⏭ Step
        </button>
        <button type="button" class="btn" onClick={props.onRetry} title="R">
          ↺ Retry
        </button>
        <button type="button" class="btn" onClick={props.onNewMap} title="M">
          ✦ New map
        </button>
        <fieldset class="speeds">
          <legend class="sr-only">Speed</legend>
          {SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              class={state.speed === s ? "on" : ""}
              onClick={() => props.onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </fieldset>
        <form
          class="seed"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(seedText);
            if (Number.isInteger(n) && n >= 0 && n < 2 ** 32) props.onSeed(n);
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

      {state.error && (
        <section class="card warn">
          <strong>Stopped</strong>
          <p>{state.error}</p>
          {/Local daily budget/.test(state.error) && (
            <p class="small">
              The free tier is spent for today (it resets at 00:00 UTC). Cached decisions still play
              for free. Pick another player, or come back later.
            </p>
          )}
        </section>
      )}

      {!state.human && <DecisionCard state={state} />}

      <section class="card stats">
        <Stat label="Rows" value={String(state.score)} />
        <Stat label="Decisions" value={String(state.decisions)} />
        <Stat label="Latency" value={ms(state.avgLatencyMs)} />
        <Stat
          label="Tokens"
          value={state.avgTokens === null ? "–" : String(Math.round(state.avgTokens))}
        />
        <Stat label="Invalid" value={String(state.invalidMoves)} />
        <Stat label="Cached" value={String(state.cacheHits)} />
      </section>

      <section class="card">
        <div class="field-label">Neurons today (UTC)</div>
        {props.budget ? (
          <>
            <div
              class="meter"
              data-level={
                exhausted ? "full" : props.budget.spent / props.budget.limit > 0.7 ? "high" : "ok"
              }
            >
              <div
                class="meter-fill"
                style={{
                  width: `${Math.min(100, (props.budget.spent / props.budget.limit) * 100)}%`,
                }}
              />
            </div>
            <p class="hint">
              {Math.round(props.budget.spent).toLocaleString("en-US")} /{" "}
              {props.budget.limit.toLocaleString("en-US")} free
              {exhausted ? " · budget reached: new model calls are refused" : ""}
              {state.neurons > 0 ? ` · this game ${state.neurons.toFixed(1)}` : ""}
            </p>
            {choice?.usesApi && !exhausted && (
              <p class="hint">
                ≈ {choice.neuronsPerDecision?.toFixed(1)} neurons per new decision (cache hits are
                free)
              </p>
            )}
          </>
        ) : (
          <p class="hint">unavailable</p>
        )}
      </section>

      <footer class="foot">
        <label class="check">
          <input
            type="checkbox"
            checked={props.soundOn}
            onChange={(e) => props.onSound((e.currentTarget as HTMLInputElement).checked)}
          />{" "}
          sound
        </label>
        <span>{Math.round(props.fps)} fps</span>
        <span>{props.bridgeKind === "tauri" ? "desktop" : "browser dev"}</span>
        <span class="keys">←↑→↓ move · space pause · N step · R retry · M new map</span>
      </footer>
    </aside>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="stat">
      <div class="stat-value">{props.value}</div>
      <div class="stat-label">{props.label}</div>
    </div>
  );
}

function DecisionCard({ state }: { state: SessionState }) {
  const last = state.last;
  const decision = last?.decision;
  const risk = decision?.extra?.risk as Record<Action, number> | undefined;
  const probabilities = decision?.probabilities;
  const showing: "probability" | "risk" | "none" = probabilities
    ? "probability"
    : risk
      ? "risk"
      : "none";

  return (
    <section class="card decision">
      <div class="field-label">
        {state.phase === "thinking"
          ? "Thinking…"
          : showing === "risk"
            ? "Chance of dying, per move (model's answer)"
            : "Last decision"}
      </div>
      {last ? (
        <>
          <div class="chosen">
            <span class="chosen-arrow">{ACTION_GLYPH[last.action]}</span>
            <span>{ACTION_LABEL[last.action]}</span>
            {decision?.cached && <span class="tag">cached</span>}
          </div>
          {showing === "none" && (
            <p class="hint">
              This player does not report probabilities: it is a reference, not a model.
            </p>
          )}
          <div class="bars" hidden={showing === "none"}>
            {ACTION_ORDER.map((a) => {
              const value = showing === "risk" ? risk?.[a] : probabilities?.[a];
              const chosen = a === last.action;
              return (
                <div class={`bar-row ${chosen ? "chosen-row" : ""}`} key={a}>
                  <span class="bar-glyph">{ACTION_GLYPH[a]}</span>
                  <div class="bar">
                    <div
                      class={showing === "risk" ? "risk" : ""}
                      style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span class="bar-num">{percent(value)}</span>
                </div>
              );
            })}
          </div>
          {decision?.confidence !== undefined && (
            <p class="hint">
              confidence {decision.confidence.toFixed(2)} <em>(undocumented by Cloudflare)</em>
            </p>
          )}
          <div class="history" title="Recent decisions">
            {state.history.map((h) => (
              <span class="chip" key={h.index} title={`${ACTION_LABEL[h.action]} at row ${h.row}`}>
                {ACTION_GLYPH[h.action]}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p class="hint">{ACTIONS.length} possible moves. Waiting for the first decision…</p>
      )}
    </section>
  );
}
