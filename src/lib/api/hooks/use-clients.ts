/**
 * React Query hooks for client management (`/v1/clients*`).
 *
 * Keys are scoped by the active credential (see `credentialScope`) and the
 * queries stay disabled until a credential with a stored secret is active.
 * Like filtering management, these calls are configuration, not traffic, so
 * they are not written to the local request log.
 */

import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../query-client";
import { useFilteringScope } from "./use-filtering";
import { clientsCall, clientsPaths } from "@/lib/clients/client";
import { MAX_PAGES, MAX_PAGE_SIZE, type QueryInput } from "@/lib/filtering/client";
import type { Client, ClientCreate, ClientWrite } from "@/types/clients";
import type { Page } from "@/types/filtering";

const STALE_MS = 30_000;

/** The active credential's cache scope, or `null` while none is usable. */
export const useClientsScope = useFilteringScope;

export type ClientListParams = {
  page: number;
  pageSize: number;
  search?: string;
  /** `true` / `false`; omitted for every client. */
  isActive?: boolean;
  ordering?: string;
};

export function clientListQuery({
  page,
  pageSize,
  search,
  isActive,
  ordering,
}: ClientListParams): QueryInput {
  return {
    page,
    page_size: pageSize,
    search,
    is_active: isActive === undefined ? undefined : String(isActive),
    ordering,
  };
}

export function useClients(params: ClientListParams, options: { enabled?: boolean } = {}) {
  const cred = useClientsScope();
  return useQuery({
    queryKey: queryKeys.clients.list(cred ?? "", { ...params }),
    queryFn: () =>
      clientsCall<Page<Client>>("GET", clientsPaths.list(), { query: clientListQuery(params) }),
    enabled: cred !== null && (options.enabled ?? true),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/**
 * Every active client, for pickers (Playground). Capped at `MAX_PAGES`
 * pages; `truncated` says when the list is incomplete.
 */
export function useAllActiveClients(options: { enabled?: boolean } = {}) {
  const cred = useClientsScope();
  return useQuery({
    queryKey: queryKeys.clients.list(cred ?? "", { all: true, isActive: true }),
    queryFn: async () => {
      // `fetchAllPages` sends through the filtering command, so page here.
      const items: Client[] = [];
      let count = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await clientsCall<Page<Client>>("GET", clientsPaths.list(), {
          query: { page, page_size: MAX_PAGE_SIZE, is_active: "true", ordering: "name" },
        });
        count = data.count;
        items.push(...data.results);
        if (data.results.length === 0 || items.length >= data.count) break;
      }
      return { items, count, truncated: items.length < count };
    },
    enabled: cred !== null && (options.enabled ?? true),
    staleTime: STALE_MS,
  });
}

export function useClient(id: string | null) {
  const cred = useClientsScope();
  return useQuery({
    queryKey: queryKeys.clients.detail(cred ?? "", id ?? ""),
    queryFn: () => clientsCall<Client>("GET", clientsPaths.item(id ?? "")),
    enabled: cred !== null && Boolean(id),
    staleTime: STALE_MS,
  });
}

/**
 * Read one client fresh from the server — used right before the edit dialog
 * opens so the form never starts from a stale list row.
 */
export function useFetchClient() {
  const queryClient = useQueryClient();
  const cred = useClientsScope() ?? "";
  return useCallback(
    (id: string) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.clients.detail(cred, id),
        queryFn: () => clientsCall<Client>("GET", clientsPaths.item(id)),
        staleTime: 0,
      }),
    [queryClient, cred]
  );
}

function useClientsInvalidation() {
  const queryClient = useQueryClient();
  const cred = useClientsScope() ?? "";
  return {
    cred,
    queryClient,
    lists: () => queryClient.invalidateQueries({ queryKey: queryKeys.clients.lists(cred) }),
  };
}

export function useCreateClient() {
  const inv = useClientsInvalidation();
  return useMutation({
    mutationFn: (body: ClientCreate) => clientsCall<Client>("POST", clientsPaths.list(), { body }),
    onSuccess: (created) => {
      inv.queryClient.setQueryData(queryKeys.clients.detail(inv.cred, created.id), created);
      void inv.lists();
    },
  });
}

export function useUpdateClient() {
  const inv = useClientsInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ClientWrite }) =>
      clientsCall<Client>("PATCH", clientsPaths.item(id), { body }),
    onSuccess: (updated) => {
      inv.queryClient.setQueryData(queryKeys.clients.detail(inv.cred, updated.id), updated);
      void inv.lists();
    },
  });
}

export function useDeleteClient() {
  const inv = useClientsInvalidation();
  return useMutation({
    mutationFn: (id: string) => clientsCall<null>("DELETE", clientsPaths.item(id)),
    onSuccess: (_data, id) => {
      inv.queryClient.removeQueries({ queryKey: queryKeys.clients.detail(inv.cred, id) });
      void inv.lists();
    },
  });
}
