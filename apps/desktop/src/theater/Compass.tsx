import { ACTIONS, type Action } from "@ccr/core";
import type { Ref } from "preact";
import { actionLabel } from "../i18n/presentation.ts";
import { useI18n } from "../i18n/provider.tsx";
import type { Session, SessionState } from "../session.ts";
import { Clock } from "./Clock.tsx";
import { buildCompass, moveOf } from "./compass.ts";
import { controllerStep } from "./controller.ts";
import { EdgeClock } from "./EdgeClock.tsx";
import type { ExecutionView } from "./execution.ts";
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

/** Centre of each move's percentage, in CSS pixels from the chicken: the arrow's outer face, clear of the edge clock and the caption. */
const LABEL_AT: Readonly<Record<Action, { x: number; y: number }>> = {
  hop_forward: { x: 0, y: -132 },
  hop_back: { x: 0, y: 132 },
  hop_left: { x: -142, y: 0 },
  hop_right: { x: 142, y: 0 },
  stay: { x: 112, y: 71 },
};

/** A move that rounds to 0% has no chip; the decisions window lists them all. */
const labelled = (p: number | null): p is number => p !== null && Math.round(p * 100) >= 1;

export interface CompassProps {
  session: Session;
  state: SessionState;
  execution: ExecutionView;
  /** The element the game's frame loop moves onto the chicken, every frame. */
  anchorRef: Ref<HTMLDivElement>;
  /** The conversation column is already open, so it needs no button here. */
  conversationOpen: boolean;
  onConversation(): void;
}

/**
 * One execution highlight, independent of the model's chosen manoeuvre and probabilities.
 * The frame loop supplies live execution transitions; model context still comes from the pure presenter.
 */
export function Compass({
  session,
  state,
  execution,
  anchorRef,
  conversationOpen,
  onConversation,
}: CompassProps) {
  const translation = useI18n();
  const { t, number, percent } = translation;
  const view = buildCompass(state, translation);
  const visible =
    state.alive &&
    !state.stalled &&
    state.phase !== "error" &&
    (view.mode !== "hidden" ||
      execution.action !== null ||
      execution.next !== null ||
      execution.blocked);
  const moves = view.moves.length ? view.moves : ACTIONS.map((action) => moveOf(action));
  const step = state.last ? controllerStep(state.last.decision) : null;
  const waitingForGap = execution.action === "stay" && step?.kind === "wait";
  const current =
    waitingForGap && view.doing
      ? view.doing
      : execution.action
        ? actionLabel(execution.action, translation)
        : null;
  const doingMatches = state.last?.action === (execution.action ?? execution.next);
  return (
    <>
      <div ref={anchorRef} class="compass-anchor" aria-hidden="true">
        <EdgeClock session={session} />
        {visible && (
          <div
            class={`compass ${view.mode} ${state.paused ? "paused" : ""}`}
            data-active-action={execution.action ?? ""}
          >
            {moves.map((move) => {
              const at = AT[move.action];
              const active = move.action === execution.action;
              const next = move.action === execution.next && !active;
              return (
                <div
                  key={move.action}
                  class={`cb ${active ? "actual" : ""} ${active && move.action === "stay" ? "waiting" : ""} ${next ? "next" : ""} ${move.blocked && !active && !next ? "blocked" : ""}`}
                  data-move={move.action}
                  style={`--dx:${Math.round(at.x * RADIUS)}px;--dy:${Math.round(at.y * RADIUS)}px`}
                >
                  {move.blocked && !active && !next ? (
                    <PixelIcon icon="block" size={33} />
                  ) : move.action === "stay" ? (
                    <PixelIcon icon="wait" size={22} />
                  ) : (
                    <Glyph glyph={move.glyph} size={33} />
                  )}
                </div>
              );
            })}
            {moves.map((move) => {
              if (!labelled(move.p)) return null;
              const at = LABEL_AT[move.action];
              return (
                <div
                  key={move.action}
                  class={`cp ${move.chosen ? "chosen" : ""}`}
                  data-label={move.action}
                  style={`--lx:${at.x}px;--ly:${at.y}px;--p:${move.p.toFixed(3)}`}
                >
                  {percent(move.p)}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {visible && (
        <div class="compass-caption">
          <div class="cap-main" role="status">
            {current
              ? t("compass.now", { step: current })
              : execution.next
                ? t("theater.next", { step: actionLabel(execution.next, translation) })
                : execution.blocked
                  ? t("compass.blocked")
                  : view.mode === "reading"
                    ? t("theater.readingScene")
                    : t("compass.idle")}
            {view.mode === "reading" && <Clock since={view.since} class="cap-clock" />}
          </div>
          {execution.action && execution.next && (
            <div class="cap-note">
              {t("theater.next", { step: actionLabel(execution.next, translation) })}
            </div>
          )}
          {view.verdict && (
            <div class="cap-choice">{t("compass.chosen", { move: view.verdict })}</div>
          )}
          {view.mode === "reading" && current && (
            <div class="cap-note">{t("theater.readingScene")}</div>
          )}
          {view.doing && doingMatches && !waitingForGap && (
            <div class="cap-note">
              <span class="cap-note-tag">{t("decision.controller")}</span> {view.doing}
            </div>
          )}
          {waitingForGap && (
            <div class="cap-note">
              <span class="cap-note-tag">{t("decision.controller")}</span>
            </div>
          )}
          {execution.overlay && <div class="cap-route">{t("compass.path")}</div>}
          {view.strip.length > 0 && (
            <div class="cap-strip" aria-hidden="true">
              {view.strip.map((chip) => (
                <span key={chip.index} class={`hchip ${chip.big ? "big" : ""}`}>
                  <Glyph glyph={chip.glyph} size={16} />
                  {chip.count > 1 && <b class="hchip-count">×{number(chip.count)}</b>}
                </span>
              ))}
            </div>
          )}
          {!conversationOpen && (
            <button type="button" class="cap-details" onClick={onConversation}>
              {t("theater.details")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
