import { ACTIONS } from "@ccr/core";
import { ACTION_GLYPH, ACTION_ORDER } from "../format.ts";
import { actionLabel, noticeText } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";

export interface DecisionCardProps {
  state: SessionState;
  onInspect(): void;
}

export function DecisionCard({ state, onInspect }: DecisionCardProps) {
  const translation = useI18n();
  const { t, percent } = translation;
  const action = (value: (typeof ACTION_ORDER)[number]) => actionLabel(value, translation);
  const last = state.last;
  const decision = last?.decision;
  const probabilities = decision?.probabilities;
  const canInspect = state.history.some((entry) => entry.decision.sent);

  return (
    <section class="card decision">
      <header class="decision-head">
        <div class="field-label">
          {t(state.phase === "thinking" ? "decision.thinking" : "decision.last")}
        </div>
        {decision?.cached && <span class="tag">{t("decision.cached")}</span>}
        {decision?.source === "executor" && <span class="tag">{t("decision.controller")}</span>}
      </header>
      {last ? (
        <>
          <div class="chosen">
            <span class="chosen-arrow">{ACTION_GLYPH[last.action]}</span>
            <span>{action(last.action)}</span>
          </div>
          {!probabilities && decision?.source !== "executor" && (
            <p class="hint">{t("decision.noProbabilities")}</p>
          )}
          {decision?.source === "executor" && <p class="hint">{t("decision.controllerStep")}</p>}
          <div class="bars" hidden={!probabilities}>
            {ACTION_ORDER.map((a) => (
              <div class={`bar-row ${a === last.action ? "chosen-row" : ""}`} key={a}>
                <span class="bar-glyph" title={action(a)}>
                  <span class="sr-only">{action(a)}: </span>
                  {ACTION_GLYPH[a]}
                </span>
                <div class="bar">
                  <div style={{ width: `${Math.round((probabilities?.[a] ?? 0) * 100)}%` }} />
                </div>
                <span class="bar-num">{percent(probabilities?.[a])}</span>
              </div>
            ))}
          </div>
          <div class="history" title={t("decision.recent")}>
            {state.history.map((h) => (
              <span
                class="chip"
                key={h.index}
                title={t("decision.atRow", { action: action(h.action), row: h.row })}
              >
                <span class="sr-only">
                  {t("decision.atRow", { action: action(h.action), row: h.row })};{" "}
                </span>
                <span aria-hidden="true">{ACTION_GLYPH[h.action]}</span>
              </span>
            ))}
          </div>
          <div class="decision-actions">
            {canInspect && (
              <button type="button" class="text-button" onClick={onInspect}>
                {t("decision.inspect")}
              </button>
            )}
            {(decision?.note || decision?.confidence !== undefined) && (
              <details class="decision-details">
                <summary>{t("common.details")}</summary>
                {decision.notice ? (
                  <p class="hint">{noticeText(decision.notice, translation)}</p>
                ) : (
                  decision.note && (
                    <p class="hint" lang="en">
                      {decision.note}
                    </p>
                  )
                )}
                {decision.confidence !== undefined && (
                  <p class="hint">
                    {t("decision.confidence", {
                      value: decision.confidence,
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                )}
              </details>
            )}
          </div>
        </>
      ) : (
        <p class="hint">{t("decision.waiting", { count: ACTIONS.length })}</p>
      )}
    </section>
  );
}
