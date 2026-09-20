/**
 * Assertion evaluation for the Suites runner.
 *
 * All logic is pure TypeScript — no React, no Tauri IPC. The functions here
 * are called from the suites page after each `commands.request.send` response.
 */

import type { RequestResult } from "@/types/request";
import type { Assertion, AssertionResult } from "@/types/suite";

// ──────────────────────────────────────────────────────── Path traversal ──

/**
 * Walk a dot-notation path into an arbitrary object.
 *
 * Examples:
 *   getPath({ a: { b: 1 } }, "a.b")  → 1
 *   getPath({ a: [{ id: "x" }] }, "a") → [{ id: "x" }]
 *   getPath({ a: 1 }, "a.b.c") → undefined
 */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ──────────────────────────────────────────────────────── Label builder ───

/**
 * Human-readable summary of an assertion, used in the results panel.
 * Example: `"status eq 200"`, `"body.risk_score exists"`, `"latency ≤ 500ms"`
 */
export function assertionLabel(a: Assertion): string {
  switch (a.type) {
    case "status":
      return `status ${a.op} ${a.value}`;
    case "body":
      if (a.op === "exists" || a.op === "not_exists") {
        return `body.${a.path || "*"} ${a.op}`;
      }
      return `body.${a.path || "*"} ${a.op} "${a.value ?? ""}"`;
    case "header":
      if (a.op === "exists") return `header[${a.name}] exists`;
      return `header[${a.name}] ${a.op} "${a.value ?? ""}"`;
    case "latency":
      return `latency ≤ ${a.value}ms`;
  }
}

// ──────────────────────────────────────────────────────── Evaluators ──────

export function evaluateAssertion(assertion: Assertion, result: RequestResult): AssertionResult {
  const label = assertionLabel(assertion);

  switch (assertion.type) {
    // ── Status ──────────────────────────────────────────────────────────
    case "status": {
      const actual = String(result.status);
      let passed = false;
      switch (assertion.op) {
        case "eq":
          passed = result.status === assertion.value;
          break;
        case "ne":
          passed = result.status !== assertion.value;
          break;
        case "gte":
          passed = result.status >= assertion.value;
          break;
        case "lte":
          passed = result.status <= assertion.value;
          break;
      }
      return { assertion, label, passed, actual };
    }

    // ── Body (JSON) ──────────────────────────────────────────────────────
    case "body": {
      let parsed: unknown;
      if (result.isJson) {
        try {
          parsed = JSON.parse(result.body);
        } catch {
          // Treat as unparseable — path traversal will return undefined.
        }
      }

      const value = getPath(parsed, assertion.path);
      const actual = value === undefined ? "(not found)" : JSON.stringify(value);

      let passed = false;
      switch (assertion.op) {
        case "exists":
          passed = value !== undefined;
          break;
        case "not_exists":
          passed = value === undefined;
          break;
        case "eq":
          passed = String(value) === (assertion.value ?? "");
          break;
        case "ne":
          passed = String(value) !== (assertion.value ?? "");
          break;
        case "contains":
          passed = actual.includes(assertion.value ?? "");
          break;
        case "not_contains":
          passed = !actual.includes(assertion.value ?? "");
          break;
      }
      return { assertion, label, passed, actual };
    }

    // ── Header ───────────────────────────────────────────────────────────
    case "header": {
      const headers = new Map(result.headers.map(([k, v]) => [k.toLowerCase(), v]));
      const headerValue = headers.get(assertion.name.toLowerCase());
      const actual = headerValue ?? "(not found)";

      let passed = false;
      switch (assertion.op) {
        case "exists":
          passed = headerValue !== undefined;
          break;
        case "eq":
          passed = headerValue === assertion.value;
          break;
        case "contains":
          passed = (headerValue ?? "").includes(assertion.value ?? "");
          break;
      }
      return { assertion, label, passed, actual };
    }

    // ── Latency ──────────────────────────────────────────────────────────
    case "latency": {
      const actual = `${result.durationMs}ms`;
      const passed = result.durationMs <= assertion.value;
      return { assertion, label, passed, actual };
    }
  }
}

/** Evaluate all assertions for one test case, returning one result per assertion. */
export function evaluateAssertions(
  assertions: Assertion[],
  result: RequestResult
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, result));
}
