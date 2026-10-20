import type { ChickenArtwork } from "@ccr/render";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ACTION_GLYPH } from "../format.ts";
import { useI18n } from "../i18n/provider.tsx";
import { ErrorMessage } from "../panel/ErrorMessage.tsx";
import type { ChoiceKind } from "../policies.ts";
import type { SessionState } from "../session.ts";
import { DecisionDetails } from "./DecisionDetails.tsx";
import { DecisionScene } from "./DecisionScene.tsx";
import { ExecutionList } from "./ExecutionList.tsx";
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
  /** Undefined while loading; null if the game could not prepare the artwork. */
  artwork?: ChickenArtwork | null | undefined;
}

const TABS = ["now", "history"] as const;
type Tab = (typeof TABS)[number];

/** Live presentation and a bounded, explicitly refreshed history. Never owns game or model state. */
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
  artwork,
}: TheaterProps) {
  const translation = useI18n();
  const { t } = translation;
  const id = useId();
  const [tab, setTab] = useState<Tab>("now");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const [frozen, setFrozen] = useState<{ state: SessionState; index: number | null } | null>(null);
  const previous = useRef({ state, inspectVersion });
  const handledInspect = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const source = frozen?.state ?? state;
  const view = buildDecisionPresentation(
    source,
    kind,
    translation,
    (tab === "history" ? expanded : frozen?.index) ?? undefined,
  );
  const answered = view.rounds.filter((round) => round.log);
  const latestIndex = state.turns.at(-1)?.model.index ?? -1;
  const savedIndex = source.turns.at(-1)?.model.index ?? -1;
  const hasNew = frozen !== null && latestIndex > savedIndex;
  const live = () => {
    setFrozen(null);
    setTab("now");
    setExpanded(null);
    setTechnicalOpen(false);
    setInputOpen(false);
    setExpired(false);
    if (content.current) content.current.scrollTop = 0;
  };
  const pin = () => {
    if (view.round?.log || view.current)
      setFrozen((saved) => saved ?? { state, index: view.round?.index ?? null });
  };
  const selectTab = (next: Tab) => {
    if (next === "now") {
      live();
      return;
    }
    if (state.turns.length) setFrozen((saved) => saved ?? { state, index: null });
    setTab(next);
    setTechnicalOpen(false);
    setInputOpen(false);
  };
  const refresh = () => {
    const retained = expanded !== null && state.turns.some((turn) => turn.model.index === expanded);
    setFrozen({ state, index: retained ? expanded : null });
    setExpired(expanded !== null && !retained);
    if (!retained) {
      setExpanded(null);
      setTechnicalOpen(false);
      setInputOpen(false);
    }
  };

  useLayoutEffect(() => {
    // The inspector focuses and scrolls its own target when I also changes the active tab.
    if (content.current && !inputOpen) content.current.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    if (
      !frozen &&
      ((tab === "history" && state.turns.length) ||
        (technicalOpen && (view.round?.log || view.current)))
    )
      setFrozen({ state, index: tab === "now" ? (view.round?.index ?? null) : null });
  }, [tab, frozen, state, technicalOpen, view.round, view.current]);

  useEffect(() => {
    const old = previous.current;
    previous.current = { state, inspectVersion };
    if (
      old.state.episode !== state.episode ||
      old.state.seed !== state.seed ||
      old.state.policyId !== state.policyId
    ) {
      live();
      if (old.inspectVersion === inspectVersion) handledInspect.current = inspectVersion;
    }
    if (inspectVersion === handledInspect.current) return;
    const latest = state.turns.at(-1);
    if (latest) {
      handledInspect.current = inspectVersion;
      setFrozen({ state, index: latest.model.index });
      setExpanded(latest.model.index);
      setTab("history");
      setTechnicalOpen(true);
      setInputOpen(true);
    }
  }, [state, inspectVersion]);

  const technical = () => (
    <section class="technical-disclosure">
      <h3>
        <button
          type="button"
          class="disclosure-button"
          data-action="technical-details"
          aria-expanded={technicalOpen}
          aria-controls={`${id}-technical`}
          onClick={() => {
            if (!technicalOpen) pin();
            setTechnicalOpen(!technicalOpen);
            setInputOpen(false);
          }}
        >
          {t("decisions.details")}
          <span aria-hidden="true">{technicalOpen ? "−" : "+"}</span>
        </button>
      </h3>
      <div id={`${id}-technical`} hidden={!technicalOpen}>
        {technicalOpen && (
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
    </section>
  );
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
                        ? TABS[TABS.length - 1]
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
          <button
            type="button"
            class="decision-link"
            disabled={!view.current && !view.round?.log}
            onClick={pin}
          >
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
          <>
            <div class="decision-now" data-stage={view.stage}>
              <div class="decision-context">
                <span>
                  {view.round
                    ? t("theater.round", { index: view.round.index + 1, row: view.round.row })
                    : t("decisions.now")}
                </span>
                <span class="surface-status">{t(`decisions.stage.${view.stage}`)}</span>
              </div>
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
              <DecisionScene view={view} artwork={artwork} />
              {view.answers.length > 0 && (
                <section class="decision-used">
                  <h4>{t("decisions.usedAnswers")}</h4>
                  <ul class="decision-observations" aria-label={t("decisions.usedAnswers")}>
                    {view.answers.map((answer) => (
                      <li key={answer.id}>
                        <Glyph glyph={answer.glyph} size={14} />
                        {answer.label}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            {technical()}
          </>
        )}
        {tab === "history" && (
          <div class="decision-history">
            <div class="history-heading">
              <h3>{t("decisions.historyCount", { value: answered.length })}</h3>
              {frozen && (
                <button
                  type="button"
                  class="decision-link history-refresh"
                  disabled={!hasNew}
                  onClick={refresh}
                >
                  {t("decisions.refresh")}
                </button>
              )}
            </div>
            <p class="history-status" role="status">
              {expired
                ? t("decisions.expired")
                : hasNew
                  ? t("decisions.newHistory")
                  : t("decisions.historyHelp")}
            </p>
            {answered.length === 0 ? (
              <p class="decision-empty">
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
                <article
                  class={`history-entry ${expanded === round.index ? "expanded" : ""}`}
                  key={round.index}
                >
                  <h3>
                    <button
                      type="button"
                      class="decision-history-item"
                      data-decision={round.index}
                      id={`${id}-round-${round.index}`}
                      aria-expanded={expanded === round.index}
                      aria-controls={`${id}-record-${round.index}`}
                      onClick={() => {
                        setExpanded(expanded === round.index ? null : round.index);
                        setTechnicalOpen(false);
                        setInputOpen(false);
                      }}
                    >
                      <span class="history-direction">
                        <Glyph glyph={round.move?.glyph ?? "•"} size={22} />
                      </span>
                      <span class="history-item-copy">
                        <small>
                          {t("theater.round", { index: round.index + 1, row: round.row })}
                        </small>
                        <strong>{round.move?.label}</strong>
                        <small>
                          {round.pending
                            ? t("decisions.ready")
                            : t("decisions.stepCount", {
                                value: round.history.filter(
                                  (log) => log.decision.source === "executor",
                                ).length,
                              })}
                          {round.facts.cached && (
                            <span class="cache-badge">{t("decisions.cached")}</span>
                          )}
                        </small>
                      </span>
                      <span class="disclosure-mark" aria-hidden="true">
                        {expanded === round.index ? "−" : "+"}
                      </span>
                    </button>
                  </h3>
                  <section
                    class="history-expanded"
                    id={`${id}-record-${round.index}`}
                    aria-labelledby={`${id}-round-${round.index}`}
                    hidden={expanded !== round.index}
                  >
                    {expanded === round.index && (
                      <>
                        <ExecutionList round={round} />
                        {technical()}
                      </>
                    )}
                  </section>
                </article>
              ))
            )}
          </div>
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
