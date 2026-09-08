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

export function useSaveCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: CredentialInput) => commands.credentials.save({ profile }),
    onSuccess: (stored) => {
      // Seed the cache from the mutation result rather than refetching — the
      // command already returns the canonical stored profile.
      queryClient.setQueryData(queryKeys.credentials.active(), stored);
    },
  });
}

export function useClearCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: commands.credentials.clear,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.credentials.active(), null);
    },
  });
}
