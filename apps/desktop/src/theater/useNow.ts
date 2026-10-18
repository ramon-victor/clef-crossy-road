import { useEffect, useState } from "preact/hooks";

/** A clock that ticks while `active` (a question is out), so a counter on screen can move. */
export function useNow(active: boolean, everyMs = 50): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return active ? now : performance.now();
}
