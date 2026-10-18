import { ACTIONS } from "@ccr/core";
import { ACTION_GLYPH, ACTION_ORDER } from "../format.ts";
import { actionLabel, noticeText } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";
import { branchText, modelChoice } from "../theater/choice.ts";
import { controllerSays, waitsForGap } from "../theater/controller.ts";
import { Glyph } from "../theater/Glyph.tsx";
import { decisionLabel } from "../theater/labels.ts";

export interface DecisionCardProps {
  state: SessionState;
  theaterOpen: boolean;
  detached?: boolean;
  onInspect(): void;
  onTheater(): void;
}

export function DecisionCard({
  state,
  theaterOpen,
  detached = false,
  onInspect,
  onTheater,
}: DecisionCardProps) {
  const translation = useI18n();
  const { t, percent } = translation;
  const action = (value: (typeof ACTION_ORDER)[number]) => actionLabel(value, translation);
  const last = state.last;
  const decision = last?.decision;
  const chosen = last ? modelChoice(last) : null;
  const bars = chosen?.bars ?? null;
  const probabilities = bars ? bars.p : decision?.probabilities;
  const canInspect = state.history.some((entry) => entry.decision.sent);
  // What the model chose (a manoeuvre) is what the card names; the move the controller starts with, or the wait
  // it takes, can be another thing and is said on its own line.
  const maneuver = decision?.extra?.maneuver;
  const choice =
    last && decision?.source !== "executor" && typeof maneuver === "string"
      ? decisionLabel(maneuver, last.action, translation)
      : null;
  const turn = state.turns.at(-1);
  const waits = choice !== null && turn !== undefined && turn.model === last && waitsForGap(turn);
  const says = decision ? controllerSays(decision, translation) : null;
  const chosenMove = chosen?.move ?? last?.action;
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
            <span class="chosen-arrow">
              <Glyph glyph={choice ? choice.glyph : ACTION_GLYPH[last.action]} size={22} />
            </span>
            <span>
              {choice
                ? waits
                  ? t("theater.whenClear", { move: choice.label })
                  : choice.label
                : action(last.action)}
            </span>
          </div>
          {!probabilities && decision?.source !== "executor" && (
            <p class="hint">{t("decision.noProbabilities")}</p>
          )}
          {decision?.source === "executor" && (
            <p class="hint">{t("theater.controllerStep", { step: says ?? t("theater.noCall") })}</p>
          )}
          {decision?.source !== "executor" && says && (
            <p class="hint">{t("theater.controllerSays", { step: says })}</p>
          )}
          {bars?.branch && (
            <p class="hint">
              {t("theater.routing", { branch: branchText(bars.branch, translation) })}
            </p>
          )}
          <div class="bars" hidden={!probabilities}>
            {ACTION_ORDER.map((a) => (
              <div class={`bar-row ${a === chosenMove ? "chosen-row" : ""}`} key={a}>
                <span class="bar-glyph" title={action(a)}>
                  <span class="sr-only">{action(a)}: </span>
                  <Glyph glyph={ACTION_GLYPH[a]} size={14} />
                </span>
                <div class="bar">
                  <div style={{ width: `${Math.round((probabilities?.[a] ?? 0) * 100)}%` }} />
                </div>
                <span class="bar-num">
                  {bars?.blocked.has(a) ? t("theater.blocked") : percent(probabilities?.[a])}
                </span>
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
                <span aria-hidden="true">
                  <Glyph glyph={ACTION_GLYPH[h.action]} size={14} />
                </span>
              </span>
            ))}
          </div>
          <div class="decision-actions">
            <span class="decision-buttons">
              {(detached || !theaterOpen) && (
                <button type="button" class="text-button" onClick={onTheater}>
                  {t(detached ? "theater.title" : "theater.watch")}
                </button>
              )}
              {canInspect && (
                <button type="button" class="text-button" onClick={onInspect}>
                  {t("decision.inspect")}
                </button>
              )}
            </span>
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
