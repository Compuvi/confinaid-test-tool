import { describe, expect, it } from "vitest";

import {
  getErrorMessage,
  isRateLimitedError,
  isValidationError,
  RateLimitedError,
  TauriError,
  ValidationError,
} from "./errors";

describe("TauriError.fromRust", () => {
  it("builds a typed subclass from the Rust AppError payload", () => {
    const error = TauriError.fromRust({
      code: "VALIDATION_ERROR",
      message: "API base URL must start with http:// or https://",
      details: null,
    });

    expect(error).toBeInstanceOf(ValidationError);
    expect(isValidationError(error)).toBe(true);
    expect(error.message).toBe("API base URL must start with http:// or https://");
  });

  it("extracts retryAfterMs from a rate-limit payload", () => {
    const error = TauriError.fromRust({
      code: "RATE_LIMITED",
      message: "429",
      details: { retryAfterMs: 2000 },
    });

    expect(isRateLimitedError(error)).toBe(true);
    expect((error as RateLimitedError).retryAfterMs).toBe(2000);
  });

  it("leaves retryAfterMs null when the server sent no Retry-After", () => {
    const error = TauriError.fromRust({
      code: "RATE_LIMITED",
      message: "429",
      details: { retryAfterMs: null },
    });

    expect((error as RateLimitedError).retryAfterMs).toBeNull();
  });

  it("survives a bare string, which is what a panicking command yields", () => {
    const error = TauriError.fromRust("something broke");
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("something broke");
  });

  it("maps an unrecognised code to UNKNOWN rather than trusting it", () => {
    const error = TauriError.fromRust({ code: "TOTALLY_NEW", message: "hi" });
    expect(error.code).toBe("UNKNOWN");
  });

  it("does not re-wrap an error it already produced", () => {
    const original = new ValidationError("bad");
    expect(TauriError.fromRust(original)).toBe(original);
  });

  it("falls back to a readable message for junk input", () => {
    expect(TauriError.fromRust(undefined).message).toBe("An unknown error occurred");
    expect(TauriError.fromRust(42).message).toBe("An unknown error occurred");
  });
});

describe("getErrorMessage", () => {
  it("reads Error, string, and anything else", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("boom")).toBe("boom");
    expect(getErrorMessage(null)).toBe("An unknown error occurred");
  });
});
