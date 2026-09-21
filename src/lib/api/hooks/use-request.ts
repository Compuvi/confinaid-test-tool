import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { commands } from "../tauri-client";
import { getErrorMessage } from "../errors";
import { logRequest, logFailedRequest } from "../request-logger";
import { useRequestStore } from "@/stores/request-store";
import type { SendRequestParams } from "@/types/request";

const TOKEN_STATUS_KEY = ["token-status"] as const;

// ─── Token status ─────────────────────────────────────────────────────────────

/**
 * Returns the cached token hint without making a network call.
 *
 * Refetches every 30 seconds so the badge stays accurate after a token
 * exchange or revoke from another session.
 */
export function useTokenStatus() {
  return useQuery({
    queryKey: TOKEN_STATUS_KEY,
    queryFn: commands.request.getTokenStatus,
    refetchInterval: 30_000,
    networkMode: "always",
  });
}

// ─── Send request ─────────────────────────────────────────────────────────────

/**
 * Mutation for firing one request against the Confinaid Partner API.
 *
 * On success:  stores the response in `useRequestStore`.
 * On error:    stores the error message in `useRequestStore`; does NOT throw
 *              so the component does not need its own error handler.
 */
export function useSendRequest() {
  const queryClient = useQueryClient();
  // Access the store imperatively (not as a hook) so this hook's hook-count
  // stays stable and doesn't add a second useSyncExternalStore call on top of
  // the one the caller already owns.
  const store = useRequestStore;

  return useMutation({
    networkMode: "always",

    mutationFn: (params: SendRequestParams) => commands.request.send({ params }),

    onMutate: () => {
      store.getState().setLoading(true);
      store.getState().setError(null);
    },

    onSuccess: (result, params) => {
      store.getState().setResponse(result);
      store.getState().setLoading(false);
      // Refresh the token badge immediately after every call — a Token,
      // Refresh or Revoke call may have changed the cache state in Rust.
      void queryClient.invalidateQueries({ queryKey: TOKEN_STATUS_KEY });
      // Log to the local request log for the Monitoring page.
      logRequest({
        endpoint: params.endpoint,
        requestBody: params.body,
        result,
        source: "requests",
        sourceName: "Requests",
      });
    },

    onError: (err: unknown, params) => {
      const message = getErrorMessage(err);
      store.getState().setError(message);
      store.getState().setLoading(false);
      logFailedRequest({
        endpoint: params.endpoint,
        requestBody: params.body,
        error: message,
        source: "requests",
        sourceName: "Requests",
      });
    },
  });
}
