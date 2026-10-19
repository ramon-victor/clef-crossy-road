import { type Action, DECISION_TICKS, type Snapshot } from "@ccr/core";
import type { DecisionOverlay, OverlayPoint } from "@ccr/render";
import type { SessionState } from "../session.ts";

export interface ExecutionView {
  action: Action | null;
  next: Action | null;
  blocked: boolean;
  overlay: DecisionOverlay | null;
}

const EMPTY: ExecutionView = { action: null, next: null, blocked: false, overlay: null };
const close = (a: number, b: number) => Math.abs(a - b) < 0.04;

/** Snapshot movement wins over the latest answer: an answer may only be queued, or may have failed. */
export function movingAction(hero: Snapshot["hero"]): Action | null {
  if (!hero.moving) return null;
  const dz = hero.targetZ - hero.fromZ;
  if (dz !== 0) return dz > 0 ? "hop_forward" : "hop_back";
  return hero.targetX > hero.fromX ? "hop_left" : "hop_right";
}

/** Live presentation; independent of retained conversation snapshots and model probabilities. */
export function buildExecution(state: SessionState, snap: Snapshot): ExecutionView {
  if (!state.alive || !snap.alive || state.stalled || state.human || state.phase === "error")
    return EMPTY;
  const log = state.last;
  const held = state.phase === "reading" && log !== null;
  const outcome = state.playback?.index === log?.index ? state.playback?.outcome : null;
  const moving = movingAction(snap.hero);
  const waiting =
    !moving &&
    !held &&
    log?.action === "stay" &&
    outcome === "stay" &&
    snap.tick - log.tick < DECISION_TICKS;
  const action = moving ?? (waiting ? "stay" : null);
  const next = held ? log.action : snap.hero.queued;
  const blocked = !moving && !held && outcome === "blocked" && !state.asking;
  if (!action && !next) return { ...EMPTY, blocked };

  const start = { x: snap.hero.x, z: snap.hero.z };
  let points: OverlayPoint[] = [start];
  if (moving) points.push({ x: snap.hero.targetX, z: snap.hero.targetZ });
  else if (waiting) points.push({ ...start, wait: true });

  const preview = log?.decision.preview;
  const origin = log?.observed;
  // Never translate a delayed forecast onto the chicken's new location. Queued actions have no
  // validated continuation either. The next controller decision supplies a fresh forecast.
  const fresh =
    preview &&
    origin &&
    origin.tick === log.tick &&
    !state.asking &&
    !snap.hero.queued &&
    outcome !== "queued" &&
    !blocked &&
    (held
      ? close(snap.hero.x, -preview.col) && close(snap.hero.z, origin.row)
      : moving
        ? close(snap.hero.fromX, -preview.col) &&
          close(snap.hero.fromZ, origin.row) &&
          preview.steps[0]?.action === moving
        : waiting && close(snap.hero.z, origin.row));
  if (fresh) {
    const planned = preview.steps.map((step) => ({
      x: -step.col,
      z: origin.row + step.dz,
      wait: step.action === "stay",
    }));
    if (held) points = [start, ...planned];
    else points.push(...planned.slice(1));
  }
  return {
    action,
    next,
    blocked,
    overlay:
      points.length > 1
        ? {
            points,
            active: action !== null,
            waiting,
            conditional: fresh ? preview.conditional === true : false,
            pulse: !state.paused,
          }
        : null,
  };
}
