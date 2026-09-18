import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { EndpointId, RequestResult } from "@/types/request";

// ─── Default request bodies ──────────────────────────────────────────────────

/**
 * Canonical default body for each endpoint.
 *
 * Token:   client_id may be overridden in the UI; the secret is injected by Rust.
 * Rewrite: analysis_id is auto-populated from the last /v1/analyze response.
 */
export const DEFAULT_BODIES: Record<EndpointId, string> = {
  Token: JSON.stringify({ client_id: "" }, null, 2),
  Refresh: JSON.stringify({ refresh_token: "" }, null, 2),
  Revoke: JSON.stringify({ token: "" }, null, 2),
  Analyze: JSON.stringify({ content: "Test message.", language: "en" }, null, 2),
  Rewrite: JSON.stringify({ content: "Test message.", language: "en", analysis_id: "" }, null, 2),
};

// ─── Store types ─────────────────────────────────────────────────────────────

type RequestState = {
  /** Currently selected endpoint. */
  selectedEndpoint: EndpointId;

  /** Per-endpoint body text. Persisted so the editor survives navigation. */
  bodies: Record<EndpointId, string>;

  /** Response from the most recent send. */
  lastResponse: RequestResult | null;

  /**
   * `analysis_id` captured from the last successful /v1/analyze response.
   * Drives the pre-fill of the Rewrite body's `analysis_id` field.
   */
  lastAnalysisId: string | null;

  /**
   * Token pair captured from the last successful /v1/token or /v1/token/refresh
   * response. Used to pre-fill the `refresh_token` field on the Refresh form
   * and the `token` field on the Revoke form — matching the frontend console.
   */
  lastTokenPair: { access_token: string; refresh_token: string } | null;

  /** Request timeout in milliseconds. Sent as `timeoutMs` to Rust. */
  timeoutMs: number;

  /** Whether a request is in-flight. */
  isLoading: boolean;

  /** Human-readable error from the last failed request. */
  error: string | null;
};

type RequestActions = {
  setEndpoint: (endpoint: EndpointId) => void;
  setBody: (endpoint: EndpointId, body: string) => void;
  setResponse: (result: RequestResult) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setTimeoutMs: (ms: number) => void;
  /** Reset the body for a given endpoint back to its default. */
  resetBody: (endpoint: EndpointId) => void;
  /** Clear the response panel. */
  clearResponse: () => void;
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useRequestStore = create<RequestState & RequestActions>()(
  persist(
    (set, get) => ({
      // ─ State ─
      selectedEndpoint: "Token",
      bodies: { ...DEFAULT_BODIES },
      lastResponse: null,
      lastAnalysisId: null,
      lastTokenPair: null,
      timeoutMs: 30_000,
      isLoading: false,
      error: null,

      // ─ Actions ─
      setEndpoint: (endpoint) => set({ selectedEndpoint: endpoint }),

      setBody: (endpoint, body) =>
        set((state) => ({ bodies: { ...state.bodies, [endpoint]: body } })),

      setResponse: (result) => {
        let lastAnalysisId = get().lastAnalysisId;
        let lastTokenPair = get().lastTokenPair;

        if (result.isJson && result.status >= 200 && result.status < 300) {
          try {
            const parsed = JSON.parse(result.body) as Record<string, unknown>;

            // Capture token pair (from /v1/token or /v1/token/refresh).
            if (
              typeof parsed.access_token === "string" &&
              typeof parsed.refresh_token === "string"
            ) {
              lastTokenPair = {
                access_token: parsed.access_token as string,
                refresh_token: parsed.refresh_token as string,
              };
            }

            // Capture analysis_id (from /v1/analyze).
            if (typeof parsed.analysis_id === "string") {
              lastAnalysisId = parsed.analysis_id as string;
            }
          } catch {
            // Non-JSON body — nothing to capture.
          }
        }

        // A successful revoke means the held pair is now dead.
        if (result.status === 204 && result.url.includes("/v1/token/revoke")) {
          lastTokenPair = null;
        }

        set({ lastResponse: result, lastAnalysisId, lastTokenPair, error: null });
      },

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      setTimeoutMs: (timeoutMs) => set({ timeoutMs }),

      resetBody: (endpoint) =>
        set((state) => ({
          bodies: { ...state.bodies, [endpoint]: DEFAULT_BODIES[endpoint] },
        })),

      clearResponse: () => set({ lastResponse: null, error: null }),
    }),
    {
      name: "confinaid-test-tool-requests",
      // Persist only the useful cross-session state.
      partialize: (state) => ({
        selectedEndpoint: state.selectedEndpoint,
        lastAnalysisId: state.lastAnalysisId,
        lastTokenPair: state.lastTokenPair,
        timeoutMs: state.timeoutMs,
      }),
    }
  )
);
