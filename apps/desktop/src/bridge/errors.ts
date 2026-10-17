import { ClefError, type ClefErrorKind } from "@ccr/clef";

export const BRIDGE_ERROR_CODES = [
  "credentials_missing",
  "account_invalid",
  "token_invalid",
  "credentials_save",
  "model_not_allowed",
  "quota",
  "network",
  "bridge",
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];
export type ErrorCode = BridgeErrorCode | ClefErrorKind | "unknown" | "render";

export interface ErrorInfo {
  code: ErrorCode;
  /** Original technical diagnostic. App-owned errors never include submitted credentials. */
  detail: string;
  params?: Record<string, number>;
}

export interface BridgeFailure {
  code: BridgeErrorCode;
  message: string;
  params?: Record<string, number>;
}

/** Preserve classification through ClefClient without deriving it from English prose. */
export class BridgeError extends ClefError {
  readonly code: BridgeErrorCode;
  readonly params: BridgeFailure["params"];

  constructor(failure: BridgeFailure) {
    super(
      failure.code === "credentials_missing"
        ? "auth"
        : failure.code === "quota"
          ? "quota"
          : failure.code === "network" || failure.code === "bridge"
            ? "network"
            : "bad_request",
      failure.message,
    );
    this.code = failure.code;
    this.params = failure.params;
  }
}

export function bridgeError(reason: unknown): BridgeError {
  if (reason instanceof BridgeError) return reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    "message" in reason &&
    BRIDGE_ERROR_CODES.some((code) => code === reason.code) &&
    typeof reason.message === "string"
  ) {
    return new BridgeError(reason as BridgeFailure);
  }
  return new BridgeError({
    code: "bridge",
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Local bridge request failed.",
  });
}

export function errorInfo(reason: unknown): ErrorInfo {
  return {
    ...(reason instanceof BridgeError && reason.params ? { params: reason.params } : {}),
    code:
      reason instanceof BridgeError
        ? reason.code
        : reason instanceof ClefError
          ? reason.kind
          : "unknown",
    detail:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unknown error",
  };
}
