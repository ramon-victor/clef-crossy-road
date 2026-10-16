import { ACTIONS } from "@ccr/core";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER, percent } from "../format.ts";
import type { SessionState } from "../session.ts";
import { controllerSays, waitsForGap } from "../theater/controller.ts";
import { Glyph } from "../theater/Glyph.tsx";
import { decisionLabel } from "../theater/labels.ts";

export interface DecisionCardProps {
  state: SessionState;
  theaterOpen: boolean;
  onInspect(): void;
  onTheater(): void;
}

export function DecisionCard({ state, theaterOpen, onInspect, onTheater }: DecisionCardProps) {
  const last = state.last;
  const decision = last?.decision;
  const probabilities = decision?.probabilities;
  const canInspect = state.history.some((entry) => entry.decision.sent);
  // What the model chose (a manoeuvre) is what the card names; the move the controller starts with, or the wait
  // it takes, can be another thing and is said on its own line.
  const maneuver = decision?.extra?.maneuver;
  const choice =
    last && decision?.source !== "executor" && typeof maneuver === "string"
      ? decisionLabel(maneuver, last.action)
      : null;
  const turn = state.turns.at(-1);
  const waits = choice !== null && turn !== undefined && turn.model === last && waitsForGap(turn);
  const says = decision ? controllerSays(decision) : null;
  return (
    <section class="card decision">
      <header class="decision-head">
        <div class="field-label">{state.phase === "thinking" ? "Thinking…" : "Last decision"}</div>
        {decision?.cached && <span class="tag">cached</span>}
        {decision?.source === "executor" && <span class="tag">controller</span>}
      </header>
      {last ? (
        <>
          <div class="chosen">
            <span class="chosen-arrow">
              <Glyph glyph={choice ? choice.glyph : ACTION_GLYPH[last.action]} size={22} />
            </span>
            <span>
              {choice
                ? `${choice.label}${waits ? " · when clear" : ""}`
                : ACTION_LABEL[last.action]}
            </span>
          </div>
          {!probabilities && decision?.source !== "executor" && (
            <p class="hint">No probabilities reported.</p>
          )}
          {decision?.source === "executor" && (
            <p class="hint">Controller step · {says ?? "no model call"}.</p>
          )}
          {decision?.source !== "executor" && says && <p class="hint">Controller: {says}.</p>}
          <div class="bars" hidden={!probabilities}>
            {ACTION_ORDER.map((a) => (
              <div class={`bar-row ${a === last.action ? "chosen-row" : ""}`} key={a}>
                <span class="bar-glyph" title={ACTION_LABEL[a]}>
                  <span class="sr-only">{ACTION_LABEL[a]}: </span>
                  <Glyph glyph={ACTION_GLYPH[a]} size={14} />
                </span>
                <div class="bar">
                  <div style={{ width: `${Math.round((probabilities?.[a] ?? 0) * 100)}%` }} />
                </div>
                <span class="bar-num">{percent(probabilities?.[a])}</span>
              </div>
            ))}
          </div>
          <div class="history" title="Recent decisions">
            {state.history.map((h) => (
              <span class="chip" key={h.index} title={`${ACTION_LABEL[h.action]} at row ${h.row}`}>
                <span class="sr-only">
                  {ACTION_LABEL[h.action]} at row {h.row};{" "}
                </span>
                <span aria-hidden="true">
                  <Glyph glyph={ACTION_GLYPH[h.action]} size={14} />
                </span>
              </span>
            ))}
          </div>
          <div class="decision-actions">
            <span class="decision-buttons">
              {!theaterOpen && (
                <button type="button" class="text-button" onClick={onTheater}>
                  Watch (T)
                </button>
              )}
              {canInspect && (
                <button type="button" class="text-button" onClick={onInspect}>
                  What it read (I)
                </button>
              )}
            </span>
            {(decision?.note || decision?.confidence !== undefined) && (
              <details class="decision-details">
                <summary>Details</summary>
                {decision.note && <p class="hint">{decision.note}</p>}
                {decision.confidence !== undefined && (
                  <p class="hint">
                    confidence {decision.confidence.toFixed(2)}{" "}
                    <em>(undocumented by Cloudflare)</em>
                  </p>
                )}
              </details>
            )}
          </div>
        </>
      ) : (
        <p class="hint">{ACTIONS.length} possible moves. Waiting for the first decision…</p>
      )}
    </section>
  );
}
