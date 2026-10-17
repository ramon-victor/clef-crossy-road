import { platformClock } from "@ccr/agent";
import { observe } from "@ccr/core";
import type { Session } from "../session.ts";
import { Glyph } from "./Glyph.tsx";
import { useNow } from "./useNow.ts";

export interface EdgeClockProps {
  session: Session;
}

/** A countdown on the chicken while its platform takes it to the edge of the world, read from the live game. */
export function EdgeClock({ session }: EdgeClockProps) {
  const game = session.game;
  useNow(game.heroRiding, 100);
  const clock = game.alive && game.heroRiding ? platformClock(observe(game)) : null;
  if (!clock || (clock.word !== "a_moment" && clock.word !== "soon")) return null;
  return (
    <div class={`edge-clock ${clock.word === "a_moment" ? "now" : "soon"}`} aria-hidden="true">
      <Glyph glyph="!" size={16} />
      <Glyph glyph={clock.toward === "left" ? "←" : "→"} size={16} />
      <b>{clock.seconds.toFixed(1)} s</b>
    </div>
  );
}
