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

  return (
    <section class="card decision">
      <div class="field-label">{state.phase === "thinking" ? "Thinking…" : "Last decision"}</div>
      {last ? (
        <>
          <div class="chosen">
            <span class="chosen-arrow">{ACTION_GLYPH[last.action]}</span>
            <span>{ACTION_LABEL[last.action]}</span>
            {decision?.cached && <span class="tag">cached</span>}
            {decision?.source === "executor" && <span class="tag">controller</span>}
          </div>
          {decision?.note && <p class="hint">{decision.note}</p>}
          {!probabilities && decision?.source !== "executor" && (
            <p class="hint">
              This player does not report probabilities: it is a reference, not a model.
            </p>
          )}
          <div class="bars" hidden={!probabilities}>
            {ACTION_ORDER.map((a) => (
              <div class={`bar-row ${a === last.action ? "chosen-row" : ""}`} key={a}>
                <span class="bar-glyph">{ACTION_GLYPH[a]}</span>
                <div class="bar">
                  <div style={{ width: `${Math.round((probabilities?.[a] ?? 0) * 100)}%` }} />
                </div>
                <span class="bar-num">{percent(probabilities?.[a])}</span>
              </div>
            ))}
          </div>
          {decision?.confidence !== undefined && (
            <p class="hint">
              confidence {decision.confidence.toFixed(2)} <em>(undocumented by Cloudflare)</em>
            </p>
          )}
          {decision?.sent && (
            <button type="button" class="btn small inspect-button" onClick={onInspect}>
              What it read (I)
            </button>
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
