import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";
import { isSeed, parseSeedText } from "./seed.ts";

export interface LaunchOptions {
  /** A policy choice id from policies.ts, e.g. "clef-flash-json". */
  player?: string;
  seed?: number;
}

/** Launch options from a query string such as `?player=clef-flash-json&seed=1`. */
export function launchFromQuery(search: string): LaunchOptions {
  const params = new URLSearchParams(search);
  const player = params.get("player");
  const seed = parseSeedText(params.get("seed") ?? "");
  return { ...(player ? { player } : {}), ...(seed === undefined ? {} : { seed }) };
}

/**
 * Where to start. In the desktop app it comes from `CCR_PLAYER` and `CCR_SEED` (read by Rust), which is
 * what play-clef.cmd sets; in a browser during development from `?player=...&seed=...`.
 */
export async function readLaunchOptions(): Promise<LaunchOptions> {
  try {
    if (!isTauri()) return launchFromQuery(window.location.search);
    const raw = await invoke<{ player?: string | null; seed?: number | null }>("launch_options");
    return {
      ...(raw.player ? { player: raw.player } : {}),
      ...(isSeed(raw.seed) ? { seed: raw.seed } : {}),
    };
  } catch {
    return {};
  }
}
