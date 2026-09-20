/**
 * Types for the Suites feature.
 *
 * A Suite is a named, ordered list of TestCases. Each TestCase fires one
 * request against the Partner API and evaluates a list of Assertions on the
 * response. The suite runner executes cases sequentially and accumulates a
 * SuiteRunResult with per-case pass/fail details.
 *
 * These types are pure TypeScript — no Rust IPC involved. Suites run entirely
 * in the frontend layer by re-using the existing `commands.request.send`
 * Tauri command that the Requests page already uses.
 */

import type { EndpointId } from "./request";

// ──────────────────────────────────────────────────────── Assertions ──────

/** Operators available for status-code assertions. */
export type StatusOp = "eq" | "ne" | "gte" | "lte";

/**
 * Operators available for JSON body assertions.
 * "exists" / "not_exists" do not require a `value` field.
 */
export type BodyOp = "eq" | "ne" | "contains" | "not_contains" | "exists" | "not_exists";

/** Operators available for response-header assertions. */
export type HeaderOp = "eq" | "contains" | "exists";

/** Only lte is meaningful for latency ("must respond within N ms"). */
export type LatencyOp = "lte";

/** Assert on the HTTP response status code. */
export type StatusAssertion = {
  type: "status";
  op: StatusOp;
  value: number;
};

/**
 * Assert on a field within the parsed JSON response body.
 *
 * `path` uses dot-notation, e.g. `"risk_score"`, `"data.entities[0].type"`.
 * For op `"exists"` / `"not_exists"`, `value` is ignored.
 */
export type BodyAssertion = {
  type: "body";
  path: string;
  op: BodyOp;
  value?: string;
};

/**
 * Assert on a response header value.
 * `name` is matched case-insensitively.
 * For op `"exists"`, `value` is ignored.
 */
export type HeaderAssertion = {
  type: "header";
  name: string;
  op: HeaderOp;
  value?: string;
};

/** Assert that the response round-trip completed within `value` milliseconds. */
export type LatencyAssertion = {
  type: "latency";
  op: LatencyOp;
  value: number;
};

/** Discriminated union of all assertion variants. */
export type Assertion = StatusAssertion | BodyAssertion | HeaderAssertion | LatencyAssertion;

// ──────────────────────────────────────────────────────── Test case ───────

/**
 * One unit of work inside a Suite.
 *
 * The runner fires `endpoint` with `body`, waits for a response, then
 * evaluates all `assertions`. The case passes only when every assertion
 * passes (or there are no assertions and the request itself succeeds).
 */
export type TestCase = {
  id: string;
  name: string;
  endpoint: EndpointId;
  /** JSON body that will be sent verbatim to the Tauri `send_request` command. */
  body: Record<string, unknown>;
  assertions: Assertion[];
  /**
   * Per-case timeout override in milliseconds.
   * When `undefined`, the global config timeout is used.
   */
  timeoutMs?: number;
};

// ──────────────────────────────────────────────────────── Suite ───────────

export type Suite = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  cases: TestCase[];
};

// ──────────────────────────────────────────────────────── Run results ─────

/** Result of evaluating one Assertion against a response. */
export type AssertionResult = {
  assertion: Assertion;
  /** Human-readable summary of the check, e.g. `"status eq 200"`. */
  label: string;
  passed: boolean;
  /** The actual value found in the response, as a string. */
  actual: string;
};

/** Result of running one TestCase. */
export type CaseResult = {
  caseId: string;
  caseName: string;
  /** True when all assertions passed (or there were none). */
  passed: boolean;
  /** HTTP status code of the response (0 when the request itself failed). */
  status: number;
  durationMs: number;
  assertionResults: AssertionResult[];
  /** Populated when the request threw (network error, Tauri error, etc.). */
  error?: string;
};

/** Aggregated result of a full suite run. */
export type SuiteRunResult = {
  suiteId: string;
  suiteName: string;
  startedAt: number;
  finishedAt: number;
  passed: number;
  failed: number;
  total: number;
  caseResults: CaseResult[];
};
