/**
 * Thin client over the `filtering_request` IPC command.
 *
 * Builds API paths, turns a query object into the pairs Rust expects, and
 * converts the `RequestResult` into either the parsed JSON body (`null` for
 * 204) or a thrown `FilteringApiError`. Rust validates every path again —
 * these builders exist so components never concatenate URLs themselves.
 */

import { getQueryClient, queryKeys } from "@/lib/api/query-client";
import { commands } from "@/lib/api/tauri-client";
import type {
  CatalogName,
  FilteringMethod,
  FilteringRequestParams,
  Page,
  ProfileCollection,
  QueryPairs,
} from "@/types/filtering";
import type { RequestResult } from "@/types/request";

import { FilteringApiError, parseApiError } from "./errors";

// ─── Paths ────────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

export const filteringPaths = {
  profiles: () => "/v1/filtering-profiles",
  profile: (id: string) => `/v1/filtering-profiles/${enc(id)}`,
  setPrimary: (id: string) => `/v1/filtering-profiles/${enc(id)}/set-primary`,
  clone: (id: string) => `/v1/filtering-profiles/${enc(id)}/clone`,
  collection: (id: string, collection: ProfileCollection) =>
    `/v1/filtering-profiles/${enc(id)}/${collection}`,
  item: (id: string, collection: Exclude<ProfileCollection, "logs">, itemId: string) =>
    `/v1/filtering-profiles/${enc(id)}/${collection}/${enc(itemId)}`,
  catalog: (name: CatalogName) => `/v1/filtering/${name}`,
} as const;

// ─── Query ────────────────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | null | undefined | readonly string[];
export type QueryInput = Record<string, QueryValue>;

/**
 * Turn `{page: 2, labels: [a, b], search: ""}` into
 * `[["page","2"],["labels",a],["labels",b]]`. Empty strings, `null` and
 * `undefined` are dropped; arrays repeat the key. Key order is stable.
 */
export function buildQuery(input: QueryInput | undefined): QueryPairs {
  const pairs: QueryPairs = [];
  if (!input) return pairs;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value as readonly string[]) if (v !== "") pairs.push([key, v]);
      continue;
    }
    const s = String(value);
    if (s.trim() === "") continue;
    pairs.push([key, s]);
  }
  return pairs;
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export type CallOptions = {
  query?: QueryInput;
  body?: Record<string, unknown>;
};

/**
 * Perform one filtering call. Resolves with the parsed JSON body (or `null`
 * for an empty 2xx such as 204) and rejects with a `FilteringApiError` for
 * any non-2xx status or a 2xx body that is not JSON. Transport failures and
 * 429 reject with the `TauriError` Rust produced.
 */
export async function filteringCall<T>(
  method: FilteringMethod,
  path: string,
  options: CallOptions = {}
): Promise<T> {
  return apiCall<T>(commands.filtering.request, method, path, options);
}

/** An allowlisted pass-through command (`filtering_request`, `clients_request`). */
export type PassThroughCommand = (args: {
  params: FilteringRequestParams;
}) => Promise<RequestResult>;

/**
 * Shared body of `filteringCall` and `clientsCall`: send through `command`,
 * then return the parsed JSON (`null` for an empty 2xx) or throw a
 * `FilteringApiError` for a non-2xx status or a non-JSON 2xx body.
 */
export async function apiCall<T>(
  command: PassThroughCommand,
  method: FilteringMethod,
  path: string,
  { query, body }: CallOptions = {}
): Promise<T> {
  const pairs = buildQuery(query);
  let result;
  try {
    result = await command({
      params: {
        method,
        path,
        ...(pairs.length > 0 ? { query: pairs } : {}),
        ...(body !== undefined ? { body } : {}),
      },
    });
  } finally {
    // The call may have minted (or dropped) the cached token.
    void getQueryClient().invalidateQueries({ queryKey: queryKeys.token.status() });
  }
  if (result.status < 200 || result.status >= 300) throw parseApiError(result);
  if (result.body.trim() === "" || result.status === 204) return null as T;
  if (!result.isJson) {
    throw new FilteringApiError(`Unexpected non-JSON response (HTTP ${result.status})`, {
      status: result.status,
      apiCode: "invalid_response",
    });
  }
  return JSON.parse(result.body) as T;
}

/** Largest page the API serves. */
export const MAX_PAGE_SIZE = 100;

/** Default cap of `fetchAllPages`: 10 pages of 100. */
export const MAX_PAGES = 10;

/** A fully paged-through list; `truncated` when the cap stopped it early. */
export type AllPages<T> = { items: T[]; count: number; truncated: boolean };

/**
 * Collect every item of a paginated list (catalogs, a profile's keywords).
 * Stops at `maxPages` so a runaway catalog cannot hang the page, and reports
 * that as `truncated` so the UI can say the list is incomplete.
 */
export async function fetchAllPages<T>(
  path: string,
  query: QueryInput = {},
  maxPages = MAX_PAGES
): Promise<AllPages<T>> {
  const items: T[] = [];
  let count = 0;
  for (let page = 1; page <= maxPages; page++) {
    const data = await filteringCall<Page<T>>("GET", path, {
      query: { ...query, page, page_size: MAX_PAGE_SIZE },
    });
    count = data.count;
    items.push(...data.results);
    if (data.results.length === 0 || items.length >= data.count) break;
  }
  return { items, count, truncated: items.length < count };
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export function totalPages(count: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(count / pageSize));
}

/** 1-based inclusive range of the items on `page`; `{from: 0, to: 0}` when empty. */
export function pageRange(page: number, pageSize: number, count: number) {
  if (count <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, count), to: Math.min(page * pageSize, count) };
}

/** Clamp a page number to `[1, totalPages]`. */
export function clampPage(page: number, count: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), totalPages(count, pageSize));
}
