import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitedError } from "@/lib/api/errors";
import { credentialScope, getQueryClient, queryKeys } from "@/lib/api/query-client";
import type { RequestResult } from "@/types/request";

import {
  buildQuery,
  clampPage,
  fetchAllPages,
  filteringCall,
  filteringPaths,
  pageRange,
  totalPages,
} from "./client";
import { FilteringApiError } from "./errors";

const invokeMock = vi.mocked(invoke);
const P = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const I = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function ok(status: number, body: unknown): RequestResult {
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

describe("filteringPaths", () => {
  it("builds every documented route", () => {
    expect(filteringPaths.profiles()).toBe("/v1/filtering-profiles");
    expect(filteringPaths.profile(P)).toBe(`/v1/filtering-profiles/${P}`);
    expect(filteringPaths.setPrimary(P)).toBe(`/v1/filtering-profiles/${P}/set-primary`);
    expect(filteringPaths.clone(P)).toBe(`/v1/filtering-profiles/${P}/clone`);
    expect(filteringPaths.collection(P, "logs")).toBe(`/v1/filtering-profiles/${P}/logs`);
    expect(filteringPaths.item(P, "label-settings", I)).toBe(
      `/v1/filtering-profiles/${P}/label-settings/${I}`
    );
    expect(filteringPaths.catalog("ai-models")).toBe("/v1/filtering/ai-models");
  });

  it("encodes ids so a hostile value cannot add segments", () => {
    expect(filteringPaths.profile("../token")).toBe("/v1/filtering-profiles/..%2Ftoken");
  });
});

describe("buildQuery", () => {
  it("drops empty values, stringifies scalars and repeats array keys", () => {
    expect(
      buildQuery({
        page: 2,
        page_size: 25,
        search: "",
        is_active: true,
        language: undefined,
        parent: null,
        labels: [P, I],
        ordering: "  ",
      })
    ).toEqual([
      ["page", "2"],
      ["page_size", "25"],
      ["is_active", "true"],
      ["labels", P],
      ["labels", I],
    ]);
    expect(buildQuery(undefined)).toEqual([]);
  });
});

describe("filteringCall", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends method, path, query and body through the filtering command", async () => {
    invokeMock.mockResolvedValue(ok(201, { id: P }));
    const res = await filteringCall<{ id: string }>("POST", filteringPaths.profiles(), {
      query: { search: "" },
      body: { title: "Finance" },
    });
    expect(res).toEqual({ id: P });
    expect(invokeMock).toHaveBeenCalledWith("filtering_request", {
      params: { method: "POST", path: "/v1/filtering-profiles", body: { title: "Finance" } },
    });
  });

  it("omits query and body when there are none", async () => {
    invokeMock.mockResolvedValue(ok(200, { count: 0, page: 1, page_size: 25, results: [] }));
    await filteringCall("GET", filteringPaths.profiles(), { query: { page: 1 } });
    expect(invokeMock).toHaveBeenCalledWith("filtering_request", {
      params: { method: "GET", path: "/v1/filtering-profiles", query: [["page", "1"]] },
    });
  });

  it("resolves null for 204", async () => {
    invokeMock.mockResolvedValue(ok(204, undefined));
    await expect(filteringCall("DELETE", filteringPaths.profile(P))).resolves.toBeNull();
  });

  it("rejects a 2xx body that is not JSON instead of returning it as T", async () => {
    invokeMock.mockResolvedValue({ ...ok(200, undefined), body: "<html>proxy</html>" });
    await expect(filteringCall("GET", filteringPaths.profiles())).rejects.toMatchObject({
      status: 200,
      apiCode: "invalid_response",
      message: "Unexpected non-JSON response (HTTP 200)",
    });
  });

  it("refreshes the token badge after every call", async () => {
    const qc = getQueryClient();
    qc.setQueryData(queryKeys.token.status(), { accessHint: "x" });
    invokeMock.mockResolvedValue(ok(204, undefined));
    await filteringCall("DELETE", filteringPaths.profile(P));
    expect(qc.getQueryState(queryKeys.token.status())?.isInvalidated).toBe(true);
  });

  it("rejects non-2xx with a FilteringApiError", async () => {
    invokeMock.mockResolvedValue(
      ok(409, { error: { code: "primary_profile_locked", message: "Locked" } })
    );
    const promise = filteringCall("DELETE", filteringPaths.profile(P));
    await expect(promise).rejects.toBeInstanceOf(FilteringApiError);
    await expect(promise).rejects.toMatchObject({
      status: 409,
      apiCode: "primary_profile_locked",
    });
  });

  it("propagates Rust-side rejections as TauriError", async () => {
    invokeMock.mockRejectedValue({ code: "RATE_LIMITED", message: "429", details: null });
    const err: unknown = await filteringCall("GET", filteringPaths.profiles()).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).code).toBe("RATE_LIMITED");
  });
});

describe("fetchAllPages", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("pages at 100 until count is reached", async () => {
    const items = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i + offset) }));
    invokeMock
      .mockResolvedValueOnce(
        ok(200, { count: 150, page: 1, page_size: 100, results: items(100, 0) })
      )
      .mockResolvedValueOnce(
        ok(200, { count: 150, page: 2, page_size: 100, results: items(50, 100) })
      );

    const all = await fetchAllPages<{ id: string }>(filteringPaths.catalog("labels"), {
      region: P,
    });
    expect(all.items).toHaveLength(150);
    expect(all.truncated).toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("filtering_request", {
      params: {
        method: "GET",
        path: "/v1/filtering/labels",
        query: [
          ["region", P],
          ["page", "2"],
          ["page_size", "100"],
        ],
      },
    });
  });

  it("stops at maxPages and on an empty page", async () => {
    invokeMock.mockResolvedValue(
      ok(200, { count: 10_000, page: 1, page_size: 100, results: [{ id: "x" }] })
    );
    const capped = await fetchAllPages(filteringPaths.catalog("languages"), {}, 3);
    expect(capped).toMatchObject({ count: 10_000, truncated: true });
    expect(capped.items).toHaveLength(3);
    expect(invokeMock).toHaveBeenCalledTimes(3);

    invokeMock.mockReset();
    invokeMock.mockResolvedValue(ok(200, { count: 5, page: 1, page_size: 100, results: [] }));
    await expect(fetchAllPages(filteringPaths.catalog("languages"))).resolves.toEqual({
      items: [],
      count: 5,
      truncated: true,
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("pagination helpers", () => {
  it("computes total pages with a floor of one", () => {
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(25, 25)).toBe(1);
    expect(totalPages(26, 25)).toBe(2);
    expect(totalPages(10, 0)).toBe(1);
  });

  it("computes the visible range", () => {
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
    expect(pageRange(1, 25, 10)).toEqual({ from: 1, to: 10 });
    expect(pageRange(2, 25, 60)).toEqual({ from: 26, to: 50 });
    expect(pageRange(3, 25, 60)).toEqual({ from: 51, to: 60 });
  });

  it("clamps page numbers", () => {
    expect(clampPage(0, 60, 25)).toBe(1);
    expect(clampPage(9, 60, 25)).toBe(3);
    expect(clampPage(Number.NaN, 60, 25)).toBe(1);
    expect(clampPage(2, 0, 25)).toBe(1);
  });
});

describe("credential scoping of filtering keys", () => {
  const base = { profileName: "prod", clientId: "client-a", apiBaseUrl: "https://api.example.com" };

  it("distinguishes the same profile name re-saved with another client or base URL", () => {
    const a = credentialScope(base);
    expect(credentialScope({ ...base, clientId: "client-b" })).not.toBe(a);
    expect(credentialScope({ ...base, apiBaseUrl: "https://beta.example.com" })).not.toBe(a);
    expect(credentialScope({ ...base, profileName: "other" })).not.toBe(a);
    expect(credentialScope({ ...base, apiBaseUrl: "https://api.example.com/" })).toBe(a);
  });

  it("nests every filtering key under its credential scope", () => {
    const cred = credentialScope(base);
    for (const key of [
      queryKeys.filtering.profileList(cred, { page: 1 }),
      queryKeys.filtering.profileDetail(cred, P),
      queryKeys.filtering.collectionPage(cred, P, "keywords", {}),
      queryKeys.filtering.catalog(cred, "labels"),
    ]) {
      expect(key.slice(0, 2)).toEqual(["filtering", cred]);
    }
  });

  it("keeps details under `profiles` so set-primary can skip collections and catalogs", () => {
    const cred = "c";
    const profiles = queryKeys.filtering.profiles(cred);
    const under = (k: readonly unknown[]) => profiles.every((p, i) => k[i] === p);
    expect(under(queryKeys.filtering.profileDetail(cred, P))).toBe(true);
    expect(under(queryKeys.filtering.profileList(cred, {}))).toBe(true);
    expect(under(queryKeys.filtering.collection(cred, P, "keywords"))).toBe(false);
    expect(under(queryKeys.filtering.catalog(cred, "labels"))).toBe(false);
  });
});
