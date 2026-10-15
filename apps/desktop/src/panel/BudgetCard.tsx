import type { BudgetStatus } from "../bridge/types.ts";
import { meterLevel } from "../format.ts";

export interface BudgetCardProps {
  budget: BudgetStatus | null;
  /** Neurons charged during the current game. */
  gameNeurons: number;
}

export function BudgetCard({ budget, gameNeurons }: BudgetCardProps) {
  const exhausted = budget !== null && budget.spent >= budget.limit;
  return (
    <section class={`card budget${exhausted ? " warn" : ""}`}>
      <div class="budget-head">
        <div class="field-label">Neurons today (UTC)</div>
        {budget && (
          <div class="budget-total">
            <strong>{Math.round(budget.spent).toLocaleString("en-US")}</strong>
            <span> / {budget.limit.toLocaleString("en-US")}</span>
          </div>
        )}
      </div>
      {budget ? (
        <>
          <div
            class="meter"
            data-level={meterLevel(budget.spent, budget.limit)}
            role="progressbar"
            aria-label="Daily free neurons used"
            aria-valuemin={0}
            aria-valuemax={budget.limit}
            aria-valuenow={Math.min(budget.spent, budget.limit)}
            aria-valuetext={`${Math.round(budget.spent)} of ${budget.limit} neurons used`}
          >
            <div
              class="meter-fill"
              style={{ width: `${Math.min(100, (budget.spent / budget.limit) * 100)}%` }}
            />
          </div>
          {exhausted && <p class="hint">Limit reached · new calls refused.</p>}
        </>
      ) : (
        <p class="hint">unavailable</p>
      )}
      <p class="hint">This game: {gameNeurons.toFixed(1)} neurons</p>
    </section>
  );
}
