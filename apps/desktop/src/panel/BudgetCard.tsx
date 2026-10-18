import type { BudgetStatus } from "../bridge/types.ts";
import { meterLevel } from "../format.ts";
import { useI18n } from "../i18n/provider.tsx";

export interface BudgetCardProps {
  budget: BudgetStatus | null;
  /** Neurons charged during the current game. */
  gameNeurons: number;
}

export function BudgetCard({ budget, gameNeurons }: BudgetCardProps) {
  const { t, number } = useI18n();
  const exhausted = budget !== null && budget.spent >= budget.limit;
  return (
    <section class={`card budget${exhausted ? " warn" : ""}`}>
      <div class="budget-head">
        <div class="field-label" title={t("budget.help")}>
          {t("budget.today")}
        </div>
        {budget && (
          <div class="budget-total">
            <strong>{number(Math.round(budget.spent))}</strong>
            <span> / {number(budget.limit)}</span>
          </div>
        )}
      </div>
      {budget ? (
        <>
          <div
            class="meter"
            data-level={meterLevel(budget.spent, budget.limit)}
            role="progressbar"
            aria-label={t("budget.label")}
            aria-valuemin={0}
            aria-valuemax={budget.limit}
            aria-valuenow={Math.min(budget.spent, budget.limit)}
            aria-valuetext={t("budget.used", {
              spent: Math.round(budget.spent),
              limit: budget.limit,
            })}
          >
            <div
              class="meter-fill"
              style={{ width: `${Math.min(100, (budget.spent / budget.limit) * 100)}%` }}
            />
          </div>
          {exhausted && <p class="hint">{t("budget.limit")}</p>}
        </>
      ) : (
        <p class="hint">{t("common.unavailable")}</p>
      )}
      <p class="hint">
        {t("budget.game", {
          value: gameNeurons,
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}
      </p>
    </section>
  );
}
