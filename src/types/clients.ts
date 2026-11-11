/**
 * Client management types.
 *
 * Mirrors the `/v1/clients*` schemas in the Partner API OpenAPI document
 * (confinaid-api-service `api/openapi.yaml`). A client is one of the
 * company's own end customers: analyses can be attributed to it with
 * `client_id` on `/v1/analyze` and `/v1/rewrite`, and it may carry its own
 * filtering profile. Kept in sync manually — the API is the source of truth.
 */

export type Client = {
  id: string;
  name: string;
  description: string;
  /** The partner's own reference for this client; "" when unset. */
  external_id: string;
  /** Short-lived signed URL, or null. Logos are uploaded from the dashboard. */
  logo_url: string | null;
  /**
   * Null means the client has no profile of its own: its analyses fall back
   * to the credential's profile, then the company primary.
   */
  filtering_profile_id: string | null;
  /** "" when `filtering_profile_id` is null. */
  filtering_profile_title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Writable fields of POST / PATCH `/v1/clients`. */
export type ClientWrite = {
  name?: string;
  description?: string;
  external_id?: string;
  filtering_profile_id?: string | null;
  is_active?: boolean;
};

export type ClientCreate = ClientWrite & { name: string };

/** Fields the API documents as orderable on `GET /v1/clients`. */
export type ClientOrdering =
  "name" | "-name" | "created_at" | "-created_at" | "updated_at" | "-updated_at";
