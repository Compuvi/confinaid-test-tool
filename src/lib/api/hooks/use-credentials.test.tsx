import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRequestStore } from "@/stores/request-store";

import { createQueryClient, queryKeys } from "../query-client";
import {
  useClearCredentials,
  useDeleteProfile,
  useSaveCredentials,
  useSwitchProfile,
} from "./use-credentials";

const invokeMock = vi.mocked(invoke);

const stored = {
  profileName: "b",
  apiBaseUrl: "https://api.example.com",
  clientId: "client-b",
  hasSecret: true,
  secretHint: "1234",
};

function setup() {
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.token.status(), { accessHint: "old" });
  queryClient.setQueryData(queryKeys.filtering.profileList("a|client-a|u", { page: 1 }), {
    count: 1,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("credential hooks drop the previous credential's state", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(stored);
    useRequestStore.setState({
      lastTokenPair: { access_token: "a-access", refresh_token: "a-refresh" },
    });
  });

  const input = { profileName: "b", apiBaseUrl: "x", clientId: "c", apiSecretKey: "" };
  const cases: [string, () => () => Promise<unknown>][] = [
    [
      "switch",
      () => {
        const m = useSwitchProfile();
        return () => m.mutateAsync("b");
      },
    ],
    [
      "save",
      () => {
        const m = useSaveCredentials();
        return () => m.mutateAsync(input);
      },
    ],
    [
      "delete",
      () => {
        const m = useDeleteProfile();
        return () => m.mutateAsync("a");
      },
    ],
    [
      "clear",
      () => {
        const m = useClearCredentials();
        return () => m.mutateAsync();
      },
    ],
  ];

  for (const [name, useHook] of cases) {
    it(`on ${name}`, async () => {
      const { queryClient, wrapper } = setup();
      const { result } = renderHook(useHook, { wrapper });
      await act(async () => {
        await result.current();
      });
      expect(useRequestStore.getState().lastTokenPair).toBeNull();
      expect(queryClient.getQueryState(queryKeys.token.status())?.isInvalidated).toBe(true);
      expect(queryClient.getQueryCache().findAll({ queryKey: queryKeys.filtering.all })).toEqual(
        []
      );
    });
  }
});
