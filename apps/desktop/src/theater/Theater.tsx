import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useI18n } from "../i18n/provider.tsx";
import { policyFacts } from "../inspect.ts";
import { ErrorMessage } from "../panel/ErrorMessage.tsx";
import { InputInspector } from "../panel/InputInspector.tsx";
import type { ChoiceKind } from "../policies.ts";
import type { SessionState } from "../session.ts";
import { Clock } from "./Clock.tsx";
import { buildFeed, type TurnView } from "./feed.ts";
import { Glyph } from "./Glyph.tsx";

export interface TheaterProps {
  state: SessionState;
  kind: ChoiceKind | undefined;
  compassOn: boolean;
  onCompass(): void;
  onClose(): void;
  onPause(): void;
  minimized?: boolean;
  /** A new explicit request to inspect the latest answered round. */
  inspectVersion?: number;
}

function Round({
  turn,
  policyId,
  inspect,
  onInspect,
  onExpand,
  onCloseDetails,
  snapshot,
}: {
  turn: TurnView;
  policyId: string | null;
  inspect: boolean;
  onInspect(): void;
  onExpand(): void;
  onCloseDetails(): void;
  snapshot: boolean;
}) {
  const { t, percent, number } = useI18n();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = inspect || (expanded ?? !turn.old);
  return (
    <article class={`turn ${turn.old ? "old" : "current"}`} data-decision={turn.index}>
      <button
        type="button"
        class="turn-heading"
        aria-expanded={open}
        onClick={() => {
          if (!open) onExpand();
          setExpanded(!open);
          if (inspect) onCloseDetails();
        }}
      >
        <span>{t("theater.round", { index: turn.index + 1, row: turn.row })}</span>
        <strong>{turn.move?.label ?? t("theater.reading")}</strong>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div class="turn-messages">
          <div class="bub game">
            <div class="who">{t("theater.game")}</div>
            {turn.scene ? (
              <>
                <div class="seerow">
                  <span class={`scene-tile ${turn.scene.tile}`} aria-hidden="true" />
                  <span>{turn.scene.phrase}</span>
                </div>
                <div class="gaps">
                  {turn.scene.gaps.map((gap) => (
                    <span key={gap}>{gap}</span>
                  ))}
                </div>
                {turn.scene.platform && (
                  <p class={`platform-line ${turn.scene.platform.urgency}`}>
                    {turn.scene.platform.phrase}
                  </p>
                )}
              </>
            ) : (
              <p>{t("theater.screenWords")}</p>
            )}
          </div>
          <div class={`bub model ${turn.reading ? "reading" : "answered"}`}>
            <div class="who">
              <b>{turn.facts.model}</b>
              <span>
                {turn.reading ? (
                  <>
                    {t("theater.reading")} {!snapshot && <Clock since={turn.since} />}
                  </>
                ) : (
                  t(turn.facts.cached ? "inspect.cached" : "theater.responseReceived")
                )}
              </span>
            </div>
            {turn.questions.length === 0 ? (
              <p>{t("theater.yesNo")}</p>
            ) : (
              <div class="qa">
                {turn.questions.map((question) => {
                  const chosen = question.options.find((option) => option.chosen);
                  return (
                    <div class={`qa-row ${question.skipped ? "skip" : ""}`} key={question.id}>
                      <div class="qa-t">{question.title}</div>
                      <p class="answer-sentence">
                        {chosen ? (
                          <>
                            <Glyph glyph={chosen.glyph} size={14} /> <strong>{chosen.label}</strong>
                          </>
                        ) : (
                          t("theater.reading")
                        )}
                      </p>
                      {question.skipped && (
                        <p class="unused-answer">
                          {t("theater.unused")} {question.skipped}
                        </p>
                      )}
                      <details class="answer-options">
                        <summary>{t("theater.alternatives")}</summary>
                        <p class="hint">{t("theater.probabilityHelp")}</p>
                        <ul>
                          {question.options.map((option) => (
                            <li key={option.id} class={option.chosen ? "option-chosen" : ""}>
                              <span>
                                {option.label}
                                {option.chosen ? t("theater.itsAnswer") : ""}
                              </span>
                              <span>{percent(option.p ?? undefined)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
            {turn.move && (
              <p class="model-move">
                <Glyph glyph={turn.move.glyph} size={20} />{" "}
                <strong>{t("theater.chose", { move: turn.move.label })}</strong>
              </p>
            )}
          </div>
          {turn.firstStep && (
            <div class="bub controller">
              <div class="who">{t(turn.controller ? "decision.controller" : "theater.game")}</div>
              <p class="execution-status">
                {t(turn.pending ? "theater.pendingMove" : "theater.sentMove")}
              </p>
              <p>{turn.firstStep}</p>
              {turn.steps.length > 0 && (
                <ol class="controller-steps" aria-label={t("theater.nextSteps")}>
                  {turn.steps.map((step, i) => (
                    <li key={`${turn.index}-${i}`}>
                      <Glyph glyph={step.glyph} size={14} />
                      <span>
                        {step.note}
                        {step.count > 1 && <> · ×{number(step.count)}</>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {turn.controller && <p class="no-call">{t("theater.executionNoCall")}</p>}
            </div>
          )}
          {turn.log && (
            <button
              type="button"
              class="turn-technical"
              aria-expanded={inspect}
              onClick={inspect ? onCloseDetails : onInspect}
            >
              {t("theater.technical")}
            </button>
          )}
          {inspect && (
            <InputInspector history={turn.history} policyId={policyId} onClose={onCloseDetails} />
          )}
        </div>
      )}
    </article>
  );
}

/** Conversation and exact request share one surface, without changing game timing. */
export function Theater({
  state,
  kind,
  compassOn,
  onCompass,
  onClose,
  onPause,
  minimized = false,
  inspectVersion = 0,
}: TheaterProps) {
  const translation = useI18n();
  const { t } = translation;
  const [frozen, setFrozen] = useState<SessionState | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const handledInspect = useRef(0);
  const previous = useRef({ state, inspectVersion });
  const source = frozen ?? state;
  const asksModel = kind === "model";
  const rounds = asksModel ? buildFeed(source, translation) : [];
  const freeze = () => setFrozen((saved) => saved ?? state);
  const inspect = (index: number) => {
    setFrozen(state);
    setInspected(index);
  };
  const live = () => {
    setFrozen(null);
    setInspected(null);
  };

  useEffect(() => {
    const old = previous.current;
    previous.current = { state, inspectVersion };
    if (
      old.state.episode !== state.episode ||
      old.state.seed !== state.seed ||
      old.state.policyId !== state.policyId ||
      old.state.decisions > state.decisions ||
      old.state.tick > state.tick
    ) {
      setFrozen(null);
      setInspected(null);
      // Cancel a pending request from the previous game, while allowing a new one.
      if (old.inspectVersion === inspectVersion) handledInspect.current = inspectVersion;
    }
    if (inspectVersion === handledInspect.current) return;
    const latest = state.turns.at(-1);
    if (latest) {
      handledInspect.current = inspectVersion;
      setFrozen(state);
      setInspected(latest.model.index);
    }
  }, [inspectVersion, state]);

  useLayoutEffect(() => {
    const node = feed.current;
    if (!frozen && node) node.scrollTop = node.scrollHeight;
  }, [frozen, rounds]);

  return (
    <aside class="theater" aria-label={t("theater.title")}>
      <header class="theater-head">
        <div class="theater-heading">
          <h2 class="theater-title">{t("theater.title")}</h2>
          <p class="theater-sub">{rounds.at(-1)?.facts.model ?? t("theater.subtitle")}</p>
        </div>
        <button
          type="button"
          class="theater-close"
          onClick={onClose}
          aria-label={t("theater.hide")}
        >
          ×
        </button>
      </header>
      <div class="theater-tools">
        <button type="button" class="theater-tog" aria-pressed={compassOn} onClick={onCompass}>
          {t("theater.compass")}
        </button>
        <button
          type="button"
          class="theater-pause"
          onClick={onPause}
          disabled={minimized || !state.alive || state.stalled}
          aria-pressed={state.paused}
        >
          {t(state.paused ? "controls.resume" : "controls.pause")}
        </button>
        {asksModel && (
          <button
            type="button"
            class="theater-link"
            onClick={() => {
              const latest = state.turns.at(-1);
              if (latest) inspect(latest.model.index);
            }}
          >
            {t("theater.fullText")}
          </button>
        )}
      </div>
      {asksModel && policyFacts(state.policyId)?.executor && (
        <p class="theater-explanation">{t("inspect.executor")}</p>
      )}
      {minimized && (
        <p class="theater-explanation" role="status">
          {t("windows.minimized")}
        </p>
      )}
      {state.error && (
        <div class="theater-error">
          <ErrorMessage info={state.errorInfo ?? { code: "unknown", detail: state.error }} />
        </div>
      )}
      {!asksModel ? (
        <div class="theater-empty">
          <p class="theater-empty-title">
            {t(kind === "human" ? "theater.human" : "theater.noModel")}
          </p>
          <p>{t("theater.pickModel")}</p>
        </div>
      ) : (
        <>
          {frozen && <p class="theater-explanation">{t("theater.snapshot")}</p>}
          {frozen && (
            <button type="button" class="back-to-live" onClick={live}>
              {t("theater.backToLive")}
            </button>
          )}
          <div
            class="feed"
            ref={feed}
            aria-live="off"
            onScroll={() => {
              const node = feed.current;
              if (!node || frozen) return;
              if (node.scrollHeight - node.scrollTop - node.clientHeight > 24) freeze();
            }}
          >
            {rounds.length === 0 ? (
              <p class="theater-waiting" role="status">
                {t("theater.waiting")}
              </p>
            ) : (
              rounds.map((turn) => (
                <Round
                  snapshot={frozen !== null}
                  key={turn.index}
                  turn={turn}
                  policyId={source.policyId}
                  inspect={inspected === turn.index}
                  onExpand={freeze}
                  onInspect={() => {
                    freeze();
                    setInspected(turn.index);
                  }}
                  onCloseDetails={() => setInspected(null)}
                />
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
