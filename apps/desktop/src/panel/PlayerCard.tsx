import type { PlayerOption } from "../controls.ts";
import { playerText } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import { type ChoiceKind, CLEF_27B_ID, CLEF_ID } from "../policies.ts";

const GROUPS: readonly ChoiceKind[] = ["model", "human", "reference"];

export interface PlayerCardProps {
  choices: readonly PlayerOption[];
  selectedId: string;
  bridgeKind: "tauri" | "http";
  onSelect(id: string): void;
}

export function PlayerCard({ choices, selectedId, bridgeKind, onSelect }: PlayerCardProps) {
  const translation = useI18n();
  const { t } = translation;
  const choice = choices.find((c) => c.id === selectedId);
  const text = choice ? playerText(choice, translation) : null;
  return (
    <section class="player-card">
      <div class="player-label">
        <label class="field-label" for="player">
          {t("player.who")}
        </label>
        <span class="player-kind">
          {choice?.kind === "model"
            ? selectedId === CLEF_ID || selectedId === CLEF_27B_ID
              ? t("player.modelController")
              : t("player.model")
            : choice?.kind === "reference"
              ? t("player.reference")
              : t("player.arrows")}
        </span>
      </div>
      <div class="player-row">
        <select
          id="player"
          class="select"
          value={selectedId}
          aria-describedby={choice?.usesApi ? "player-cost" : undefined}
          onChange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
        >
          {GROUPS.map((kind) => (
            <optgroup label={t(`player.group.${kind}`)} key={kind}>
              {choices
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <option value={c.id} key={c.id} disabled={!c.available}>
                    {playerText(c, translation).label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          class="info-button"
          popovertarget="player-info"
          aria-label={t("player.about", { player: text?.label ?? "Clef" })}
          title={t("player.aboutHelp")}
        >
          i
        </button>
      </div>
      {choice?.usesApi && (
        <p id="player-cost" class="hint spend-note">
          {choice.freeReplay
            ? t("player.cacheCost", { range: choice.freeReplay })
            : t("player.newCost")}
        </p>
      )}
      <section
        id="player-info"
        class="player-info"
        popover="auto"
        role="dialog"
        aria-labelledby="player-info-title"
      >
        <header class="info-head">
          <h2 id="player-info-title">Clef Crossy Road</h2>
          <button
            type="button"
            class="info-button"
            popovertarget="player-info"
            popovertargetaction="hide"
            aria-label={t("player.closeInfo")}
          >
            ×
          </button>
        </header>
        <p class="hint">{t("player.intro")}</p>
        <h3>{text?.label}</h3>
        <p>{text?.detail}</p>
        {choice?.usesApi && (
          <p>
            {t("player.cost", {
              cost: choice.neuronsPerDecision ?? 0,
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </p>
        )}
        {choice?.freeReplay && <p>{t("player.replays", { range: choice.freeReplay })}</p>}
        <h3>{t("player.keys")}</h3>
        <dl class="key-help">
          <dt>↑ ← ↓ → / WASD</dt>
          <dd>{t("player.moveHelp")}</dd>
          <dt>{t("controls.space")}</dt>
          <dd>{t("player.pauseHelp")}</dd>
          <dt>N</dt>
          <dd>{t("player.stepHelp")}</dd>
          <dt>R / M</dt>
          <dd>{t("player.retryHelp")}</dd>
          <dt>I</dt>
          <dd>{t("inspect.title")}</dd>
          {bridgeKind === "tauri" && (
            <>
              <dt>F2</dt>
              <dd>{t("windows.openControls")}</dd>
            </>
          )}
        </dl>
        <p class="hint">{t("player.shortcutsHelp")}</p>
        <p class="hint">{t(bridgeKind === "tauri" ? "player.desktop" : "player.browser")}</p>
      </section>
    </section>
  );
}
