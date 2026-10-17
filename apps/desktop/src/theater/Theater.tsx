import { ms, percent } from "../format.ts";
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
  if (turn.reading) {
    return (
      <span>
        reading… <Clock since={turn.since} />
      </span>
    );
  }
  const { latencyMs, neurons, cached } = turn.facts;
  const took = cached ? "replayed" : `answered in ${ms(latencyMs)}`;
  return <span>{neurons === undefined ? took : `${took} · ${neurons.toFixed(1)} neurons`}</span>;
}

function Round({ turn }: { turn: TurnView }) {
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
        <div class="who">GAME</div>
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
          <div class="seerow muted">The screen, in words (press I to read it)</div>
        )}
      </div>
      <div class={`bub model ${turn.reading ? "reading" : "answered"}`}>
        <div class="who">
          CLEF <Status turn={turn} />
        </div>
        {turn.questions.length === 0 ? (
          <p class="muted">
            Yes/no questions, which have no options to show. Press I to read them.
          </p>
        ) : (
          <div class="qa">
            {turn.questions.map((question) => (
              <div class={`qa-row ${question.skipped ? "skip" : ""}`} key={question.id}>
                <div class="qa-t">
                  {question.title}
                  {question.skipped && <em>not needed</em>}
                </div>
                <div class="pills">
                  {question.options.map((option) => (
                    <span
                      key={option.id}
                      class={`pill ${option.chosen ? "win" : ""}`}
                      title={option.rule}
                    >
                      <Glyph glyph={option.glyph} size={14} /> {option.short}
                      <i class="pill-p">{option.p === null ? "" : percent(option.p)}</i>
                      {option.chosen && <span class="sr-only"> (its answer)</span>}
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
          <span class="said-tag">controller</span> {turn.said}
        </p>
      )}
      {turn.steps.length > 0 && (
        <ol class="walk" aria-label="What the controller did next">
          {turn.steps.map((step, i) => (
            <li key={`${turn.index}-${i}`} title={step.note}>
              <Glyph glyph={step.glyph} size={14} />
              {step.count > 1 && <b class="walk-count">×{step.count}</b>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Empty({ kind }: { kind: ChoiceKind | undefined }) {
  return (
    <div class="theater-empty">
      <p class="theater-empty-title">
        {kind === "human" ? "You are at the keyboard." : "This player asks no model."}
      </p>
      <p class="theater-empty-text">
        Pick <b>Clef-flash</b> or <b>Clef (27B)</b> and this column follows the conversation: what
        the game tells it, what it answers, and the move that comes out.
      </p>
    </div>
  );
}

/** The conversation between the game and the model, one round per question, forever. */
export function Theater({ state, kind, compassOn, onCompass, onClose, onInspect }: TheaterProps) {
  const asksModel = kind === "model";
  const rounds = asksModel ? buildFeed(state) : [];

  return (
    <aside class="theater" aria-label="Watch the model think">
      <header class="theater-head">
        <div>
          <h2 class="theater-title">Watch it think</h2>
          <div class="theater-sub">{rounds.at(-1)?.facts.model ?? "the game and the model"}</div>
        </div>
        <button type="button" class="theater-close" onClick={onClose} aria-label="Hide (T)">
          ×
        </button>
      </header>
      {asksModel && (
        <div class="theater-tools">
          <button type="button" class="theater-tog" aria-pressed={compassOn} onClick={onCompass}>
            Compass (C)
          </button>
          <button type="button" class="theater-link" onClick={onInspect}>
            Full text (I)
          </button>
        </div>
      )}
      {!asksModel ? (
        <Empty kind={kind} />
      ) : (
        <div class="feed" aria-live="off">
          {state.error && <p class="theater-error">{state.error}</p>}
          {rounds.length === 0 ? (
            <div class="bub game">
              <div class="who">GAME</div>
              <div class="seerow muted">Waiting for the first question…</div>
            </div>
          ) : (
            rounds.map((turn) => <Round key={turn.index} turn={turn} />)
          )}
        </div>
      )}
    </aside>
  );
}
