import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRequestStore } from "@/stores/request-store";
import type { RequestResult } from "@/types/request";

import { createQueryClient } from "../query-client";
import { forgetCredentialState } from "./use-credentials";
import { useSendRequest } from "./use-request";

const invokeMock = vi.mocked(invoke);

const tokenResult: RequestResult = {
  status: 200,
  statusText: "OK",
  durationMs: 1,
  sizeBytes: 1,
  body: JSON.stringify({ access_token: "cat_a", refresh_token: "crt_a" }),
  isJson: true,
  headers: [],
  url: "https://api.example.com/v1/token",
  tokenHint: null,
};

function setup() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useSendRequest across a credential change", () => {
  let resolveSend: (r: RequestResult) => void = () => {};

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "send_request"
        ? new Promise<RequestResult>((resolve) => {
            resolveSend = resolve;
          })
        : Promise.resolve(null)
    );
    useRequestStore.getState().clearCredentialData();
    useRequestStore.getState().clearResponse();
  });

  it("adopts the token pair when the credential did not change", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useSendRequest(), { wrapper });

    act(() => result.current.mutate({ endpoint: "Token", body: {} }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await act(async () => resolveSend(tokenResult));

    await waitFor(() => expect(useRequestStore.getState().lastResponse).not.toBeNull());
    expect(useRequestStore.getState().lastTokenPair?.refresh_token).toBe("crt_a");
  });

  it("shows but does not adopt a pair that answered for the previous credential", async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSendRequest(), { wrapper });

    act(() => result.current.mutate({ endpoint: "Token", body: {} }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    act(() => forgetCredentialState(queryClient));
    await act(async () => resolveSend(tokenResult));

    await waitFor(() => expect(useRequestStore.getState().lastResponse).not.toBeNull());
    expect(useRequestStore.getState().lastTokenPair).toBeNull();
  });
});
