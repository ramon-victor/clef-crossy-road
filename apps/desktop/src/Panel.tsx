import { isBudgetRefusal } from "@ccr/clef";
import type { BudgetStatus } from "./bridge/types.ts";
import { BudgetCard } from "./panel/BudgetCard.tsx";
import { ControlsCard } from "./panel/ControlsCard.tsx";
import { DecisionCard } from "./panel/DecisionCard.tsx";
import { Footer } from "./panel/Footer.tsx";
import { PlayerCard } from "./panel/PlayerCard.tsx";
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
  onSeed(seed: number): void;
  onSound(on: boolean): void;
  onAutoRestart(on: boolean): void;
}

function ErrorCard({ error }: { error: string }) {
  return (
    <section class="card warn">
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
  const choice = props.choices.find((c) => c.id === props.selectedId);
  return (
    <aside class="panel">
      <h1 class="title">
        Clef <span>Crossy Road</span>
      </h1>
      <PlayerCard
        choices={props.choices}
        selectedId={props.selectedId}
        human={state.human}
        timing={state.timing}
        onSelect={props.onSelect}
        onTiming={props.onTiming}
      />
      <ControlsCard
        state={state}
        onPause={props.onPause}
        onStep={props.onStep}
        onRetry={props.onRetry}
        onNewMap={props.onNewMap}
        onSpeed={props.onSpeed}
        onSeed={props.onSeed}
      />
      {state.error && <ErrorCard error={state.error} />}
      {!state.human && <DecisionCard state={state} />}
      <StatsCard state={state} />
      <BudgetCard budget={props.budget} choice={choice} gameNeurons={state.neurons} />
      <Footer
        fps={props.fps}
        soundOn={props.soundOn}
        autoRestart={props.autoRestart}
        bridgeKind={props.bridgeKind}
        onSound={props.onSound}
        onAutoRestart={props.onAutoRestart}
      />
    </aside>
  );
}
