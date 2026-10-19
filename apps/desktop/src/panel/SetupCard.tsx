import { useState } from "preact/hooks";
import type { BudgetStatus, CredentialStatus } from "../bridge/types.ts";
import { useI18n } from "../i18n/provider.tsx";
import { parseSeedText } from "../seed.ts";
import type { SessionState, Timing } from "../session.ts";
import { BudgetCard } from "./BudgetCard.tsx";
import { LanguageSelect } from "./LanguageSelect.tsx";

const SPEEDS = [0.5, 1, 2, 4];
const TIMINGS = ["step", "realtime"] as const;

export interface SetupCardProps {
  state: SessionState;
  autoRestart: boolean;
  credentials: CredentialStatus | null;
  budget: BudgetStatus | null;
  soundOn: boolean;
  configuring: boolean;
  onConfigure(): void;
  onTiming(timing: Timing): void;
  onSpeed(speed: number): void;
  onSeed(seed: number): void;
  onAutoRestart(on: boolean): void;
  onSound(on: boolean): void;
}

/** Settings have no decision telemetry; account usage belongs with the account. */
export function SetupCard(props: SetupCardProps) {
  const { state } = props;
  const { t, number } = useI18n();
  const [seedText, setSeedText] = useState("");
  return (
    <>
      <details class="card setup" open>
        <summary>{t("settings.game")}</summary>
        <div class="setup-body">
          {!state.human && (
            <fieldset class="segmented">
              <legend>{t("setup.timing")}</legend>
              {TIMINGS.map((timing) => (
                <button
                  type="button"
                  key={timing}
                  class={state.timing === timing ? "on" : ""}
                  aria-pressed={state.timing === timing}
                  onClick={() => props.onTiming(timing)}
                >
                  {t(`setup.${timing}`)}
                </button>
              ))}
            </fieldset>
          )}
          <fieldset class="speeds">
            <legend>{t("setup.speed")}</legend>
            {SPEEDS.map((speed) => (
              <button
                type="button"
                key={speed}
                class={state.speed === speed ? "on" : ""}
                aria-pressed={state.speed === speed}
                onClick={() => props.onSpeed(speed)}
              >
                {number(speed)}×
              </button>
            ))}
          </fieldset>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const seed = parseSeedText(seedText);
              if (seed !== undefined) {
                props.onSeed(seed);
                setSeedText("");
              }
            }}
          >
            <label class="field-label" for="map-seed">
              {t("setup.seed")}
            </label>
            <div class="seed">
              <input
                id="map-seed"
                class="input"
                inputMode="numeric"
                placeholder={String(state.seed)}
                value={seedText}
                onInput={(event) => setSeedText(event.currentTarget.value)}
              />
              <button type="submit" class="btn small">
                {t("setup.go")}
              </button>
            </div>
          </form>
          <label class="check">
            <input
              type="checkbox"
              checked={props.autoRestart}
              aria-describedby="auto-restart-help"
              onChange={(event) => props.onAutoRestart(event.currentTarget.checked)}
            />
            {t("setup.autoRestart")}
          </label>
          <p id="auto-restart-help" class="hint">
            {t("setup.autoRestartHelp")}
          </p>
        </div>
      </details>
      <details class="card setup appearance-settings">
        <summary>{t("settings.appearance")}</summary>
        <div class="setup-body">
          <LanguageSelect />
          <label class="check">
            <input
              type="checkbox"
              checked={props.soundOn}
              onChange={(event) => props.onSound(event.currentTarget.checked)}
            />
            {t("footer.sound")}
          </label>
        </div>
      </details>
      <details class="card setup account-settings">
        <summary>Cloudflare</summary>
        <div class="setup-body">
          <div class="connection-setting">
            <p class="hint">
              {props.credentials === null
                ? t("setup.statusUnavailable")
                : t(props.credentials.configured ? "setup.configured" : "setup.notConfigured")}
            </p>
            <button
              type="button"
              class="btn small"
              onClick={props.onConfigure}
              disabled={props.configuring}
            >
              {t(props.configuring ? "windows.pausing" : "setup.configure")}
            </button>
          </div>
          <BudgetCard budget={props.budget} />
        </div>
      </details>
    </>
  );
}
