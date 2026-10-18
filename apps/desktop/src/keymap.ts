import type { Action } from "@ccr/core";

export type KeyCommand =
  | { type: "move"; action: Action }
  | { type: "pause" }
  | { type: "step" }
  | { type: "retry" }
  | { type: "newMap" }
  | { type: "controls" }
  | { type: "inspect" }
  | { type: "theater" }
  | { type: "compass" };

/** Keys are matched in lower case, so Shift and Caps Lock do not matter. */
const MOVES: Readonly<Record<string, Action>> = {
  arrowup: "hop_forward",
  w: "hop_forward",
  arrowdown: "hop_back",
  s: "hop_back",
  arrowleft: "hop_left",
  a: "hop_left",
  arrowright: "hop_right",
  d: "hop_right",
};

const COMMANDS: Readonly<Record<string, KeyCommand>> = {
  " ": { type: "pause" },
  n: { type: "step" },
  r: { type: "retry" },
  m: { type: "newMap" },
  i: { type: "inspect" },
  f2: { type: "controls" },
  t: { type: "theater" },
  c: { type: "compass" },
};

/**
 * What a key press asks of the game, or undefined for keys the game ignores. Browser and OS shortcuts
 * (Ctrl+R reloads, Ctrl+W closes, Alt+...) are never game input.
 */
export function commandForKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey"> &
    Partial<Pick<KeyboardEvent, "defaultPrevented" | "isComposing">>,
): KeyCommand | undefined {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return undefined;
  const key = event.key.toLowerCase();
  const action = MOVES[key];
  return action ? { type: "move", action } : COMMANDS[key];
}
