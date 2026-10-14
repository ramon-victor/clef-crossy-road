export type ClefErrorKind =
  | "auth"
  | "bad_request"
  | "quota"
  | "rate_limit"
  | "capacity"
  | "server"
  | "network"
  | "timeout"
  | "schema";

/**
 * Anything that can go wrong with a call. Messages come from the service's `errors[]` and never
 * include request headers, so a token cannot leak through an error.
 */
export class ClefError extends Error {
  readonly kind: ClefErrorKind;
  readonly status: number | undefined;

  constructor(kind: ClefErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ClefError";
    this.kind = kind;
    this.status = status;
  }

  /** Worth another attempt with backoff. */
  get retryable(): boolean {
    return (
      this.kind === "rate_limit" ||
      this.kind === "capacity" ||
      this.kind === "server" ||
      this.kind === "network" ||
      this.kind === "timeout"
    );
  }

  /** The whole run should stop: nothing will work until a human intervenes. */
  get fatal(): boolean {
    return this.kind === "auth" || this.kind === "quota";
  }
}
