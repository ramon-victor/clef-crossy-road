import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";
import { type LogMode, parseLogMode } from "./console-log.ts";
import { isSeed, parseSeedText } from "./seed.ts";

export interface LaunchOptions {
  /** A policy choice id from policies.ts, e.g. "clef". */
  player?: string;
  seed?: number;
  /** How much to print in the terminal (`CCR_LOG`); absent means the app was not asked to. */
  log?: LogMode;
}

/** Launch options from a query string such as `?player=clef-flash&seed=1&log=full`. */
export function launchFromQuery(search: string): LaunchOptions {
  const params = new URLSearchParams(search);
  const player = params.get("player");
  const seed = parseSeedText(params.get("seed") ?? "");
  const log = parseLogMode(params.get("log"));
  return {
    ...(player ? { player } : {}),
    ...(seed === undefined ? {} : { seed }),
    ...(log === "off" ? {} : { log }),
  };
}

/**
 * Where to start. In the desktop app it comes from `CCR_PLAYER`, `CCR_SEED` and `CCR_LOG` (read by Rust),
 * which is what play.cmd and play-clef.cmd set; in a browser during development from `?player=...&seed=...`.
 */
export async function readLaunchOptions(): Promise<LaunchOptions> {
  try {
    // The cache is local and gitignored. A fresh checkout must work without credentials or API spend.
    if (!isTauri()) return { player: "lookahead", ...launchFromQuery(window.location.search) };
    const raw = await invoke<{ player?: string | null; seed?: number | null; log?: string }>(
      "launch_options",
    );
    const log = parseLogMode(raw.log);
    return {
      ...(raw.player ? { player: raw.player } : {}),
      ...(isSeed(raw.seed) ? { seed: raw.seed } : {}),
      ...(log === "off" ? {} : { log }),
    };
  } catch {
    return {};
  }
}
