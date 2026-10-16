import { useNow } from "./useNow.ts";

export interface ClockProps {
  /** When the question went out, in the session's clock; the clock stands still without it. */
  since: number | null;
  class?: string;
}

/**
 * Seconds since a question went out, counting while it is out. It is a component of its own so that only this
 * text re-renders at the clock's pace, not the compass or the conversation around it.
 */
export function Clock({ since, class: className }: ClockProps) {
  const now = useNow(since !== null, 100);
  const seconds = since === null ? 0 : Math.max(0, now - since) / 1000;
  // Out of the way of screen readers: the caption it sits in is a live region, and a counter would be read out
  // every tenth of a second.
  return (
    <b class={className} aria-hidden="true">
      {seconds.toFixed(1)} s
    </b>
  );
}
