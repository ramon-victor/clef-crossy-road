import { invoke } from "@tauri-apps/api/core";
import type { Bridge, BudgetStatus, CredentialStatus } from "./types.ts";

/** Rust commands in src-tauri/src/commands.rs. */
export const tauriBridge: Bridge = {
  kind: "tauri",
  run: (model, body) => invoke("clef_run", { model, body }),
  cacheGet: (key) => invoke("cache_get", { key }),
  cachePut: (key, value) => invoke("cache_put", { key, value }),
  budget: () => invoke<BudgetStatus>("budget_status"),
  credentialStatus: () => invoke<CredentialStatus>("credential_status"),
  saveCredentials: (input) => invoke<CredentialStatus>("save_credentials", { input }),
};

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;
