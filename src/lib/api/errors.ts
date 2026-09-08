/**
 * Error taxonomy mirroring the Rust `AppError` enum in
 * `src-tauri/src/error.rs`, which serializes to `{ code, message, details }`.
 *
 * Keep `TauriErrorCode` in sync with `AppError::code()` on the Rust side —
 * that function is the authority.
 */

export type TauriErrorCode =
  | "UNKNOWN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

type RustErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

const KNOWN_CODES = new Set<string>([
  "UNKNOWN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "STORAGE_ERROR",
  "INTERNAL_ERROR",
]);

function toCode(value: unknown): TauriErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value)
    ? (value as TauriErrorCode)
    : "UNKNOWN";
}

export class TauriError extends Error {
  readonly code: TauriErrorCode;
  readonly details: unknown;

  constructor(message: string, code: TauriErrorCode = "UNKNOWN", details: unknown = null) {
    super(message);
    this.name = "TauriError";
    this.code = code;
    this.details = details;
  }

  /**
   * Normalizes whatever Tauri hands back on a rejected `invoke`.
   *
   * Commands returning `AppResult<T>` produce the structured object; anything
   * that panics or returns a bare string still has to be survivable.
   */
  static fromRust(error: unknown): TauriError {
    if (error instanceof TauriError) return error;

    if (typeof error === "string") {
      return new TauriError(error);
    }

    if (error && typeof error === "object") {
      const payload = error as RustErrorPayload;
      if (typeof payload.message === "string") {
        const code = toCode(payload.code);
        return construct(payload.message, code, payload.details ?? null);
      }
      if (error instanceof Error) {
        return new TauriError(error.message);
      }
    }

    return new TauriError("An unknown error occurred");
  }
}

export class ValidationError extends TauriError {
  constructor(message: string, details: unknown = null) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends TauriError {
  constructor(message: string, details: unknown = null) {
    super(message, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends TauriError {
  constructor(message: string, details: unknown = null) {
    super(message, "UNAUTHORIZED", details);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends TauriError {
  constructor(message: string, details: unknown = null) {
    super(message, "FORBIDDEN", details);
    this.name = "ForbiddenError";
  }
}

export class NetworkError extends TauriError {
  constructor(message: string, details: unknown = null) {
    super(message, "NETWORK_ERROR", details);
    this.name = "NetworkError";
  }
}

export class RateLimitedError extends TauriError {
  /** Parsed from the server's `Retry-After`, when it supplied one. */
  readonly retryAfterMs: number | null;

  constructor(message: string, details: unknown = null) {
    super(message, "RATE_LIMITED", details);
    this.name = "RateLimitedError";
    const value = (details as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    this.retryAfterMs = typeof value === "number" ? value : null;
  }
}

function construct(message: string, code: TauriErrorCode, details: unknown): TauriError {
  switch (code) {
    case "VALIDATION_ERROR":
      return new ValidationError(message, details);
    case "NOT_FOUND":
      return new NotFoundError(message, details);
    case "UNAUTHORIZED":
      return new UnauthorizedError(message, details);
    case "FORBIDDEN":
      return new ForbiddenError(message, details);
    case "NETWORK_ERROR":
      return new NetworkError(message, details);
    case "RATE_LIMITED":
      return new RateLimitedError(message, details);
    default:
      return new TauriError(message, code, details);
  }
}

export const isValidationError = (e: unknown): e is ValidationError =>
  e instanceof TauriError && e.code === "VALIDATION_ERROR";
export const isNotFoundError = (e: unknown): e is NotFoundError =>
  e instanceof TauriError && e.code === "NOT_FOUND";
export const isUnauthorizedError = (e: unknown): e is UnauthorizedError =>
  e instanceof TauriError && e.code === "UNAUTHORIZED";
export const isForbiddenError = (e: unknown): e is ForbiddenError =>
  e instanceof TauriError && e.code === "FORBIDDEN";
export const isNetworkError = (e: unknown): e is NetworkError =>
  e instanceof TauriError && e.code === "NETWORK_ERROR";
export const isRateLimitedError = (e: unknown): e is RateLimitedError =>
  e instanceof TauriError && e.code === "RATE_LIMITED";

/** Safe message extraction for toasts and inline error slots. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unknown error occurred";
}
