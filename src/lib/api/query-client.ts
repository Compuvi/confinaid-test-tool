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
  /** Cached-token hint of the active credential (`get_token_status`). */
  token: {
    status: () => ["token-status"] as const,
  },
  credentials: {
    all: ["credentials"] as const,
    active: () => [...queryKeys.credentials.all, "active"] as const,
    list: () => [...queryKeys.credentials.all, "list"] as const,
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
  monitoring: {
    all: ["monitoring"] as const,
  },
  /**
   * Filtering profile data is per company, so every key is scoped by the
   * active credential's identity (`cred`, see `credentialScope`): switching
   * credentials — or re-saving one with another client ID or base URL —
   * never shows another company's cached profiles.
   *
   * `profiles` holds the profile lists and details (what set-primary
   * changes); `profile` holds each profile's collections and activity log.
   */
  filtering: {
    all: ["filtering"] as const,
    scope: (cred: string) => [...queryKeys.filtering.all, cred] as const,
    profiles: (cred: string) => [...queryKeys.filtering.scope(cred), "profiles"] as const,
    profileLists: (cred: string) => [...queryKeys.filtering.profiles(cred), "list"] as const,
    profileList: (cred: string, params: Record<string, unknown>) =>
      [...queryKeys.filtering.profileLists(cred), params] as const,
    profileDetail: (cred: string, id: string) =>
      [...queryKeys.filtering.profiles(cred), "detail", id] as const,
    profile: (cred: string, id: string) =>
      [...queryKeys.filtering.scope(cred), "profile", id] as const,
    collection: (cred: string, id: string, collection: string) =>
      [...queryKeys.filtering.profile(cred, id), collection] as const,
    collectionPage: (
      cred: string,
      id: string,
      collection: string,
      params: Record<string, unknown>
    ) => [...queryKeys.filtering.collection(cred, id, collection), params] as const,
    /** Under `collection`, so every write's invalidation reaches it too. */
    collectionItem: (cred: string, id: string, collection: string, itemId: string) =>
      [...queryKeys.filtering.collection(cred, id, collection), "item", itemId] as const,
    catalog: (cred: string, name: string, params: Record<string, unknown> = {}) =>
      [...queryKeys.filtering.scope(cred), "catalog", name, params] as const,
  },
  /**
   * Clients (the company's end customers), scoped by credential identity
   * like `filtering` so another company's clients never show from cache.
   */
  clients: {
    all: ["clients"] as const,
    scope: (cred: string) => [...queryKeys.clients.all, cred] as const,
    lists: (cred: string) => [...queryKeys.clients.scope(cred), "list"] as const,
    list: (cred: string, params: Record<string, unknown>) =>
      [...queryKeys.clients.lists(cred), params] as const,
    detail: (cred: string, id: string) => [...queryKeys.clients.scope(cred), "detail", id] as const,
  },
} as const;

/**
 * Identity of a stored credential for cache scoping: the same profile name
 * re-saved with another client ID or base URL is a different credential.
 */
export function credentialScope(c: {
  profileName: string;
  clientId: string;
  apiBaseUrl: string;
}): string {
  return [c.profileName, c.clientId.trim(), c.apiBaseUrl.trim().replace(/\/+$/, "")].join("|");
}
