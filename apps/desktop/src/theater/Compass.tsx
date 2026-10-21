import { ACTIONS, type Action } from "@ccr/core";
import type { Ref } from "preact";
import { ACTION_GLYPH } from "../format.ts";
import { useI18n } from "../i18n/provider.tsx";
import type { Session, SessionState } from "../session.ts";
import { buildCompass } from "./compass.ts";
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

export interface CompassProps {
  session: Session;
  state: SessionState;
  execution: ExecutionView;
  /** The element the game's frame loop moves onto the chicken, every frame. */
  anchorRef: Ref<HTMLDivElement>;
}

/**
 * One execution highlight, independent of the model's chosen manoeuvre and probabilities.
 * The frame loop supplies live execution transitions; model context still comes from the pure presenter.
 */
export function Compass({ session, state, execution, anchorRef }: CompassProps) {
  const translation = useI18n();
  const view = buildCompass(state, translation);
  const visible =
    state.alive &&
    !state.stalled &&
    state.phase !== "error" &&
    (view.mode !== "hidden" ||
      execution.action !== null ||
      execution.next !== null ||
      execution.blocked);
  const moves = view.moves.length
    ? view.moves
    : ACTIONS.map((action) => ({
        action,
        glyph: ACTION_GLYPH[action],
        blocked: false,
      }));
  return (
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
        </div>
      )}
    </div>
  );
}
