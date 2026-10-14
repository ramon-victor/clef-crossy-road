import type { CachedEntry, ClefModel, TransportResponse } from "@ccr/clef";

export interface BudgetStatus {
  /** Neurons spent today (UTC) according to the shared ledger. */
  spent: number;
  /** Daily ceiling: the free tier. */
  limit: number;
  day: string;
}

/**
 * Everything the UI needs from the native side. The webview never holds the Cloudflare token: the
 * Tauri build forwards these calls to Rust commands, the browser dev build to a local Vite plugin.
 * Both enforce the daily budget and record spending themselves.
 */
export interface Bridge {
  readonly kind: "tauri" | "http";
  run(model: ClefModel, body: unknown): Promise<TransportResponse>;
  cacheGet(key: string): Promise<CachedEntry | null>;
  cachePut(key: string, value: CachedEntry): Promise<void>;
  budget(): Promise<BudgetStatus>;
}
