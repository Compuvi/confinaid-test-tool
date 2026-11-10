/**
 * Partner API errors of the filtering endpoints.
 *
 * Every non-2xx response carries `{"error":{"code","message","request_id","details?"}}`.
 * `details` maps public field names to messages for `validation_failed` (422)
 * and `conflict` (409); nested bypass-rule condition errors are flattened as
 * `conditions[0].threshold`. The helpers below turn that into something a
 * form can render inline, with the rest left for a toast.
 */

import { TauriError, type TauriErrorCode } from "@/lib/api/errors";
import type { ApiErrorEnvelope, ErrorDetails } from "@/types/filtering";
import type { RequestResult } from "@/types/request";

/** Map an HTTP status onto the existing error taxonomy so the query client's
 * "terminal error, do not retry" logic applies unchanged. */
function statusToCode(status: number): TauriErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return "VALIDATION_ERROR";
  }
  return "UNKNOWN";
}

export class FilteringApiError extends TauriError {
  readonly status: number;
  /** The API's stable error code (`validation_failed`, `forbidden`, …). */
  readonly apiCode: string;
  readonly requestId: string | null;
  readonly fieldErrors: ErrorDetails;

  constructor(
    message: string,
    opts: { status: number; apiCode: string; requestId?: string | null; details?: ErrorDetails }
  ) {
    super(message, statusToCode(opts.status), opts.details ?? null);
    this.name = "FilteringApiError";
    this.status = opts.status;
    this.apiCode = opts.apiCode;
    this.requestId = opts.requestId ?? null;
    this.fieldErrors = opts.details ?? {};
  }
}

function sanitizeDetails(value: unknown): ErrorDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ErrorDetails = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const list = Array.isArray(raw) ? raw : [raw];
    const messages = list.filter((m): m is string => typeof m === "string" && m.length > 0);
    if (messages.length > 0) out[key] = messages;
  }
  return out;
}

/** Build a `FilteringApiError` from a non-2xx `RequestResult`. */
export function parseApiError(result: RequestResult): FilteringApiError {
  let envelope: Partial<ApiErrorEnvelope> | null = null;
  if (result.isJson && result.body) {
    try {
      envelope = JSON.parse(result.body) as Partial<ApiErrorEnvelope>;
    } catch {
      envelope = null;
    }
  }
  const err = envelope?.error;
  const apiCode = typeof err?.code === "string" ? err.code : `http_${result.status}`;
  const message =
    typeof err?.message === "string" && err.message
      ? err.message
      : `HTTP ${result.status} ${result.statusText}`.trim();
  return new FilteringApiError(message, {
    status: result.status,
    apiCode,
    requestId: typeof err?.request_id === "string" ? err.request_id : null,
    details: sanitizeDetails(err?.details),
  });
}

export const isFilteringApiError = (e: unknown): e is FilteringApiError =>
  e instanceof FilteringApiError;

/**
 * True when the call was refused because the credential (or licence) does
 * not cover filtering management — the case the page explains with a hint to
 * grant `filtering_read` / `filtering_write` in the Confinaid dashboard.
 * `limit_reached` and `feature_disabled` are also 403 but need other action.
 */
export function isScopeError(e: unknown): boolean {
  return isFilteringApiError(e) && e.status === 403 && e.apiCode === "forbidden";
}

// ─── Field errors ─────────────────────────────────────────────────────────────

export type SplitFieldErrors = {
  /** Top-level fields, e.g. `title`. */
  fields: Record<string, string[]>;
  /** Per-condition fields: `conditions[1].threshold` -> `conditions[1].threshold`. */
  conditions: Record<number, Record<string, string[]>>;
  /** `non_field_errors`, plus anything with an unrecognised key shape. */
  general: string[];
};

const CONDITION_KEY = /^conditions\[(\d+)\](?:\.(.+))?$/;

/**
 * Split an error `details` map into top-level fields, nested condition fields
 * and general messages. `conditions[0]` with no sub-field maps to the
 * condition's `_` slot; a plain `conditions` key stays a top-level field.
 */
export function splitFieldErrors(details: ErrorDetails | null | undefined): SplitFieldErrors {
  const out: SplitFieldErrors = { fields: {}, conditions: {}, general: [] };
  if (!details) return out;
  for (const [key, messages] of Object.entries(details)) {
    if (key === "non_field_errors" || key === "detail") {
      out.general.push(...messages);
      continue;
    }
    const m = CONDITION_KEY.exec(key);
    if (m) {
      const index = Number(m[1]);
      const field = m[2] ?? "_";
      out.conditions[index] ??= {};
      out.conditions[index][field] = [...(out.conditions[index][field] ?? []), ...messages];
      continue;
    }
    out.fields[key] = [...(out.fields[key] ?? []), ...messages];
  }
  return out;
}

/** Field errors of an unknown error, or an empty map. */
export function fieldErrorsOf(e: unknown): ErrorDetails {
  return isFilteringApiError(e) ? e.fieldErrors : {};
}

/**
 * Lines for a toast: the message, then every detail whose field the form
 * does not render inline (`shown`), formatted as `field: message`.
 */
export function describeError(e: unknown, shown: readonly string[] = []): string[] {
  if (!(e instanceof Error)) return [typeof e === "string" ? e : "An unknown error occurred"];
  const lines = [e.message];
  if (isFilteringApiError(e)) {
    const shownSet = new Set(shown);
    for (const [field, messages] of Object.entries(e.fieldErrors)) {
      const inline =
        shownSet.has(field) || (shownSet.has("conditions[]") && CONDITION_KEY.test(field));
      if (inline) continue;
      const prefix = field === "non_field_errors" ? "" : `${field}: `;
      for (const msg of messages) lines.push(`${prefix}${msg}`);
    }
  }
  return lines;
}
