/**
 * Types for the local request log — the data source for the Monitoring page.
 *
 * Every API call made through any page (Requests, Playground, Test Suites)
 * is appended here. No backend required — all data is local.
 */

import type { EndpointId } from "./request";

/** Where the request originated in the app. */
export type RequestSource = "requests" | "bulk" | "suite" | "playground";

/**
 * Verdict from an Analyze response, mapped to the three frontend categories.
 * `null` for non-Analyze endpoints where a verdict is not applicable.
 */
export type RequestVerdict = "safe" | "risky" | "hitl" | null;

/** One logged API call. */
export type RequestLogEntry = {
  id: string;
  /** Unix ms timestamp of when the request was initiated. */
  timestamp: number;
  endpoint: EndpointId;
  durationMs: number;
  /** HTTP status code. 0 when the request threw before getting a response. */
  status: number;
  /** Derived from the Analyze response body. null for other endpoints. */
  verdict: RequestVerdict;
  /** 0–1 risk score from the Analyze response. null for other endpoints. */
  riskScore: number | null;
  /**
   * The `content` field from the request body (Analyze / Rewrite).
   * null when the endpoint doesn't take content.
   */
  content: string | null;
  /** Which part of the app originated this request. */
  source: RequestSource;
  /** Human-readable label (suite name, "Requests", "Playground"). */
  sourceName: string;
  /** Error message if the request failed before returning a response. */
  error: string | null;
};
