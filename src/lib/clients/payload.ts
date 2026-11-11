/**
 * Client form draft -> request bodies.
 *
 * Same approach as `@/lib/filtering/payload`: the draft holds every field as
 * the form edits it, the builder normalises it into the wire shape (trimmed
 * strings, no own profile as `null`), and an edit is a PATCH of only the
 * fields whose built value changed.
 */

import { diffPatch, isUuid } from "@/lib/filtering/payload";
import type { Client, ClientCreate, ClientWrite } from "@/types/clients";

/** Largest values the API accepts (see the client resource in the OpenAPI). */
export const CLIENT_LIMITS = { name: 255, description: 2000, externalId: 128 } as const;

/** Fields the client form shows errors for inline (not repeated in the toast). */
export const CLIENT_INLINE_FIELDS = [
  "name",
  "description",
  "external_id",
  "filtering_profile_id",
  "is_active",
] as const;

export type ClientDraft = {
  name: string;
  description: string;
  external_id: string;
  /** "" means no own profile. */
  filtering_profile_id: string;
  is_active: boolean;
};

export function emptyClientDraft(): ClientDraft {
  return { name: "", description: "", external_id: "", filtering_profile_id: "", is_active: true };
}

export function clientToDraft(c: Client): ClientDraft {
  return {
    name: c.name,
    description: c.description ?? "",
    external_id: c.external_id ?? "",
    filtering_profile_id: c.filtering_profile_id ?? "",
    is_active: c.is_active,
  };
}

function normalise(d: ClientDraft): Required<ClientWrite> {
  const profile = d.filtering_profile_id.trim();
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    external_id: d.external_id.trim(),
    filtering_profile_id: profile === "" ? null : profile.toLowerCase(),
    is_active: d.is_active,
  };
}

/**
 * POST body. Optional fields left blank are omitted rather than sent empty,
 * so the request shows exactly what the user chose.
 */
export function buildClientCreate(d: ClientDraft): ClientCreate {
  const n = normalise(d);
  return {
    name: n.name,
    ...(n.description ? { description: n.description } : {}),
    ...(n.external_id ? { external_id: n.external_id } : {}),
    ...(n.filtering_profile_id ? { filtering_profile_id: n.filtering_profile_id } : {}),
    is_active: n.is_active,
  };
}

/** PATCH body: only the fields whose normalised value changed. */
export function buildClientPatch(original: ClientDraft, draft: ClientDraft): ClientWrite {
  return diffPatch(normalise(original), normalise(draft));
}

/**
 * Checks the API would make anyway, run locally for an immediate inline
 * message: `name` is required, a profile id must be a UUID, lengths are
 * capped. Messages come from `messages` so they can be translated.
 */
export function validateClientDraft(
  d: ClientDraft,
  messages: { required: string; uuid: string; tooLong: (max: number) => string }
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const n = normalise(d);
  if (!n.name) errors.name = [messages.required];
  else if (n.name.length > CLIENT_LIMITS.name) errors.name = [messages.tooLong(CLIENT_LIMITS.name)];
  if (n.description.length > CLIENT_LIMITS.description) {
    errors.description = [messages.tooLong(CLIENT_LIMITS.description)];
  }
  if (n.external_id.length > CLIENT_LIMITS.externalId) {
    errors.external_id = [messages.tooLong(CLIENT_LIMITS.externalId)];
  }
  if (n.filtering_profile_id && !isUuid(n.filtering_profile_id)) {
    errors.filtering_profile_id = [messages.uuid];
  }
  return errors;
}
