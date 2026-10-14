import { invoke } from "@tauri-apps/api/core";
import type { Bridge, BudgetStatus } from "./types.ts";

/** Rust commands in src-tauri/src/commands.rs. */
export const tauriBridge: Bridge = {
  kind: "tauri",
  run: (model, body) => invoke("clef_run", { model, body }),
  cacheGet: (key) => invoke("cache_get", { key }),
  cachePut: (key, value) => invoke("cache_put", { key, value }),
  budget: () => invoke<BudgetStatus>("budget_status"),
};

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;
