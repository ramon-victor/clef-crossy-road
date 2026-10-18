import type { SessionState } from "../session.ts";
import type { FrameMode } from "./view.ts";

/** What to draw: the question while it is out, else the last answer, else nothing yet. */
export function pickMode(state: Pick<SessionState, "asking" | "lastModel">): FrameMode {
  if (state.asking) return "reading";
  return state.lastModel ? "answered" : "waiting";
}
