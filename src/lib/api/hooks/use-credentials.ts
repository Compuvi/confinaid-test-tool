import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { commands } from "../tauri-client";
import { queryKeys } from "../query-client";
import { useRequestStore } from "@/stores/request-store";
import type { CredentialInput } from "@/types/credentials";

let credentialEpoch = 0;

/**
 * Bumped on every credential change. A request that started under an older
 * epoch finished for the previous credential, so nothing may be adopted from
 * its response for the new one (see `useSendRequest`).
 */
export function currentCredentialEpoch(): number {
  return credentialEpoch;
}

/**
 * Drop everything that belongs to the previous credential. Rust evicts its
 * cached token on save / switch / delete; this does the same for state the
 * webview holds: the token badge, the token pair and analysis_id the
 * Requests page pre-fills, and cached filtering, clients and monitoring data.
 */
export function forgetCredentialState(queryClient: QueryClient) {
  credentialEpoch += 1;
  useRequestStore.getState().clearCredentialData();
  void queryClient.invalidateQueries({ queryKey: queryKeys.token.status() });
  // Filtering data belongs to the previous credential's company. Keys are
  // already scoped by credential identity; removing them as well means
  // nothing of it lingers in memory or reappears after switching back.
  queryClient.removeQueries({ queryKey: queryKeys.filtering.all });
  // Clients are per company in exactly the same way.
  queryClient.removeQueries({ queryKey: queryKeys.clients.all });
  // Monitoring summaries are fetched with the previous credential's token too.
  queryClient.removeQueries({ queryKey: queryKeys.monitoring.all });
}

export function useStoredCredentials() {
  return useQuery({
    queryKey: queryKeys.credentials.active(),
    queryFn: commands.credentials.load,
  });
}

/** List all saved profiles. */
export function useListProfiles() {
  return useQuery({
    queryKey: queryKeys.credentials.list(),
    queryFn: commands.credentials.list,
  });
}

export function useSaveCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: CredentialInput) => commands.credentials.save({ profile }),
    onSuccess: (stored) => {
      queryClient.setQueryData(queryKeys.credentials.active(), stored);
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list() });
      forgetCredentialState(queryClient);
    },
  });
}

/** Switch the active profile. Updates both the active and list caches. */
export function useSwitchProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileName: string) => commands.credentials.switch({ profileName }),
    onSuccess: (stored) => {
      queryClient.setQueryData(queryKeys.credentials.active(), stored);
      forgetCredentialState(queryClient);
    },
  });
}

/** Delete a profile. Returns the new active profile (or null). */
export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileName: string) => commands.credentials.delete({ profileName }),
    onSuccess: (newActive) => {
      queryClient.setQueryData(queryKeys.credentials.active(), newActive ?? null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list() });
      forgetCredentialState(queryClient);
    },
  });
}

export function useClearCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: commands.credentials.clear,
    onSuccess: (newActive) => {
      queryClient.setQueryData(queryKeys.credentials.active(), newActive ?? null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list() });
      forgetCredentialState(queryClient);
    },
  });
}
