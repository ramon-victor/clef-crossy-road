import type { BudgetStatus } from "../bridge/types.ts";
import { meterLevel } from "../format.ts";
import type { PolicyChoice } from "../policies.ts";

export interface BudgetCardProps {
  budget: BudgetStatus | null;
  /** The selected player, to show what one more decision would cost. */
  choice: PolicyChoice | undefined;
  /** Neurons charged during the current game. */
  gameNeurons: number;
}

export function BudgetCard({ budget, choice, gameNeurons }: BudgetCardProps) {
  const exhausted = budget !== null && budget.spent >= budget.limit;
  return (
    <section class="card">
      <div class="field-label">Neurons today (UTC)</div>
      {budget ? (
        <>
          <div class="meter" data-level={meterLevel(budget.spent, budget.limit)}>
            <div
              class="meter-fill"
              style={{ width: `${Math.min(100, (budget.spent / budget.limit) * 100)}%` }}
            />
          </div>
          <p class="hint">
            {Math.round(budget.spent).toLocaleString("en-US")} /{" "}
            {budget.limit.toLocaleString("en-US")} free
            {exhausted ? " · budget reached: new model calls are refused" : ""}
            {gameNeurons > 0 ? ` · this game ${gameNeurons.toFixed(1)}` : ""}
          </p>
          {choice?.usesApi && !exhausted && (
            <p class="hint">
              ≈ {choice.neuronsPerDecision?.toFixed(1)} neurons per new decision (cache hits are
              free)
            </p>
          )}
        </>
      ) : (
        <p class="hint">unavailable</p>
      )}
    </section>
  );
}
