import { ACTIONS } from "@ccr/core";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER, percent } from "../format.ts";
import type { SessionState } from "../session.ts";

export interface DecisionCardProps {
  state: SessionState;
  onInspect(): void;
}

export function DecisionCard({ state, onInspect }: DecisionCardProps) {
  const last = state.last;
  const decision = last?.decision;
  const probabilities = decision?.probabilities;
  const canInspect = state.history.some((entry) => entry.decision.sent);

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
            <span class="chosen-arrow">{ACTION_GLYPH[last.action]}</span>
            <span>{ACTION_LABEL[last.action]}</span>
          </div>
          {!probabilities && decision?.source !== "executor" && (
            <p class="hint">No probabilities reported.</p>
          )}
          {decision?.source === "executor" && <p class="hint">Controller step · no model call.</p>}
          <div class="bars" hidden={!probabilities}>
            {ACTION_ORDER.map((a) => (
              <div class={`bar-row ${a === last.action ? "chosen-row" : ""}`} key={a}>
                <span class="bar-glyph" title={ACTION_LABEL[a]}>
                  <span class="sr-only">{ACTION_LABEL[a]}: </span>
                  {ACTION_GLYPH[a]}
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
                <span aria-hidden="true">{ACTION_GLYPH[h.action]}</span>
              </span>
            ))}
          </div>
          <div class="decision-actions">
            {canInspect && (
              <button type="button" class="text-button" onClick={onInspect}>
                What it read (I)
              </button>
            )}
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
