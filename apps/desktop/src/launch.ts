import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge/tauri.ts";

export interface LaunchOptions {
  /** A policy choice id from policies.ts, e.g. "clef-flash-json". */
  player?: string;
  seed?: number;
}

const toSeed = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
    ? value
    : undefined;

/**
 * Where to start. In the desktop app it comes from `CCR_PLAYER` and `CCR_SEED` (read by Rust), which is
 * what play-clef.cmd sets; in a browser during development from `?player=...&seed=...`.
 */
export async function readLaunchOptions(): Promise<LaunchOptions> {
  try {
    if (isTauri()) {
      const raw = await invoke<{ player?: string | null; seed?: number | null }>("launch_options");
      const seed = toSeed(raw.seed);
      return {
        ...(raw.player ? { player: raw.player } : {}),
        ...(seed === undefined ? {} : { seed }),
      };
    }
    const params = new URLSearchParams(window.location.search);
    const player = params.get("player") ?? undefined;
    const seed = toSeed(params.has("seed") ? Number(params.get("seed")) : undefined);
    return { ...(player ? { player } : {}), ...(seed === undefined ? {} : { seed }) };
  } catch {
    return {};
  }
}
