/**
 * React Query hooks for filtering profile management.
 *
 * Every key is scoped by the active credential's identity (profile name,
 * client ID and base URL — see `credentialScope`), and queries stay disabled
 * until a credential with a stored secret is active. Mutations invalidate the lists they affect plus
 * the profile's activity log, which records every change.
 *
 * These calls are not written to the local request log: they are
 * configuration management, not analyze/rewrite traffic, and would only
 * dilute the Monitoring and Reports figures.
 */

import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands } from "../tauri-client";
import { credentialScope, queryKeys } from "../query-client";
import { useStoredCredentials } from "./use-credentials";
import {
  fetchAllPages,
  filteringCall,
  filteringPaths,
  type QueryInput,
} from "@/lib/filtering/client";
import type {
  CatalogName,
  FilteringProfile,
  FilteringProfileCloneRequest,
  FilteringProfileCreate,
  FilteringProfileWrite,
  Keyword,
  Page,
  ProfileCollection,
} from "@/types/filtering";

/** Filtering data changes rarely and only through this page; keep it short anyway. */
const STALE_MS = 30_000;

/** The active credential's cache scope, or `null` while none is usable. */
export function useFilteringScope(): string | null {
  const { data } = useStoredCredentials();
  return data?.hasSecret ? credentialScope(data) : null;
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

export type ListParams = { page: number; pageSize: number; search?: string } & QueryInput;

function listQuery({ page, pageSize, ...rest }: ListParams): QueryInput {
  return { ...rest, page, page_size: pageSize };
}

export function useFilteringProfiles(params: ListParams) {
  const cred = useFilteringScope();
  return useQuery({
    queryKey: queryKeys.filtering.profileList(cred ?? "", params),
    queryFn: () =>
      filteringCall<Page<FilteringProfile>>("GET", filteringPaths.profiles(), {
        query: listQuery(params),
      }),
    enabled: cred !== null,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useFilteringProfile(id: string | null) {
  const cred = useFilteringScope();
  return useQuery({
    queryKey: queryKeys.filtering.profileDetail(cred ?? "", id ?? ""),
    queryFn: () => filteringCall<FilteringProfile>("GET", filteringPaths.profile(id ?? "")),
    enabled: cred !== null && Boolean(id),
    staleTime: STALE_MS,
  });
}

function useProfileInvalidation() {
  const queryClient = useQueryClient();
  const cred = useFilteringScope() ?? "";
  return {
    cred,
    queryClient,
    lists: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.filtering.profileLists(cred) }),
    logs: (id: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.filtering.collection(cred, id, "logs"),
      }),
  };
}

export function useCreateFilteringProfile() {
  const inv = useProfileInvalidation();
  return useMutation({
    mutationFn: (body: FilteringProfileCreate) =>
      filteringCall<FilteringProfile>("POST", filteringPaths.profiles(), { body }),
    onSuccess: (created) => {
      inv.queryClient.setQueryData(
        queryKeys.filtering.profileDetail(inv.cred, created.id),
        created
      );
      void inv.lists();
    },
  });
}

export function useUpdateFilteringProfile() {
  const inv = useProfileInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: FilteringProfileWrite }) =>
      filteringCall<FilteringProfile>("PATCH", filteringPaths.profile(id), { body }),
    onSuccess: (updated) => {
      inv.queryClient.setQueryData(
        queryKeys.filtering.profileDetail(inv.cred, updated.id),
        updated
      );
      void inv.lists();
      void inv.logs(updated.id);
    },
  });
}

export function useDeleteFilteringProfile() {
  const inv = useProfileInvalidation();
  return useMutation({
    mutationFn: (id: string) => filteringCall<null>("DELETE", filteringPaths.profile(id)),
    onSuccess: (_data, id) => {
      inv.queryClient.removeQueries({ queryKey: queryKeys.filtering.profileDetail(inv.cred, id) });
      inv.queryClient.removeQueries({ queryKey: queryKeys.filtering.profile(inv.cred, id) });
      void inv.lists();
    },
  });
}

export function useSetPrimaryFilteringProfile() {
  const inv = useProfileInvalidation();
  return useMutation({
    mutationFn: (id: string) =>
      filteringCall<FilteringProfile>("POST", filteringPaths.setPrimary(id), { body: {} }),
    onSuccess: (_updated, id) => {
      // Two profiles change (the new primary and the previous one), so
      // refresh every list and detail — but not collections or catalogs.
      void inv.queryClient.invalidateQueries({ queryKey: queryKeys.filtering.profiles(inv.cred) });
      void inv.logs(id);
    },
  });
}

export function useCloneFilteringProfile() {
  const inv = useProfileInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: FilteringProfileCloneRequest }) =>
      filteringCall<FilteringProfile>("POST", filteringPaths.clone(id), { body }),
    onSuccess: (created) => {
      inv.queryClient.setQueryData(
        queryKeys.filtering.profileDetail(inv.cred, created.id),
        created
      );
      void inv.lists();
    },
  });
}

/**
 * Forget the cached token and refetch: a token keeps the scopes it was
 * minted with, so this makes newly granted filtering scopes take effect.
 */
export function useFreshToken() {
  const queryClient = useQueryClient();
  const cred = useFilteringScope() ?? "";
  return useMutation({
    mutationFn: () => commands.request.clearTokenCache(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.token.status() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.filtering.scope(cred) });
    },
  });
}

// ─── Profile collections ─────────────────────────────────────────────────────

export function useProfileCollection<T>(
  profileId: string,
  collection: ProfileCollection,
  params: ListParams
) {
  const cred = useFilteringScope();
  return useQuery({
    queryKey: queryKeys.filtering.collectionPage(cred ?? "", profileId, collection, params),
    queryFn: () =>
      filteringCall<Page<T>>("GET", filteringPaths.collection(profileId, collection), {
        query: listQuery(params),
      }),
    enabled: cred !== null && Boolean(profileId),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/**
 * Every keyword of a profile — for the keyword-group and bypass-condition
 * pickers. `truncated` when the profile has more than `fetchAllPages` loads.
 */
export function useAllKeywords(profileId: string) {
  const cred = useFilteringScope();
  return useQuery({
    queryKey: queryKeys.filtering.collectionPage(cred ?? "", profileId, "keywords", {
      all: true,
    }),
    queryFn: () => fetchAllPages<Keyword>(filteringPaths.collection(profileId, "keywords")),
    enabled: cred !== null && Boolean(profileId),
    staleTime: STALE_MS,
  });
}

/**
 * Read one entry fresh from `GET …/{collection}/{item_id}`.
 *
 * Returns a fetcher rather than a query: the edit dialog needs the entry at
 * the moment it opens, not a subscription. Always refetched (`staleTime: 0`)
 * — the point is to edit what the server holds now, not the row the list
 * loaded earlier, which another client may have changed or deleted since.
 */
export function useFetchCollectionItem<T>(
  profileId: string,
  collection: Exclude<ProfileCollection, "logs">
) {
  const queryClient = useQueryClient();
  const cred = useFilteringScope() ?? "";
  return useCallback(
    (itemId: string) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.filtering.collectionItem(cred, profileId, collection, itemId),
        queryFn: () => filteringCall<T>("GET", filteringPaths.item(profileId, collection, itemId)),
        staleTime: 0,
      }),
    [queryClient, cred, profileId, collection]
  );
}

/** Collections whose entries other collections reference by id. */
const DEPENDENTS: Partial<Record<ProfileCollection, ProfileCollection[]>> = {
  keywords: ["keyword-groups", "bypass-rules"],
};

type WritableCollection = Exclude<ProfileCollection, "logs">;

export function useCollectionMutations<TItem, TBody extends object>(
  profileId: string,
  collection: WritableCollection
) {
  const queryClient = useQueryClient();
  const cred = useFilteringScope() ?? "";

  const invalidate = () => {
    for (const c of [collection, ...(DEPENDENTS[collection] ?? []), "logs"]) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.filtering.collection(cred, profileId, c),
      });
    }
  };

  const create = useMutation({
    mutationFn: (body: TBody) =>
      filteringCall<TItem>("POST", filteringPaths.collection(profileId, collection), {
        body: body as Record<string, unknown>,
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TBody> }) =>
      filteringCall<TItem>("PATCH", filteringPaths.item(profileId, collection, id), {
        body: body as Record<string, unknown>,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      filteringCall<null>("DELETE", filteringPaths.item(profileId, collection, id)),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

// ─── Catalogs ─────────────────────────────────────────────────────────────────

/**
 * Every entry of a catalog (paged through at 100 per page, capped at 1,000;
 * `truncated` says when the cap was hit).
 * `enabled` lets callers wait for a filter value such as the profile region.
 */
export function useCatalog<T>(name: CatalogName, query: QueryInput = {}, enabled = true) {
  const cred = useFilteringScope();
  return useQuery({
    queryKey: queryKeys.filtering.catalog(cred ?? "", name, query),
    queryFn: () => fetchAllPages<T>(filteringPaths.catalog(name), query),
    enabled: cred !== null && enabled,
    // Reference data: changes on the server side only.
    staleTime: 5 * 60_000,
  });
}
