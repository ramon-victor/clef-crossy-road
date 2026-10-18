import type { ComponentChildren } from "preact";
import type { ErrorInfo } from "./bridge/errors.ts";
import type { ControlsData } from "./controls.ts";
import { useI18n } from "./i18n/provider.tsx";
import { BudgetCard } from "./panel/BudgetCard.tsx";
import { ControlsCard } from "./panel/ControlsCard.tsx";
import { DecisionCard } from "./panel/DecisionCard.tsx";
import { ErrorMessage } from "./panel/ErrorMessage.tsx";
import { Footer } from "./panel/Footer.tsx";
import { PlayerCard } from "./panel/PlayerCard.tsx";
import { SetupCard } from "./panel/SetupCard.tsx";
import { StatsCard } from "./panel/StatsCard.tsx";
import type { Timing } from "./session.ts";
import type { Pace } from "./theater/preference.ts";

export interface PanelProps extends ControlsData {
  controlError: string | null;
  configuring: boolean;
  conversation?: ComponentChildren;
  onConfigure(): void;
  onSelect(id: string): void;
  onTiming(timing: Timing): void;
  onSpeed(speed: number): void;
  onPause(): void;
  onStep(): void;
  onRetry(): void;
  onNewMap(): void;
  onInspect(): void;
  onTheater(): void;
  /** How long a model's answer stands before the chicken moves; null for a player that asks no model. */
  onPace(pace: Pace): void;
  onSeed(seed: number): void;
  onSound(on: boolean): void;
  onAutoRestart(on: boolean): void;
}

function ErrorCard({ info }: { info: ErrorInfo }) {
  const { t } = useI18n();
  return (
    <section class="card warn error-card">
      <strong>{t("error.stopped")}</strong>
      <ErrorMessage info={info} />
    </section>
  );
}

export function Panel(props: PanelProps) {
  const { state } = props;
  const { t } = useI18n();
  return (
    <aside class="panel" aria-label={t("panel.label")}>
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
          minimized={props.minimized}
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
          credentials={props.credentials}
          configuring={props.configuring}
          onConfigure={props.onConfigure}
          onTiming={props.onTiming}
          pace={props.pace}
          onPace={props.onPace}
          onSpeed={props.onSpeed}
          onSeed={props.onSeed}
          onAutoRestart={props.onAutoRestart}
        />
        {props.conversation}
        {props.controlError && (
          <p class="connection-error" role="alert">
            {props.controlError}
          </p>
        )}
        {props.minimized && (
          <p class="hint" role="status">
            {t("windows.minimized")}
          </p>
        )}
        {state.error && (
          <ErrorCard info={state.errorInfo ?? { code: "unknown", detail: state.error }} />
        )}
        {!state.human && (
          <DecisionCard
            state={state}
            theaterOpen={props.theaterOpen}
            onInspect={props.onInspect}
            onTheater={props.onTheater}
          />
        )}
        <StatsCard state={state} />
      </div>
      <div class="panel-bottom">
        <BudgetCard budget={props.budget} gameNeurons={state.neurons} />
        <Footer fps={props.fps} soundOn={props.soundOn} onSound={props.onSound} />
      </div>
    </aside>
  );
}
