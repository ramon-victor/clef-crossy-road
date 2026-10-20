import type { ControlsData } from "./controls.ts";
import { useI18n } from "./i18n/provider.tsx";
import { BudgetCard } from "./panel/BudgetCard.tsx";
import { ControlsCard } from "./panel/ControlsCard.tsx";
import { PlayerCard } from "./panel/PlayerCard.tsx";
import { SetupCard } from "./panel/SetupCard.tsx";
import type { Timing } from "./session.ts";

export interface PanelProps extends ControlsData {
  controlError: string | null;
  configuring: boolean;
  onConfigure(): void;
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

export function Panel(props: PanelProps) {
  const { state } = props;
  const { t } = useI18n();
  return (
    <aside class="panel" aria-label={t("panel.label")}>
      <h1 class="sr-only">Clef Crossy Road</h1>
      <div class="panel-top">
        <header class="panel-heading">
          <h2>{t("controls.title")}</h2>
          <span class="surface-status">
            {t(
              state.error
                ? "decisions.stage.error"
                : !state.alive || state.stalled
                  ? "decisions.stage.ended"
                  : state.paused
                    ? "decisions.stage.paused"
                    : "decisions.live",
            )}
          </span>
        </header>
        <PlayerCard
          choices={props.choices}
          selectedId={props.selectedId}
          bridgeKind={props.bridgeKind}
          onSelect={props.onSelect}
        />
        <BudgetCard budget={props.budget} />
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
          soundOn={props.soundOn}
          onSound={props.onSound}
          onSpeed={props.onSpeed}
          onSeed={props.onSeed}
          onAutoRestart={props.onAutoRestart}
        />
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
      </div>
    </aside>
  );
}
