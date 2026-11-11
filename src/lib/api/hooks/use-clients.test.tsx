import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../query-client";
import { clientListQuery, useAllActiveClients, useFetchClient } from "./use-clients";

const invokeMock = vi.mocked(invoke);

const CREDENTIALS = {
  profileName: "prod",
  clientId: "client-a",
  apiBaseUrl: "https://api.example.com",
  hasSecret: true,
};

function respond(status: number, body: unknown) {
  return {
    status,
    statusText: "",
    durationMs: 1,
    sizeBytes: 0,
    body: JSON.stringify(body),
    isJson: true,
    headers: [],
    url: "",
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

type Call = { params: { method: string; path: string; query?: [string, string][] } };

describe("clientListQuery", () => {
  it("maps the page params onto the documented query keys", () => {
    expect(
      clientListQuery({ page: 2, pageSize: 25, search: "acme", isActive: false, ordering: "name" })
    ).toEqual({ page: 2, page_size: 25, search: "acme", is_active: "false", ordering: "name" });
    expect(clientListQuery({ page: 1, pageSize: 10 }).is_active).toBeUndefined();
  });
});

describe("useFetchClient", () => {
  beforeEach(() => invokeMock.mockReset());

  it("reads the client fresh on every open", async () => {
    let name = "Acme";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_credentials") return CREDENTIALS;
      if (cmd === "clients_request") return respond(200, { id: "c1", name });
      return null;
    });
    const { result } = renderHook(useFetchClient, { wrapper });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("load_credentials", undefined));

    await expect(result.current("c1")).resolves.toEqual({ id: "c1", name: "Acme" });
    name = "Acme Corp";
    await expect(result.current("c1")).resolves.toEqual({ id: "c1", name: "Acme Corp" });
    const paths = invokeMock.mock.calls
      .filter(([cmd]) => cmd === "clients_request")
      .map(([, a]) => (a as Call).params.path);
    expect(paths).toEqual(["/v1/clients/c1", "/v1/clients/c1"]);
  });
});

describe("useAllActiveClients", () => {
  beforeEach(() => invokeMock.mockReset());

  it("pages through every active client", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "load_credentials") return CREDENTIALS;
      if (cmd === "clients_request") {
        const query = new Map((args as Call).params.query);
        const page = Number(query.get("page"));
        const results =
          page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) : [{ id: "b0" }];
        return respond(200, { count: 101, page, page_size: 100, results });
      }
      return null;
    });
    const { result } = renderHook(() => useAllActiveClients(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ count: 101, truncated: false });
    expect(result.current.data?.items).toHaveLength(101);
    const first = invokeMock.mock.calls.find(([cmd]) => cmd === "clients_request");
    expect((first?.[1] as Call).params.query).toEqual([
      ["page", "1"],
      ["page_size", "100"],
      ["is_active", "true"],
      ["ordering", "name"],
    ]);
  });
});
