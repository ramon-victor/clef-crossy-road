import { isBudgetRefusal } from "@ccr/clef";
import type { BudgetStatus } from "./bridge/types.ts";
import { BudgetCard } from "./panel/BudgetCard.tsx";
import { ControlsCard } from "./panel/ControlsCard.tsx";
import { DecisionCard } from "./panel/DecisionCard.tsx";
import { Footer } from "./panel/Footer.tsx";
import { PlayerCard } from "./panel/PlayerCard.tsx";
import { SetupCard } from "./panel/SetupCard.tsx";
import { StatsCard } from "./panel/StatsCard.tsx";
import type { PolicyChoice } from "./policies.ts";
import type { SessionState, Timing } from "./session.ts";

export interface PanelProps {
  state: SessionState;
  choices: PolicyChoice[];
  selectedId: string;
  budget: BudgetStatus | null;
  fps: number;
  soundOn: boolean;
  autoRestart: boolean;
  bridgeKind: "tauri" | "http";
  onSelect(id: string): void;
  onTiming(timing: Timing): void;
  onSpeed(speed: number): void;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
  onInspect(): void;
  onSeed(seed: number): void;
  onSound(on: boolean): void;
  onAutoRestart(on: boolean): void;
}

function ErrorCard({ error }: { error: string }) {
  return (
    <section class="card warn error-card">
      <strong>Stopped</strong>
      <p>{error}</p>
      {isBudgetRefusal(error) && (
        <p class="small">
          The free tier is spent for today (it resets at 00:00 UTC). Cached decisions still play for
          free. Pick another player, or come back later.
        </p>
      )}
    </section>
  );
}

export function Panel(props: PanelProps) {
  const { state } = props;
  return (
    <aside class="panel" aria-label="Game controls and decisions">
      <h1 class="sr-only">Clef Crossy Road</h1>
      <div class="panel-top">
        <PlayerCard
          choices={props.choices}
          selectedId={props.selectedId}
          bridgeKind={props.bridgeKind}
          onSelect={props.onSelect}
        />
        <ControlsCard
          state={state}
          onPause={props.onPause}
          onStep={props.onStep}
          onRetry={props.onRetry}
          onNewMap={props.onNewMap}
        />
      </div>
      <div class="panel-body">
        <SetupCard
          state={state}
          autoRestart={props.autoRestart}
          onTiming={props.onTiming}
          onSpeed={props.onSpeed}
          onSeed={props.onSeed}
          onAutoRestart={props.onAutoRestart}
        />
        {state.error && <ErrorCard error={state.error} />}
        {!state.human && <DecisionCard state={state} onInspect={props.onInspect} />}
        <StatsCard state={state} />
      </div>
      <div class="panel-bottom">
        <BudgetCard budget={props.budget} gameNeurons={state.neurons} />
        <Footer fps={props.fps} soundOn={props.soundOn} onSound={props.onSound} />
      </div>
    </aside>
  );
}
