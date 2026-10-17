import { platformClock } from "@ccr/agent";
import { observe } from "@ccr/core";
import type { Session } from "../session.ts";
import { Glyph } from "./Glyph.tsx";
import { useNow } from "./useNow.ts";

export interface EdgeClockProps {
  session: Session;
}

/**
 * A countdown on the chicken while the platform it stands on is taking it to the edge of the world: which way,
 * and how many seconds. It reads the live game (the clock moves with the world, not with the model's answers),
 * and is a component of its own so that only this badge re-renders at the clock's pace. Hidden from screen
 * readers: the caption carries the words.
 */
export function EdgeClock({ session }: EdgeClockProps) {
  useNow(true, 100);
  const game = session.game;
  const clock = game.alive ? platformClock(observe(game)) : null;
  if (!clock || (clock.word !== "a_moment" && clock.word !== "soon")) return null;
  return (
    <div class={`edge-clock ${clock.word === "a_moment" ? "now" : "soon"}`} aria-hidden="true">
      <Glyph glyph="!" size={16} />
      <Glyph glyph={clock.toward === "left" ? "←" : "→"} size={16} />
      <b>{clock.seconds.toFixed(1)} s</b>
    </div>
  );
}
