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
export type BodyOp =
  "eq" | "ne" | "gte" | "lte" | "contains" | "not_contains" | "exists" | "not_exists";

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

// ──────────────────────────────────────────────────────── Variable capture ─

/**
 * Extracts a value from a response and stores it as a named variable.
 * Variables can be referenced in subsequent case bodies as {{variableName}}.
 */
export type Capture = {
  /** Name used in {{interpolation}} — only word characters allowed. */
  variable: string;
  /** Whether to pull from the JSON body or from a response header. */
  source: "body" | "header";
  /**
   * Dot-notation path for body sources (e.g. "access_token", "data.id").
   * Case-insensitive header name for header sources (e.g. "retry-after").
   */
  path: string;
};

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
   * Variable extractions applied after a successful response.
   * Captured values become available as {{name}} in subsequent case bodies.
   */
  captures?: Capture[];
  /**
   * Optional dataset for data-driven execution.
   * When present the runner fires this case once per row, substituting
   * each row's key→value pairs as {{variables}} in the body.
   */
  dataset?: DatasetRow[];
  /**
   * When true the runner skips this case without sending a request.
   * Useful for temporarily disabling a case during debugging.
   */
  disabled?: boolean;
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
  /**
   * When true the runner stops after the first failing/erroring case.
   * Skipped cases are never counted as failures.
   */
  bailOnFailure?: boolean;
  /**
   * "parallel" runs all non-disabled cases concurrently (faster, but
   * variable capture between cases is disabled).
   * Default / undefined → "sequential".
   */
  executionMode?: "sequential" | "parallel";
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

// ──────────────────────────────────────────────────────── Dataset ─────────

/**
 * One row of data supplied to a data-driven test case.
 * Keys become {{variables}} interpolated into the request body.
 */
export type DatasetRow = Record<string, string>;

/** Result of running one data row within a data-driven test case. */
export type DataRowResult = {
  rowIndex: number;
  rowData: DatasetRow;
  passed: boolean;
  status: number;
  durationMs: number;
  assertionResults: AssertionResult[];
  responseBody?: string;
  error?: string;
};

/** Result of running one TestCase. */
export type CaseResult = {
  caseId: string;
  caseName: string;
  /** True when all assertions passed (or there were none). */
  passed: boolean;
  /** True when the case was intentionally skipped (disabled). */
  skipped?: boolean;
  /** HTTP status code of the response (0 when the request itself failed or skipped). */
  status: number;
  durationMs: number;
  assertionResults: AssertionResult[];
  /** Populated when the request threw (network error, Tauri error, etc.). */
  error?: string;
  /** Raw response body — always captured so the user can inspect any response. */
  responseBody?: string;
  /**
   * Per-row results when the case was run with a dataset.
   * When present, `passed` reflects whether ALL rows passed.
   */
  datasetResults?: DataRowResult[];
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
