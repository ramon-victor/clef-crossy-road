import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER, percent } from "../format.ts";
import type { SessionState } from "../session.ts";

type Shown = "probability" | "risk" | "none";

function heading(shown: Shown, thinking: boolean): string {
  if (thinking) return "Thinking…";
  return shown === "risk" ? "Chance of dying, per move (model's answer)" : "Last decision";
}

export function DecisionCard({ state }: { state: SessionState }) {
  const last = state.last;
  const decision = last?.decision;
  const risk = decision?.extra?.risk as Record<Action, number> | undefined;
  const probabilities = decision?.probabilities;
  const shown: Shown = probabilities ? "probability" : risk ? "risk" : "none";

  return (
    <section class="card decision">
      <div class="field-label">{heading(shown, state.phase === "thinking")}</div>
      {last ? (
        <>
          <div class="chosen">
            <span class="chosen-arrow">{ACTION_GLYPH[last.action]}</span>
            <span>{ACTION_LABEL[last.action]}</span>
            {decision?.cached && <span class="tag">cached</span>}
          </div>
          {shown === "none" && (
            <p class="hint">
              This player does not report probabilities: it is a reference, not a model.
            </p>
          )}
          <div class="bars" hidden={shown === "none"}>
            {ACTION_ORDER.map((a) => {
              const value = shown === "risk" ? risk?.[a] : probabilities?.[a];
              return (
                <div class={`bar-row ${a === last.action ? "chosen-row" : ""}`} key={a}>
                  <span class="bar-glyph">{ACTION_GLYPH[a]}</span>
                  <div class="bar">
                    <div
                      class={shown === "risk" ? "risk" : ""}
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
