import { invoke } from "@tauri-apps/api/core";
import { bridgeError } from "./errors.ts";
import type { Bridge, BudgetStatus, CredentialStatus } from "./types.ts";

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (reason) {
    throw bridgeError(reason);
  }
}

/** Rust commands in src-tauri/src/commands.rs. */
export const tauriBridge: Bridge = {
  kind: "tauri",
  run: (model, body) => command("clef_run", { model, body }),
  cacheGet: (key) => command("cache_get", { key }),
  cachePut: (key, value) => command("cache_put", { key, value }),
  budget: () => command<BudgetStatus>("budget_status"),
  credentialStatus: () => command<CredentialStatus>("credential_status"),
  saveCredentials: (input) => command<CredentialStatus>("save_credentials", { input }),
};

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;
