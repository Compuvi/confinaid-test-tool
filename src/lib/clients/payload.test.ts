import { describe, expect, it } from "vitest";

import type { Client } from "@/types/clients";

import {
  buildClientCreate,
  buildClientPatch,
  clientToDraft,
  emptyClientDraft,
  validateClientDraft,
} from "./payload";

const PROFILE = "B0E4C1D2-0000-4000-8000-000000000001";

const client: Client = {
  id: "6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "Acme",
  description: "",
  external_id: "crm-1",
  logo_url: null,
  filtering_profile_id: PROFILE.toLowerCase(),
  filtering_profile_title: "Finance",
  is_active: true,
  created_at: "2026-11-11T09:00:00Z",
  updated_at: "2026-11-11T09:00:00Z",
};

const messages = {
  required: "required",
  uuid: "uuid",
  tooLong: (max: number) => `max ${max}`,
};

describe("buildClientCreate", () => {
  it("omits blank optional fields and trims the rest", () => {
    expect(buildClientCreate({ ...emptyClientDraft(), name: "  Acme  " })).toEqual({
      name: "Acme",
      is_active: true,
    });
  });

  it("sends a chosen profile lowercased", () => {
    expect(
      buildClientCreate({
        ...emptyClientDraft(),
        name: "Acme",
        description: " Retail ",
        external_id: " crm-1 ",
        filtering_profile_id: PROFILE,
        is_active: false,
      })
    ).toEqual({
      name: "Acme",
      description: "Retail",
      external_id: "crm-1",
      filtering_profile_id: PROFILE.toLowerCase(),
      is_active: false,
    });
  });
});

describe("buildClientPatch", () => {
  it("is empty when nothing changed after normalisation", () => {
    const original = clientToDraft(client);
    expect(buildClientPatch(original, { ...original, name: " Acme " })).toEqual({});
  });

  it("clears the profile with an explicit null", () => {
    const original = clientToDraft(client);
    expect(buildClientPatch(original, { ...original, filtering_profile_id: "" })).toEqual({
      filtering_profile_id: null,
    });
  });

  it("carries only the changed fields", () => {
    const original = clientToDraft(client);
    expect(buildClientPatch(original, { ...original, external_id: "", is_active: false })).toEqual({
      external_id: "",
      is_active: false,
    });
  });
});

describe("validateClientDraft", () => {
  it("requires a name and a UUID profile id", () => {
    expect(
      validateClientDraft(
        { ...emptyClientDraft(), name: "  ", filtering_profile_id: "cid_123" },
        messages
      )
    ).toEqual({ name: ["required"], filtering_profile_id: ["uuid"] });
  });

  it("caps the lengths the API caps", () => {
    const errors = validateClientDraft(
      {
        ...emptyClientDraft(),
        name: "x".repeat(256),
        description: "x".repeat(2001),
        external_id: "x".repeat(129),
      },
      messages
    );
    expect(errors).toEqual({
      name: ["max 255"],
      description: ["max 2000"],
      external_id: ["max 128"],
    });
  });

  it("accepts a valid draft", () => {
    expect(validateClientDraft(clientToDraft(client), messages)).toEqual({});
  });
});
