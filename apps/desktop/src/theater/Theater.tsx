import { useI18n } from "../i18n/provider.tsx";
import { ErrorMessage } from "../panel/ErrorMessage.tsx";
import type { ChoiceKind } from "../policies.ts";
import type { SessionState } from "../session.ts";
import { Clock } from "./Clock.tsx";
import { buildFeed, type TurnView } from "./feed.ts";
import { Glyph } from "./Glyph.tsx";

export interface TheaterProps {
  state: SessionState;
  /** What kind of player is selected: only a model has a conversation to follow. */
  kind: ChoiceKind | undefined;
  /** The compass on the chicken is on. */
  compassOn: boolean;
  onCompass(): void;
  onClose(): void;
  onInspect(): void;
}

/** How the model's side is going: how long it has been reading, or how long it took and what it cost. */
function Status({ turn }: { turn: TurnView }) {
  const { t, ms } = useI18n();
  if (turn.reading) {
    return (
      <span>
        {t("theater.reading")} <Clock since={turn.since} />
      </span>
    );
  }
  const { latencyMs, neurons, cached } = turn.facts;
  const took = cached ? t("theater.replayed") : t("theater.answered", { time: ms(latencyMs) });
  return (
    <span>
      {neurons === undefined
        ? took
        : t("theater.cost", {
            status: took,
            neurons,
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
    </span>
  );
}

function Round({ turn }: { turn: TurnView }) {
  const { t, percent, number } = useI18n();
  if (turn.old) {
    return (
      <article class="turn old">
        <div class="sum">
          <b aria-hidden="true">
            <Glyph glyph={turn.move?.glyph ?? ""} size={14} />
          </b>
          {turn.move?.label}{" "}
          <em>
            {turn.summary.map((glyph, i) => (
              <span key={`${turn.index}-${i}`}>
                {i > 0 && " "}
                <Glyph glyph={glyph} size={12} />
              </span>
            ))}
          </em>
        </div>
      </article>
    );
  }
  return (
    <article class="turn">
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
              <div class={`platform-line ${turn.scene.platform.urgency}`}>
                {(turn.scene.platform.urgency === "now" ||
                  turn.scene.platform.urgency === "soon") && <Glyph glyph="!" size={14} />}
                <span>{turn.scene.platform.phrase}</span>
              </div>
            )}
          </>
        ) : (
          <div class="seerow muted">{t("theater.screenWords")}</div>
        )}
      </div>
      <div class={`bub model ${turn.reading ? "reading" : "answered"}`}>
        <div class="who">
          CLEF <Status turn={turn} />
        </div>
        {turn.questions.length === 0 ? (
          <p class="muted">{t("theater.yesNo")}</p>
        ) : (
          <div class="qa">
            {turn.questions.map((question) => (
              <div class={`qa-row ${question.skipped ? "skip" : ""}`} key={question.id}>
                <div class="qa-t">
                  {question.title}
                  {question.skipped && <em title={question.skipped}>{t("theater.notNeeded")}</em>}
                </div>
                <div class="pills">
                  {question.options.map((option) => (
                    <span
                      key={option.id}
                      class={`pill ${option.chosen ? "win" : ""}`}
                      title={option.label}
                    >
                      <Glyph glyph={option.glyph} size={14} /> {option.short}
                      <i class="pill-p">{option.p === null ? "" : percent(option.p)}</i>
                      {option.chosen && <span class="sr-only">{t("theater.itsAnswer")}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {turn.move && (
        <div class="movepill">
          <b aria-hidden="true">
            <Glyph glyph={turn.move.glyph} size={22} />
          </b>
          {turn.move.label}
        </div>
      )}
      {turn.said && (
        <p class="said">
          <span class="said-tag">{t("decision.controller")}</span> {turn.said}
        </p>
      )}
      {turn.steps.length > 0 && (
        <ol class="walk" aria-label={t("theater.nextSteps")}>
          {turn.steps.map((step, i) => (
            <li key={`${turn.index}-${i}`} title={step.note}>
              <Glyph glyph={step.glyph} size={14} />
              {step.count > 1 && <b class="walk-count">×{number(step.count)}</b>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Empty({ kind }: { kind: ChoiceKind | undefined }) {
  const { t } = useI18n();
  return (
    <div class="theater-empty">
      <p class="theater-empty-title">{t(kind === "human" ? "theater.human" : "theater.noModel")}</p>
      <p class="theater-empty-text">{t("theater.pickModel")}</p>
    </div>
  );
}

/** The conversation between the game and the model, one round per question, forever. */
export function Theater({ state, kind, compassOn, onCompass, onClose, onInspect }: TheaterProps) {
  const translation = useI18n();
  const { t } = translation;
  const asksModel = kind === "model";
  const rounds = asksModel ? buildFeed(state, translation) : [];

  return (
    <aside class="theater" aria-label={t("theater.title")}>
      <header class="theater-head">
        <div class="theater-heading">
          <h2 class="theater-title">{t("theater.title")}</h2>
          <div class="theater-sub">{rounds.at(-1)?.facts.model ?? t("theater.subtitle")}</div>
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
      {asksModel && (
        <div class="theater-tools">
          <button type="button" class="theater-tog" aria-pressed={compassOn} onClick={onCompass}>
            {t("theater.compass")}
          </button>
          <button type="button" class="theater-link" onClick={onInspect}>
            {t("theater.fullText")}
          </button>
        </div>
      )}
      {!asksModel ? (
        <Empty kind={kind} />
      ) : (
        <div class="feed" aria-live="off">
          {state.error && (
            <div class="theater-error">
              <ErrorMessage info={state.errorInfo ?? { code: "unknown", detail: state.error }} />
            </div>
          )}
          {rounds.length === 0 ? (
            <div class="bub game">
              <div class="who">{t("theater.game")}</div>
              <div class="seerow muted">{t("theater.waiting")}</div>
            </div>
          ) : (
            rounds.map((turn) => <Round key={turn.index} turn={turn} />)
          )}
        </div>
      )}
    </aside>
  );
}
