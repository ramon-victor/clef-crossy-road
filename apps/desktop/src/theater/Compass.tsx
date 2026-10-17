import type { Action } from "@ccr/core";
import type { Ref } from "preact";
import { percent } from "../format.ts";
import type { Session, SessionState } from "../session.ts";
import { Clock } from "./Clock.tsx";
import { branchText, buildCompass, type CompassView } from "./compass.ts";
import { EdgeClock } from "./EdgeClock.tsx";
import { Glyph, PixelIcon } from "./Glyph.tsx";

/** How far from the chicken each move's button sits, in CSS pixels. */
const RADIUS = 84;

/** Where each move's button sits around the chicken, in units of the radius: a plain cross, and the pause in the corner. */
const AT: Readonly<Record<Action, { x: number; y: number }>> = {
  hop_forward: { x: 0, y: -1 },
  hop_back: { x: 0, y: 1 },
  hop_left: { x: -1, y: 0 },
  hop_right: { x: 1, y: 0 },
  stay: { x: 0.74, y: 0.84 },
};

export interface CompassProps {
  session: Session;
  state: SessionState;
  /** The element the game's frame loop moves onto the chicken, every frame. */
  anchorRef: Ref<HTMLDivElement>;
  /** The conversation column is already open, so it needs no button here. */
  conversationOpen: boolean;
  onConversation(): void;
}

function Caption({ view, since }: { view: CompassView; since: number | null }) {
  if (view.mode === "reading") {
    return (
      <>
        <span class="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>reading what it sees…</span>
        <Clock since={since} class="cap-clock" />
      </>
    );
  }
  const manyAnswers = view.answers.length > 1;
  return (
    <>
      {manyAnswers &&
        view.answers.map((answer, i) => (
          <span class="cap-answer" key={`${answer.short}-${i}`}>
            {i > 0 && <span class="sep"> · </span>}
            <span class={answer.skipped ? "skip" : ""}>
              <Glyph glyph={answer.glyph} size={14} /> {answer.short}
            </span>
          </span>
        ))}
      {manyAnswers && <span class="sep">⇒</span>}
      <span class="cap-verdict">{view.verdict}</span>
      {view.branch && <span class="cap-branch">{branchText(view.branch)}</span>}
    </>
  );
}

/**
 * The model's decision drawn around the chicken, in the game: the five moves, each as big as the model wants it,
 * the one it chose lit. What happens next is told by that one move: it **leaves** when the chicken goes, it
 * **pulses with a pause** while the crossing waits for a gap (the wait is part of "go straight", not another
 * move), and when the controller walks a detour, gets off a platform or steps aside, the move it makes is **ringed**
 * (already while the answer is held for reading, as what comes next) and the caption says what it is doing. A way
 * ahead that is closed shows a **block** where "go straight" would be, and the sizes are those of the fork the
 * routing took, so the lit move is always the biggest. A countdown sits on the chicken while its platform takes it
 * to the edge of the world. A caption and the latest moves sit under the game.
 * Everything is `aria-hidden` except the caption, and nothing takes a pointer but the button.
 */
export function Compass({
  session,
  state,
  anchorRef,
  conversationOpen,
  onConversation,
}: CompassProps) {
  const view = buildCompass(state);
  const visible = view.mode !== "hidden";
  return (
    <>
      <div ref={anchorRef} class="compass-anchor" aria-hidden="true">
        <EdgeClock session={session} />
        {visible && (
          <div
            class={`compass ${view.mode} ${view.go ? "go" : ""} ${view.launch ? "launch" : ""}`}
            key={view.index}
          >
            {view.moves.map((move) => {
              const at = AT[move.action];
              const waits = move.winner && view.waiting;
              return (
                <div
                  key={move.action}
                  class={`cb ${move.winner ? "win" : ""} ${waits ? "waiting" : ""} ${move.action === view.actual ? "actual" : ""} ${move.blocked ? "blocked" : ""}`}
                  data-move={move.action}
                  style={`--dx:${Math.round(at.x * RADIUS)}px;--dy:${Math.round(at.y * RADIUS)}px;--p:${move.p ?? 0}`}
                >
                  {move.blocked ? (
                    <PixelIcon icon="block" size={33} />
                  ) : (
                    <Glyph glyph={move.glyph} size={move.action === "stay" ? 22 : 33} />
                  )}
                  {waits && (
                    <span class="cb-badge">
                      <PixelIcon icon="wait" size={14} />
                    </span>
                  )}
                  {move.p !== null && move.p > 0 && !move.blocked && (
                    <small>{percent(move.p)}</small>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {visible && (
        <div class="compass-caption">
          <div class="cap-main" role="status">
            <Caption view={view} since={view.since} />
          </div>
          {view.doing && (
            <div class="cap-note">
              <span class="cap-note-tag">controller</span> {view.doing}
            </div>
          )}
          {view.strip.length > 0 && (
            <div class="cap-strip" aria-hidden="true">
              {view.strip.map((chip) => (
                <span key={chip.index} class={`hchip ${chip.big ? "big" : ""}`}>
                  <Glyph glyph={chip.glyph} size={16} />
                  {chip.count > 1 && <b class="hchip-count">×{chip.count}</b>}
                </span>
              ))}
            </div>
          )}
          {!conversationOpen && (
            <button type="button" class="cap-details" onClick={onConversation}>
              Details (T)
            </button>
          )}
        </div>
      )}
    </>
  );
}
