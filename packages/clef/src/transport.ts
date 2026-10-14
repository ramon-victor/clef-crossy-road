import type { ClefModel } from "./models.ts";

export interface TransportRequest {
  model: ClefModel;
  /** The JSON body to POST. The transport adds authentication; callers never see the token. */
  body: unknown;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Parsed JSON body, or null if the body was not JSON. */
  json: unknown;
  /** Value of `Retry-After`, in milliseconds, if the service sent one. */
  retryAfterMs?: number;
}

/**
 * How a request reaches Workers AI. Two implementations exist: Node (`@ccr/clef/node`, uses the
 * REST API with a token from `.env`) and Tauri (Phase 3, `invoke("clef_run")`, token held by Rust).
 * Implementations throw only for network-level failures; HTTP errors are returned as responses.
 */
export interface Transport {
  post(request: TransportRequest): Promise<TransportResponse>;
}
