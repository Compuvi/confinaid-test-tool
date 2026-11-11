import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilteringApiError } from "@/lib/filtering/errors";

import { clientsCall, clientsPaths } from "./client";

const invokeMock = vi.mocked(invoke);
const ID = "6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

function respond(status: number, body: unknown) {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    statusText: "",
    durationMs: 1,
    sizeBytes: text.length,
    body: text,
    isJson: body !== undefined,
    headers: [],
    url: "u",
  };
}

describe("clientsPaths", () => {
  it("builds the two documented paths and encodes ids", () => {
    expect(clientsPaths.list()).toBe("/v1/clients");
    expect(clientsPaths.item(ID)).toBe(`/v1/clients/${ID}`);
    expect(clientsPaths.item("../token")).toBe("/v1/clients/..%2Ftoken");
  });
});

describe("clientsCall", () => {
  beforeEach(() => invokeMock.mockReset());

  it("goes through clients_request with query pairs and parses the body", async () => {
    invokeMock.mockResolvedValue(respond(200, { count: 0, page: 1, page_size: 25, results: [] }));
    const data = await clientsCall("GET", clientsPaths.list(), {
      query: { page: 1, search: "", is_active: "true" },
    });
    expect(data).toEqual({ count: 0, page: 1, page_size: 25, results: [] });
    expect(invokeMock).toHaveBeenCalledWith("clients_request", {
      params: {
        method: "GET",
        path: "/v1/clients",
        query: [
          ["page", "1"],
          ["is_active", "true"],
        ],
      },
    });
  });

  it("resolves null for a 204 delete", async () => {
    invokeMock.mockResolvedValue(respond(204, undefined));
    await expect(clientsCall("DELETE", clientsPaths.item(ID))).resolves.toBeNull();
  });

  it("throws the API error with its field details", async () => {
    invokeMock.mockResolvedValue(
      respond(409, {
        error: {
          code: "conflict",
          message: "The request conflicts with an existing resource.",
          request_id: "req-1",
          details: { external_id: ["Already used by another client."] },
        },
      })
    );
    const err = await clientsCall("POST", clientsPaths.list(), { body: { name: "A" } }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(FilteringApiError);
    expect(err).toMatchObject({
      status: 409,
      apiCode: "conflict",
      requestId: "req-1",
      fieldErrors: { external_id: ["Already used by another client."] },
    });
  });
});
