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
  detail: string;
  params?: Record<string, number>;
}

export interface BridgeFailure {
  code: BridgeErrorCode;
  message: string;
  params?: Record<string, number>;
}

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
    const params =
      "params" in reason &&
      reason.params !== null &&
      typeof reason.params === "object" &&
      !Array.isArray(reason.params)
        ? Object.fromEntries(
            Object.entries(reason.params).filter(
              ([, value]) => typeof value === "number" && Number.isFinite(value),
            ),
          )
        : undefined;
    return new BridgeError({
      code: reason.code as BridgeErrorCode,
      message: reason.message,
      ...(params && Object.keys(params).length ? { params } : {}),
    });
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
