import { useState } from "preact/hooks";
import type { CredentialStatus } from "../bridge/types.ts";
import { useI18n } from "../i18n/provider.tsx";
import { parseSeedText } from "../seed.ts";
import type { SessionState, Timing } from "../session.ts";
import { PACES, type Pace } from "../theater/preference.ts";
import { LanguageSelect } from "./LanguageSelect.tsx";

const SPEEDS = [0.5, 1, 2, 4];
const TIMINGS = ["step", "realtime"] as const;

export interface SetupCardProps {
  state: SessionState;
  autoRestart: boolean;
  credentials: CredentialStatus | null;
  configuring: boolean;
  onConfigure(): void;
  onTiming(timing: Timing): void;
  /** How long a model's answer stands before the chicken moves; null for a player that asks no model. */
  pace: Pace | null;
  onPace(pace: Pace): void;
  onSpeed(speed: number): void;
  onSeed(seed: number): void;
  onAutoRestart(on: boolean): void;
}

export function SetupCard({
  state,
  autoRestart,
  credentials,
  configuring,
  onConfigure,
  onTiming,
  pace,
  onPace,
  onSpeed,
  onSeed,
  onAutoRestart,
}: SetupCardProps) {
  const { t, number } = useI18n();
  const [seedText, setSeedText] = useState("");
  const timing = t(state.human ? "setup.human" : `setup.${state.timing}`);
  return (
    <details class="card setup">
      <summary>
        <span class="setup-label">{t("setup.title")}</span>
        <span class="setup-current">
          {t("setup.summary", { timing, speed: state.speed, seed: String(state.seed) })}
        </span>
      </summary>
      <div class="setup-body">
        <LanguageSelect />
        {!state.human && (
          <fieldset class="segmented">
            <legend>{t("setup.timing")}</legend>
            {TIMINGS.map((timingOption) => (
              <button
                type="button"
                key={timingOption}
                class={state.timing === timingOption ? "on" : ""}
                aria-pressed={state.timing === timingOption}
                onClick={() => onTiming(timingOption)}
                title={t(`setup.${timingOption}Help`)}
              >
                {t(`setup.${timingOption}`)}
              </button>
            ))}
          </fieldset>
        )}
        {pace !== null && (
          <fieldset class="segmented" aria-describedby="pace-help">
            <legend>{t("setup.pace")}</legend>
            {PACES.map((option) => (
              <button
                type="button"
                key={option}
                class={pace === option ? "on" : ""}
                aria-pressed={pace === option}
                disabled={state.timing !== "step"}
                onClick={() => onPace(option)}
              >
                {t(`setup.pace.${option}`)}
              </button>
            ))}
          </fieldset>
        )}
        {pace !== null && (
          <p id="pace-help" class="hint">
            {state.timing === "step" ? t("setup.paceHelp") : t("setup.paceStepOnly")}
          </p>
        )}
        <fieldset class="speeds">
          <legend>{t("setup.speed")}</legend>
          {SPEEDS.map((speed) => (
            <button
              type="button"
              key={speed}
              class={state.speed === speed ? "on" : ""}
              aria-pressed={state.speed === speed}
              onClick={() => onSpeed(speed)}
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
              onSeed(seed);
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
        <div>
          <label class="check">
            <input
              type="checkbox"
              checked={autoRestart}
              aria-describedby="auto-restart-help"
              onChange={(event) => onAutoRestart(event.currentTarget.checked)}
            />
            {t("setup.autoRestart")}
          </label>
          <p id="auto-restart-help" class="hint">
            {t("setup.autoRestartHelp")}
          </p>
        </div>
        <div class="connection-setting">
          <div>
            <strong>Cloudflare</strong>
            <p class="hint">
              {credentials === null
                ? t("setup.statusUnavailable")
                : credentials.configured
                  ? t("setup.configured")
                  : t("setup.notConfigured")}
            </p>
          </div>
          <button type="button" class="btn small" onClick={onConfigure} disabled={configuring}>
            {t(configuring ? "windows.pausing" : "setup.configure")}
          </button>
        </div>
      </div>
    </details>
  );
}
