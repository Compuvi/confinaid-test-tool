/**
 * Mirrors the Rust types in `src-tauri/src/http/endpoints.rs`.
 *
 * Kept in sync manually — the IPC boundary is the source of truth.
 */

/** Which Partner API endpoint to call. */
export type EndpointId = "Token" | "Refresh" | "Revoke" | "Analyze" | "Rewrite";

/** Parameters the frontend passes to `send_request`. */
export type SendRequestParams = {
  endpoint: EndpointId;
  /** JSON body exactly as the user composed it. */
  body: Record<string, unknown>;
  /** Override the config's default timeout in milliseconds. */
  timeoutMs?: number;
};

/** Minimal token info surfaced after a successful `/v1/token` or `/v1/token/refresh` call. */
export type TokenHint = {
  /** Last 8 chars of the access token — enough to identify it, not enough to use it. */
  accessHint: string;
  /** Lifetime reported by the server, in seconds. */
  expiresIn: number;
  /** Space-separated granted scopes. */
  scope: string;
  /** Always true when a TokenHint is present — token is live in the Rust cache. */
  isActive: boolean;
};

/** Full response descriptor returned for every request. */
export type RequestResult = {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  /** Pretty-printed JSON body or raw text. */
  body: string;
  isJson: boolean;
  /** Response headers as [name, value] pairs. */
  headers: [string, string][];
  url: string;
  /**
   * Populated when the call minted or refreshed a token.
   * `null` / `undefined` for all other endpoints.
   */
  tokenHint?: TokenHint | null;
};
