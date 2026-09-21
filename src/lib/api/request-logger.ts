/**
 * Shared helpers for logging API calls to the local request log.
 *
 * Every page that fires a `commands.request.send` call imports these helpers
 * so the Monitoring page always has an up-to-date picture of local traffic.
 */

import { useRequestLogStore } from "@/stores/request-log-store";
import type { RequestLogEntry, RequestSource, RequestVerdict } from "@/types/request-log";
import type { EndpointId, RequestResult } from "@/types/request";

// ──────────────────────────────────────────────────────── Verdict ─────────

/**
 * Derive a verdict from an Analyze response body.
 *
 * Uses the same multi-field fallback logic as the Playground page so the
 * monitoring verdict is always consistent with what the user sees in the UI.
 */
export function deriveVerdict(endpoint: EndpointId, body: string, isJson: boolean): RequestVerdict {
  if (endpoint !== "Analyze") return null;
  if (!isJson || !body.trim()) return null;
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const rawStatus =
      (raw.status as string | undefined) ??
      (raw.verdict as string | undefined) ??
      (raw.risk_status as string | undefined) ??
      (raw.decision as string | undefined);

    const VALID = new Set<string>(["safe", "risky", "hitl"]);
    if (VALID.has(rawStatus ?? "")) return rawStatus as RequestVerdict;

    // Fall back: derive from risk_score when the status field is absent.
    const score = typeof raw.risk_score === "number" ? raw.risk_score : 0;
    if (score >= 0.7) return "risky";
    if (score >= 0.3) return "hitl";
    return "safe";
  } catch {
    return null;
  }
}

/** Extract the 0–1 risk score from an Analyze response body. */
export function extractRiskScore(
  endpoint: EndpointId,
  body: string,
  isJson: boolean
): number | null {
  if (endpoint !== "Analyze") return null;
  if (!isJson || !body.trim()) return null;
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    return typeof raw.risk_score === "number" ? raw.risk_score : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────── Log helpers ─────

/** Log a successful API call. */
export function logRequest(params: {
  endpoint: EndpointId;
  requestBody: Record<string, unknown>;
  result: RequestResult;
  source: RequestSource;
  sourceName: string;
}): void {
  const { endpoint, requestBody, result, source, sourceName } = params;
  const entry: RequestLogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    endpoint,
    durationMs: result.durationMs,
    status: result.status,
    verdict: deriveVerdict(endpoint, result.body, result.isJson),
    riskScore: extractRiskScore(endpoint, result.body, result.isJson),
    content: typeof requestBody.content === "string" ? requestBody.content : null,
    source,
    sourceName,
    error: null,
  };
  useRequestLogStore.getState().addEntry(entry);
}

/** Log a failed API call (request threw before returning a response). */
export function logFailedRequest(params: {
  endpoint: EndpointId;
  requestBody: Record<string, unknown>;
  error: string;
  source: RequestSource;
  sourceName: string;
}): void {
  const { endpoint, requestBody, error, source, sourceName } = params;
  const entry: RequestLogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    endpoint,
    durationMs: 0,
    status: 0,
    verdict: null,
    riskScore: null,
    content: typeof requestBody.content === "string" ? requestBody.content : null,
    source,
    sourceName,
    error,
  };
  useRequestLogStore.getState().addEntry(entry);
}
