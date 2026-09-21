import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands } from "../tauri-client";
import { queryKeys } from "../query-client";
import type { CredentialInput } from "@/types/credentials";

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
    },
  });
}
