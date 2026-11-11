/**
 * Thin client over the `clients_request` IPC command.
 *
 * Path builders plus `clientsCall`, which shares parsing and error handling
 * with the filtering client (`apiCall`): the API's error envelope is the same,
 * so `FilteringApiError`, `fieldErrorsOf` and `describeError` apply as-is.
 * Rust validates every path again.
 */

import { commands } from "@/lib/api/tauri-client";
import { apiCall, type CallOptions } from "@/lib/filtering/client";
import type { FilteringMethod } from "@/types/filtering";

const enc = encodeURIComponent;

export const clientsPaths = {
  list: () => "/v1/clients",
  item: (id: string) => `/v1/clients/${enc(id)}`,
} as const;

/** Perform one clients call. Same resolution rules as `filteringCall`. */
export function clientsCall<T>(
  method: FilteringMethod,
  path: string,
  options: CallOptions = {}
): Promise<T> {
  return apiCall<T>(commands.clients.request, method, path, options);
}
