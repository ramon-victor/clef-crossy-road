import { decidedBy } from "@ccr/agent";
import { ACTION_GLYPH } from "../format.ts";
import { actionLabel, noticeText } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import { controllerSays, recordedSteps } from "./controller.ts";
import type { TurnView } from "./feed.ts";
import { Glyph } from "./Glyph.tsx";

/** Only this consultation's released actions, in order. A held answer has sent nothing. */
export function ExecutionList({ round }: { round: TurnView }) {
  const translation = useI18n();
  const { t, number } = translation;
  const steps = recordedSteps(round.pending ? [] : round.history);
  return (
    <section class="decision-execution">
      <h4>{t("decisions.execution")}</h4>
      {steps.length === 0 ? (
        <p class="hint">{t("decisions.noSteps")}</p>
      ) : (
        <ol class="decision-step-list">
          {steps.map(({ log, count }) => (
            <li key={log.index}>
              <span class="step-icon">
                <Glyph glyph={ACTION_GLYPH[log.action]} size={16} />
              </span>
              <div>
                <strong>
                  {actionLabel(log.action, translation)}
                  {count > 1 && ` ×${number(count)}`}
                </strong>
                <p>
                  {controllerSays(log.decision, translation) ??
                    (log.decision.notice
                      ? noticeText(log.decision.notice, translation)
                      : log.decision.note) ??
                    t("decisions.sent")}
                </p>
                {decidedBy(log.decision) === "controller" && (
                  <small>{t("decisions.controller")}</small>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
