import { describe, expect, it } from "vitest";

import { RateLimitedError } from "@/lib/api/errors";
import type { RequestResult } from "@/types/request";

import {
  describeError,
  FilteringApiError,
  fieldErrorsOf,
  isScopeError,
  parseApiError,
  splitFieldErrors,
} from "./errors";

function result(status: number, body: unknown, statusText = ""): RequestResult {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    statusText,
    durationMs: 1,
    sizeBytes: text.length,
    body: text,
    isJson: typeof body !== "string",
    headers: [],
    url: "https://api.example.com/v1/filtering-profiles",
  };
}

describe("parseApiError", () => {
  it("reads code, message, request id and details from the envelope", () => {
    const err = parseApiError(
      result(422, {
        error: {
          code: "validation_failed",
          message: "The request failed validation.",
          request_id: "req-1",
          details: { title: ["This field is required."], "conditions[0].threshold": ["Too big"] },
        },
      })
    );
    expect(err).toBeInstanceOf(FilteringApiError);
    expect(err.status).toBe(422);
    expect(err.apiCode).toBe("validation_failed");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.requestId).toBe("req-1");
    expect(err.message).toBe("The request failed validation.");
    expect(err.fieldErrors).toEqual({
      title: ["This field is required."],
      "conditions[0].threshold": ["Too big"],
    });
  });

  it("maps statuses onto the terminal error codes", () => {
    const code = (s: number, c: string) =>
      parseApiError(result(s, { error: { code: c, message: "m" } })).code;
    expect(code(401, "unauthorized")).toBe("UNAUTHORIZED");
    expect(code(403, "forbidden")).toBe("FORBIDDEN");
    expect(code(404, "not_found")).toBe("NOT_FOUND");
    expect(code(409, "primary_profile_locked")).toBe("CONFLICT");
    expect(code(502, "upstream_unavailable")).toBe("UNKNOWN");
  });

  it("falls back to the HTTP status when the body is not an envelope", () => {
    const err = parseApiError(result(502, "Bad Gateway", "Bad Gateway"));
    expect(err.apiCode).toBe("http_502");
    expect(err.message).toBe("HTTP 502 Bad Gateway");
    expect(err.fieldErrors).toEqual({});
  });

  it("drops malformed details entries and wraps bare strings", () => {
    const err = parseApiError(
      result(409, {
        error: {
          code: "conflict",
          message: "m",
          details: { name: "Already exists.", bad: [1, null], empty: [] },
        },
      })
    );
    expect(err.fieldErrors).toEqual({ name: ["Already exists."] });
  });
});

describe("isScopeError", () => {
  const make = (status: number, code: string) =>
    new FilteringApiError("m", { status, apiCode: code });

  it("is true only for 403 forbidden", () => {
    expect(isScopeError(make(403, "forbidden"))).toBe(true);
    expect(isScopeError(make(403, "limit_reached"))).toBe(false);
    expect(isScopeError(make(403, "feature_disabled"))).toBe(false);
    expect(isScopeError(make(401, "unauthorized"))).toBe(false);
    expect(isScopeError(new RateLimitedError("slow"))).toBe(false);
    expect(isScopeError(new Error("x"))).toBe(false);
  });
});

describe("splitFieldErrors", () => {
  it("separates top-level, nested condition and general errors", () => {
    expect(
      splitFieldErrors({
        title: ["Required."],
        "conditions[0].threshold": ["Must be at most 100."],
        "conditions[0].keyword_ids": ["Pick one."],
        "conditions[2]": ["Invalid condition."],
        "conditions[10].label_ids": ["Wrong region."],
        conditions: ["At least one condition."],
        non_field_errors: ["Target already has a rule."],
      })
    ).toEqual({
      fields: { title: ["Required."], conditions: ["At least one condition."] },
      conditions: {
        0: { threshold: ["Must be at most 100."], keyword_ids: ["Pick one."] },
        2: { _: ["Invalid condition."] },
        10: { label_ids: ["Wrong region."] },
      },
      general: ["Target already has a rule."],
    });
  });

  it("handles missing details", () => {
    expect(splitFieldErrors(undefined)).toEqual({ fields: {}, conditions: {}, general: [] });
  });
});

describe("describeError", () => {
  const err = new FilteringApiError("Validation failed", {
    status: 422,
    apiCode: "validation_failed",
    details: {
      title: ["Required."],
      context: ["Too long."],
      "conditions[1].threshold": ["Bad."],
      non_field_errors: ["General."],
    },
  });

  it("lists details the form does not render inline", () => {
    expect(describeError(err, ["title"])).toEqual([
      "Validation failed",
      "context: Too long.",
      "conditions[1].threshold: Bad.",
      "General.",
    ]);
  });

  it("treats conditions[] as covering every nested condition key", () => {
    expect(describeError(err, ["title", "context", "conditions[]"])).toEqual([
      "Validation failed",
      "General.",
    ]);
  });

  it("works for plain errors and strings", () => {
    expect(describeError(new Error("boom"))).toEqual(["boom"]);
    expect(describeError("nope")).toEqual(["nope"]);
    expect(fieldErrorsOf(new Error("x"))).toEqual({});
  });
});
