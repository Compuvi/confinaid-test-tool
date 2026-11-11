import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/api/query-client";
import type { Client } from "@/types/clients";
import type { FilteringRequestParams } from "@/types/filtering";

import { ClientsPage } from "./clients";

const invokeMock = vi.mocked(invoke);
const C1 = "6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const C2 = "7a2d3b2f-4c5e-4f60-9b0c-1d2e3f4a5b6c";
const PROFILE = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const client = (id: string, name: string, extra: Partial<Client> = {}): Client => ({
  id,
  name,
  description: "",
  external_id: "",
  logo_url: null,
  filtering_profile_id: null,
  filtering_profile_title: "",
  is_active: true,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  ...extra,
});

const page = (results: unknown[]) => ({ count: results.length, page: 1, page_size: 25, results });

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

let forbidden = false;
let profilesForbidden = false;
/** What the server holds now — the list may show older data. */
let acmeOnServer: Client;

function clientsRoute({ method, path, body }: FilteringRequestParams) {
  if (forbidden) return respond(403, { error: { code: "forbidden", message: "Not covered." } });
  if (method === "GET" && path === "/v1/clients") {
    return respond(
      200,
      page([
        client(C1, "Acme", { external_id: "crm-1" }),
        client(C2, "Globex", {
          filtering_profile_id: PROFILE,
          filtering_profile_title: "Finance",
        }),
      ])
    );
  }
  if (method === "GET" && path === `/v1/clients/${C1}`) return respond(200, acmeOnServer);
  if (method === "POST" && path === "/v1/clients") {
    if ((body as { external_id?: string }).external_id === "crm-1") {
      return respond(409, {
        error: {
          code: "conflict",
          message: "The request conflicts with an existing resource.",
          details: { external_id: ["Another client already uses this external id."] },
        },
      });
    }
    return respond(201, client("new", (body as { name: string }).name));
  }
  if (method === "PATCH" && path === `/v1/clients/${C1}`) {
    return respond(200, { ...acmeOnServer, ...(body as object) });
  }
  if (method === "DELETE") return respond(204, undefined);
  return respond(404, { error: { code: "not_found", message: "Not found." } });
}

function filteringRoute({ method, path }: FilteringRequestParams) {
  if (profilesForbidden) {
    return respond(403, { error: { code: "forbidden", message: "Not covered." } });
  }
  if (method === "GET" && path === "/v1/filtering-profiles") {
    return respond(
      200,
      page([
        {
          id: PROFILE,
          title: "Finance",
          is_primary: false,
          region: null,
          general_threshold: 60,
        },
      ])
    );
  }
  return respond(200, page([]));
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const calls = (cmd: string, method?: string) =>
  invokeMock.mock.calls
    .filter(([c]) => c === cmd)
    .map(([, a]) => (a as { params: FilteringRequestParams }).params)
    .filter((p) => !method || p.method === method);

describe("ClientsPage", () => {
  beforeEach(() => {
    forbidden = false;
    profilesForbidden = false;
    acmeOnServer = client(C1, "Acme", { external_id: "crm-1", description: "Retail" });
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "load_credentials") {
        return { profileName: "default", apiBaseUrl: "x", clientId: "c", hasSecret: true };
      }
      if (cmd === "get_token_status") {
        return { accessHint: "x", expiresIn: 0, scope: "analyze", isActive: true };
      }
      const params = (args as { params: FilteringRequestParams })?.params;
      if (cmd === "clients_request") return clientsRoute(params);
      if (cmd === "filtering_request") return filteringRoute(params);
      return null;
    });
  });

  it("lists clients with their external id and profile", async () => {
    renderPage();
    const acme = (await screen.findByText("Acme")).closest("tr")!;
    expect(within(acme).getByText("crm-1")).toBeInTheDocument();
    expect(within(acme).getByText("Credential's profile")).toBeInTheDocument();
    const globex = screen.getByText("Globex").closest("tr")!;
    expect(within(globex).getByText("Finance")).toBeInTheDocument();
    expect(calls("clients_request", "GET")[0]).toMatchObject({
      path: "/v1/clients",
      query: [
        ["page", "1"],
        ["page_size", "25"],
        ["ordering", "name"],
      ],
    });
  });

  it("creates a client and shows a 409 conflict inline", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "New client" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(calls("clients_request", "POST")).toHaveLength(0);

    await user.type(within(dialog).getByLabelText("Name"), "Initech");
    await user.type(within(dialog).getByLabelText("External ID"), "crm-1");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await within(dialog).findByText("Another client already uses this external id.")
    ).toBeInTheDocument();
    expect(calls("clients_request", "POST")[0].body).toEqual({
      name: "Initech",
      external_id: "crm-1",
      is_active: true,
    });

    await user.clear(within(dialog).getByLabelText("External ID"));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls("clients_request", "POST")[1].body).toEqual({ name: "Initech", is_active: true });
  });

  it("edits from a fresh read and sends only what changed", async () => {
    acmeOnServer = client(C1, "Acme Corp", { external_id: "crm-1", description: "Retail" });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Acme")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    // The form starts from the server's copy, not the stale row.
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Acme Corp");
    expect(calls("clients_request", "GET").some((p) => p.path === `/v1/clients/${C1}`)).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls("clients_request", "PATCH")).toHaveLength(0);

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const again = await screen.findByRole("dialog");
    const description = within(again).getByLabelText("Description");
    await user.clear(description);
    await user.type(description, "Wholesale");
    await user.click(within(again).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("clients_request", "PATCH")).toHaveLength(1));
    expect(calls("clients_request", "PATCH")[0]).toMatchObject({
      path: `/v1/clients/${C1}`,
      body: { description: "Wholesale" },
    });
  });

  it("falls back to a profile id field when profiles cannot be listed", async () => {
    profilesForbidden = true;
    acmeOnServer = client(C1, "Acme", {
      filtering_profile_id: PROFILE,
      filtering_profile_title: "Finance",
    });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Acme")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");

    const field = await within(dialog).findByLabelText("Filtering profile");
    expect(field).toHaveValue(PROFILE);
    expect(within(dialog).getByText(/no filtering_read scope/)).toBeInTheDocument();
    expect(within(dialog).getByText("Current profile: Finance")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Clear" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("clients_request", "PATCH")).toHaveLength(1));
    expect(calls("clients_request", "PATCH")[0].body).toEqual({ filtering_profile_id: null });
  });

  it("deletes a client after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Globex")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/keep their attribution/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls("clients_request", "DELETE")).toHaveLength(1));
    expect(calls("clients_request", "DELETE")[0].path).toBe(`/v1/clients/${C2}`);
  });

  it("explains the clients scopes on 403 forbidden", async () => {
    forbidden = true;
    renderPage();
    expect(await screen.findByText("This credential cannot manage clients")).toBeInTheDocument();
    expect(screen.getByText(/clients_read scope to list clients/)).toBeInTheDocument();
    expect(await screen.findByText("analyze")).toBeInTheDocument();
  });

  it("asks for a credential when none is stored", async () => {
    invokeMock.mockImplementation(async () => null);
    renderPage();
    expect(await screen.findByText("No credential configured")).toBeInTheDocument();
    expect(screen.getByText(/clients_read and clients_write/)).toBeInTheDocument();
  });
});
