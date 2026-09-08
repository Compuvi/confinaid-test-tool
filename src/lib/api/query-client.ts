import { QueryClient } from "@tanstack/react-query";

import { TauriError } from "./errors";

/** Errors that will never succeed on retry. */
const TERMINAL_CODES = new Set([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  // Retrying a throttled request would corrupt the very measurement this tool
  // exists to take. Rate limiting is data here, not a transient failure.
  "RATE_LIMITED",
]);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        // IPC has no online/offline state; React Query's default would pause
        // queries whenever the browser reports offline.
        networkMode: "always",
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof TauriError && TERMINAL_CODES.has(error.code)) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      },
      mutations: {
        networkMode: "always",
        // Mutations here have side effects (keychain writes, request sends);
        // silently repeating one is worse than surfacing the failure.
        retry: 0,
      },
    },
  });
}

let client: QueryClient | undefined;

export function getQueryClient() {
  if (!client) client = createQueryClient();
  return client;
}

/**
 * Hierarchical cache keys. Seeded with the full eventual surface so feature
 * work extends this rather than inventing a parallel scheme.
 */
export const queryKeys = {
  app: {
    all: ["app"] as const,
    runtimeInfo: () => [...queryKeys.app.all, "runtime-info"] as const,
  },
  credentials: {
    all: ["credentials"] as const,
    active: () => [...queryKeys.credentials.all, "active"] as const,
  },
  suites: {
    all: ["suites"] as const,
    lists: () => [...queryKeys.suites.all, "list"] as const,
    detail: (id: string) => [...queryKeys.suites.all, "detail", id] as const,
  },
  runs: {
    all: ["runs"] as const,
    lists: () => [...queryKeys.runs.all, "list"] as const,
    detail: (id: string) => [...queryKeys.runs.all, "detail", id] as const,
  },
  reports: {
    all: ["reports"] as const,
    detail: (runId: string) => [...queryKeys.reports.all, "detail", runId] as const,
  },
} as const;
