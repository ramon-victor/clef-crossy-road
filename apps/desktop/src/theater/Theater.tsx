import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ACTION_GLYPH } from "../format.ts";
import { useI18n } from "../i18n/provider.tsx";
import { ErrorMessage } from "../panel/ErrorMessage.tsx";
import type { ChoiceKind } from "../policies.ts";
import type { SessionState } from "../session.ts";
import { DecisionDetails } from "./DecisionDetails.tsx";
import { DecisionScene } from "./DecisionScene.tsx";
import { Glyph } from "./Glyph.tsx";
import { PACES, type Pace } from "./preference.ts";
import { buildDecisionPresentation, intentLabel } from "./presentation.ts";
import "./decisions.css";

export interface TheaterProps {
  state: SessionState;
  kind: ChoiceKind | undefined;
  compassOn: boolean;
  onCompass(): void;
  onClose(): void;
  onPause(): void;
  minimized?: boolean;
  inspectVersion?: number;
  pace?: Pace | null;
  onPace?(pace: Pace): void;
  fps?: number;
}

const TABS = ["now", "history", "details"] as const;
type Tab = (typeof TABS)[number];

/** One current action, with history and exact input one level away. No game or model ownership. */
export function Theater({
  state,
  kind,
  compassOn,
  onCompass,
  onClose,
  onPause,
  minimized = false,
  inspectVersion = 0,
  pace,
  onPace,
  fps,
}: TheaterProps) {
  const translation = useI18n();
  const { t } = translation;
  const id = useId();
  const [tab, setTab] = useState<Tab>("now");
  const [inputOpen, setInputOpen] = useState(false);
  const [frozen, setFrozen] = useState<{ state: SessionState; index: number | null } | null>(null);
  const previous = useRef({ state, inspectVersion });
  const handledInspect = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const source = frozen?.state ?? state;
  const view = buildDecisionPresentation(source, kind, translation, frozen?.index ?? undefined);
  const answered = view.rounds.filter((round) => round.log);
  const live = () => {
    setFrozen(null);
    setTab("now");
    setInputOpen(false);
  };
  const pin = () => {
    if (view.current) setFrozen((saved) => saved ?? { state, index: view.round?.index ?? null });
  };
  const selectTab = (next: Tab) => {
    if (next !== "now") pin();
    setTab(next);
  };

  useLayoutEffect(() => {
    // Opening the exact input keeps its own focus/scroll target; other navigation starts at the top.
    if (content.current && !(tab === "details" && inputOpen)) content.current.scrollTop = 0;
  }, [tab, frozen?.index, inputOpen]);

  useEffect(() => {
    if (tab !== "now" && !frozen && view.current)
      setFrozen({ state, index: view.round?.index ?? null });
  }, [tab, frozen, state, view.current, view.round?.index]);

  useEffect(() => {
    const old = previous.current;
    previous.current = { state, inspectVersion };
    if (
      old.state.episode !== state.episode ||
      old.state.seed !== state.seed ||
      old.state.policyId !== state.policyId
    ) {
      setFrozen(null);
      setTab("now");
      setInputOpen(false);
      if (old.inspectVersion === inspectVersion) handledInspect.current = inspectVersion;
    }
    if (inspectVersion === handledInspect.current) return;
    const latest = state.turns.at(-1);
    if (latest) {
      handledInspect.current = inspectVersion;
      setFrozen({ state, index: latest.model.index });
      setTab("details");
      setInputOpen(true);
    }
  }, [state, inspectVersion]);

  const model = view.round?.facts.model ?? state.policyId?.split(":")[1] ?? "Clef";
  return (
    <aside class="theater decision-surface" aria-label={t("theater.title")}>
      <header class="decision-header">
        <div>
          <h2>{t("decisions.title")}</h2>
          <p>
            {kind === "model"
              ? model
              : t(kind === "human" ? "player.group.human" : "player.reference")}
          </p>
        </div>
        <button
          type="button"
          class="decision-close"
          onClick={onClose}
          aria-label={t("theater.hide")}
        >
          ×
        </button>
      </header>
      <div class="decision-nav" role="tablist" aria-label={t("theater.title")}>
        {TABS.map((item) => (
          <button
            type="button"
            key={item}
            role="tab"
            id={`${id}-${item}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            data-view={item}
            onClick={() => selectTab(item)}
            onKeyDown={(event) => {
              const at = TABS.indexOf(item);
              const next =
                event.key === "ArrowRight"
                  ? TABS[(at + 1) % TABS.length]
                  : event.key === "ArrowLeft"
                    ? TABS[(at + TABS.length - 1) % TABS.length]
                    : event.key === "Home"
                      ? TABS[0]
                      : event.key === "End"
                        ? TABS[2]
                        : null;
              if (next) {
                event.preventDefault();
                selectTab(next);
                document.getElementById(`${id}-${next}`)?.focus();
              }
            }}
          >
            {t(`decisions.${item}`)}
          </button>
        ))}
      </div>
      <div class="decision-reading-state">
        <span class={`decision-live ${frozen ? "fixed" : ""}`}>
          <i aria-hidden="true" />
          {t(frozen ? "decisions.fixed" : "decisions.live")}
        </span>
        {frozen ? (
          <button type="button" class="decision-link back-to-live" onClick={live}>
            {t("theater.backToLive")} →
          </button>
        ) : (
          <button type="button" class="decision-link" disabled={!view.current} onClick={pin}>
            {t("decisions.pin")}
          </button>
        )}
      </div>
      <div
        class="decision-content"
        ref={content}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
      >
        {state.error && (
          <div class="decision-error">
            <ErrorMessage info={state.errorInfo ?? { code: "unknown", detail: state.error }} />
          </div>
        )}
        {tab === "now" && (
          <div class="decision-now" data-stage={view.stage}>
            <div class="decision-context">
              <span>
                {view.round
                  ? t("theater.round", { index: view.round.index + 1, row: view.round.row })
                  : t("decisions.now")}
              </span>
              <span>{t(`decisions.stage.${view.stage}`)}</span>
            </div>
            <DecisionScene view={view} />
            <div class="decision-action">
              <h3>{view.title}</h3>
              <p>{view.explanation}</p>
            </div>
            {view.intent && (
              <div class="decision-intent">
                <Glyph glyph={ACTION_GLYPH[view.intent]} size={22} />
                <div>
                  <span>{t("decisions.modelChoice")}</span>
                  <strong>{intentLabel(view, translation)}</strong>
                </div>
              </div>
            )}
            {view.controller && <p class="decision-source">{t("decisions.controller")}</p>}
            {view.answers.length > 0 && (
              <>
                <h4 class="decision-answer-caption">{t("decisions.usedAnswers")}</h4>
                <ul class="decision-observations" aria-label={t("decisions.usedAnswers")}>
                  {view.answers.map((answer) => (
                    <li key={answer.id}>
                      <Glyph glyph={answer.glyph} size={14} />
                      {answer.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {tab === "history" && (
          <div class="decision-history">
            {kind === "model" && <p class="hint">{t("decisions.historyHelp")}</p>}
            {answered.length === 0 ? (
              <p>
                {t(
                  kind === "model"
                    ? "theater.waiting"
                    : kind === "human"
                      ? "theater.human"
                      : "theater.noModel",
                )}
              </p>
            ) : (
              [...answered].reverse().map((round) => (
                <button
                  type="button"
                  key={round.index}
                  class="decision-history-item"
                  data-decision={round.index}
                  onClick={() => {
                    setFrozen({ state: source, index: round.index });
                    setTab("now");
                    setInputOpen(false);
                  }}
                >
                  <span class="history-direction">
                    <Glyph glyph={round.move?.glyph ?? "•"} size={22} />
                  </span>
                  <span>
                    <strong>{round.move?.label}</strong>
                    <small>{t("theater.round", { index: round.index + 1, row: round.row })}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))
            )}
          </div>
        )}
        {tab === "details" && (
          <DecisionDetails
            view={view}
            state={source}
            fps={fps}
            inputOpen={inputOpen}
            onInput={setInputOpen}
            compassOn={compassOn}
            onCompass={onCompass}
          />
        )}
      </div>
      <footer class="decision-footer">
        {frozen && <p>{t("decisions.fixedHelp")}</p>}
        {minimized && <p>{t("windows.minimized")}</p>}
        <div>
          <button
            type="button"
            class="btn primary theater-pause"
            onClick={onPause}
            disabled={minimized || !state.alive || state.stalled}
            aria-pressed={state.paused}
          >
            {t(state.paused ? "decisions.resumeGame" : "decisions.pauseGame")}
          </button>
          {pace != null && onPace && (
            <label>
              {t("setup.pace")}
              <select
                class="select"
                value={pace}
                disabled={state.timing !== "step"}
                title={t(state.timing === "step" ? "setup.paceHelp" : "setup.paceStepOnly")}
                onChange={(event) => onPace(event.currentTarget.value as Pace)}
              >
                {PACES.map((option) => (
                  <option key={option} value={option}>
                    {t(`setup.pace.${option}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </footer>
    </aside>
  );
}
