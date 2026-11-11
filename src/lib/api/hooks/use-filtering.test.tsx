import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../query-client";
import { useFetchCollectionItem, useFilteringScope } from "./use-filtering";

const invokeMock = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

describe("useFilteringScope", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("is the credential identity, not just the profile name", async () => {
    invokeMock.mockResolvedValue({
      profileName: "prod",
      clientId: "client-a",
      apiBaseUrl: "https://api.example.com/",
      hasSecret: true,
    });
    const { result } = renderHook(useFilteringScope, { wrapper });
    await waitFor(() => expect(result.current).toBe("prod|client-a|https://api.example.com"));
  });

  it("is null without a stored secret", async () => {
    invokeMock.mockResolvedValue({
      profileName: "prod",
      clientId: "c",
      apiBaseUrl: "u",
      hasSecret: false,
    });
    const { result } = renderHook(useFilteringScope, { wrapper });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("load_credentials", undefined));
    expect(result.current).toBeNull();
  });
});

describe("useFetchCollectionItem", () => {
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

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("reads the entry from its own item endpoint, fresh on every open", async () => {
    let name = "Atlas";
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_credentials") return CREDENTIALS;
      if (cmd === "filtering_request") return respond(200, { id: "k1", name });
      return null;
    });
    const { result } = renderHook(() => useFetchCollectionItem("p1", "keywords"), { wrapper });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("load_credentials", undefined));

    await expect(result.current("k1")).resolves.toEqual({ id: "k1", name: "Atlas" });
    expect(invokeMock).toHaveBeenCalledWith("filtering_request", {
      params: { method: "GET", path: "/v1/filtering-profiles/p1/keywords/k1" },
    });

    // Changed elsewhere since the first open: the second open must see it.
    name = "Atlas v2";
    await expect(result.current("k1")).resolves.toEqual({ id: "k1", name: "Atlas v2" });
  });

  it("rejects when the entry is gone", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_credentials") return CREDENTIALS;
      if (cmd === "filtering_request")
        return respond(404, {
          error: { code: "not_found", message: "The referenced resource was not found." },
        });
      return null;
    });
    const { result } = renderHook(() => useFetchCollectionItem("p1", "codenames"), { wrapper });

    await expect(result.current("gone")).rejects.toMatchObject({ status: 404 });
  });
});
