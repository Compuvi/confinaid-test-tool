import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { useRequestStore } from "./request-store";
import { currentCredentialEpoch, forgetCredentialState } from "@/lib/api/hooks/use-credentials";
import type { RequestResult } from "@/types/request";

function tokenResult(refresh: string): RequestResult {
  return {
    status: 200,
    statusText: "OK",
    durationMs: 1,
    sizeBytes: 1,
    body: JSON.stringify({ access_token: "cat_a", refresh_token: refresh }),
    isJson: true,
    headers: [],
    url: "https://api.example.com/v1/token",
    tokenHint: null,
  };
}

describe("request store token pair capture", () => {
  beforeEach(() => {
    useRequestStore.getState().clearTokenPair();
    useRequestStore.getState().clearResponse();
  });

  it("captures the token pair by default", () => {
    useRequestStore.getState().setResponse(tokenResult("crt_a"));
    expect(useRequestStore.getState().lastTokenPair?.refresh_token).toBe("crt_a");
  });

  it("shows the response but skips the pair when it answered for a previous credential", () => {
    useRequestStore.getState().setResponse(tokenResult("crt_a"), { fromCurrentCredential: false });
    expect(useRequestStore.getState().lastTokenPair).toBeNull();
    expect(useRequestStore.getState().lastResponse?.status).toBe(200);
  });

  it("bumps the credential epoch and drops the pair on a credential change", () => {
    useRequestStore.getState().setResponse(tokenResult("crt_a"));
    const before = currentCredentialEpoch();
    forgetCredentialState(new QueryClient());
    expect(currentCredentialEpoch()).toBe(before + 1);
    expect(useRequestStore.getState().lastTokenPair).toBeNull();
  });
});
