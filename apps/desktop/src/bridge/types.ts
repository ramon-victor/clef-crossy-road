import type { CachedEntry, ClefModel, TransportResponse } from "@ccr/clef";

export interface BudgetStatus {
  /** Neurons spent today (UTC) according to the shared ledger. */
  spent: number;
  /** Daily ceiling: the free tier. */
  limit: number;
  day: string;
}

/** Entered by the user, sent once to the backend, then cleared from the form. */
export interface CredentialInput {
  accountId: string;
  apiToken: string;
}

/** No saved credentials, identifiers or token fragments are returned to the UI. */
export interface CredentialStatus {
  configured: boolean;
}

/**
 * Everything the UI needs from the native side. Saved credentials stay in the backend: the
 * Tauri build forwards these calls to Rust commands, the browser dev build to a local Vite plugin.
 * Both enforce the daily budget and record spending themselves.
 */
export interface Bridge {
  readonly kind: "tauri" | "http";
  run(model: ClefModel, body: unknown): Promise<TransportResponse>;
  cacheGet(key: string): Promise<CachedEntry | null>;
  cachePut(key: string, value: CachedEntry): Promise<void>;
  budget(): Promise<BudgetStatus>;
  credentialStatus(): Promise<CredentialStatus>;
  saveCredentials(input: CredentialInput): Promise<CredentialStatus>;
}
