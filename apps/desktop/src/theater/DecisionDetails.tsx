import { ACTION_ORDER } from "../format.ts";
import { actionLabel } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import { InputInspector } from "../panel/InputInspector.tsx";
import { StatsCard } from "../panel/StatsCard.tsx";
import type { SessionState } from "../session.ts";
import { barsOf, branchText } from "./choice.ts";
import { Glyph } from "./Glyph.tsx";
import type { DecisionPresentation } from "./presentation.ts";

export function DecisionDetails({
  view,
  state,
  fps,
  inputOpen,
  onInput,
  compassOn,
  onCompass,
}: {
  view: DecisionPresentation;
  state: SessionState;
  fps: number | undefined;
  inputOpen: boolean;
  onInput(open: boolean): void;
  compassOn: boolean;
  onCompass(): void;
}) {
  const translation = useI18n();
  const { t, percent } = translation;
  const round = view.round;
  const bars = round?.log ? barsOf(round.log) : null;
  const inspectButton = useRef<HTMLButtonElement>(null);
  const wasInputOpen = useRef(inputOpen);
  useLayoutEffect(() => {
    if (wasInputOpen.current && !inputOpen) inspectButton.current?.focus();
    wasInputOpen.current = inputOpen;
  }, [inputOpen]);
  return (
    <div class="decision-details-view">
      {round && (
        <>
          {round.scene && (
            <section class="decision-detail-section">
              <h3>{t("theater.game")}</h3>
              <p>{round.scene.phrase}</p>
              <ul>
                {round.scene.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
              {round.scene.platform && <p>{round.scene.platform.phrase}</p>}
            </section>
          )}
          <section class="decision-detail-section">
            <h3>{t("decisions.answers")}</h3>
            <p class="hint">{t("theater.probabilityHelp")}</p>
            {round.questions.map((question) => (
              <section
                class={`question-result ${question.skipped ? "question-unused" : ""}`}
                key={question.id}
              >
                <h4>{question.title}</h4>
                {question.skipped && (
                  <p class="hint">
                    {t("theater.unused")} {question.skipped}
                  </p>
                )}
                {question.options.map((option) => (
                  <div
                    class={`answer-result ${option.chosen ? "answer-picked" : ""}`}
                    key={option.id}
                  >
                    <span>
                      {option.chosen && <Glyph glyph="✓" size={14} />} {option.label}
                    </span>
                    <strong>{percent(option.p ?? undefined)}</strong>
                    {option.p !== null && (
                      <div class="answer-track">
                        <span style={{ width: `${option.p * 100}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
            {bars && (
              <details class="question-result">
                <summary>{t("theater.alternatives")}</summary>
                {bars.branch && (
                  <p class="hint">
                    {t("theater.routing", { branch: branchText(bars.branch, translation) })}
                  </p>
                )}
                {ACTION_ORDER.map((action) => (
                  <div class="answer-result" key={action}>
                    <span>{actionLabel(action, translation)}</span>
                    <strong>
                      {bars.blocked.has(action) ? t("theater.blocked") : percent(bars.p[action])}
                    </strong>
                    <div class="answer-track">
                      <span style={{ width: `${bars.p[action] * 100}%` }} />
                    </div>
                  </div>
                ))}
              </details>
            )}
          </section>
        </>
      )}
      <section class="decision-detail-section">
        <h3>{t("decisions.statistics")}</h3>
        <StatsCard state={state} />
        <p class="hint">
          {t("budget.game", {
            value: state.neurons,
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
        </p>
        {fps !== undefined && <p class="hint">{t("footer.fps", { count: Math.round(fps) })}</p>}
      </section>
      <section class="decision-detail-section">
        <button type="button" class="decision-link" aria-pressed={compassOn} onClick={onCompass}>
          {t("theater.compass")}
        </button>
      </section>
      {round?.log && (
        <section class="decision-detail-section">
          {inputOpen ? (
            <InputInspector
              key={round.index}
              history={round.history}
              policyId={state.policyId}
              onClose={() => onInput(false)}
            />
          ) : (
            <button
              ref={inspectButton}
              type="button"
              class="btn"
              onClick={() => onInput(true)}
              data-action="inspect-input"
            >
              {t("inspect.title")} (I)
            </button>
          )}
        </section>
      )}
    </div>
  );
}

import { useLayoutEffect, useRef } from "preact/hooks";
