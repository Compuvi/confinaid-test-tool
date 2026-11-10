import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../query-client";
import { useFilteringScope } from "./use-filtering";

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
