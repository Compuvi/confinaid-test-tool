import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/api/query-client";
import type { FilteringRequestParams } from "@/types/filtering";

import { FilteringPage } from "./filtering";

const invokeMock = vi.mocked(invoke);
const P1 = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const P2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REGION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const profile = (id: string, title: string, primary: boolean) => ({
  id,
  title,
  description: null,
  is_primary: primary,
  general_threshold: 60,
  ai_model_id: null,
  keyword_filtering_enabled: true,
  codename_filtering_enabled: true,
  label_filtering_enabled: true,
  rewrite_enabled: true,
  hitl_enabled: true,
  deep_scan_enabled: false,
  context: "",
  region: { id: REGION, name: "EU" },
  attachment_ids: [],
  language_ids: [],
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
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
let financePrimary = false;

function route(params: FilteringRequestParams) {
  if (forbidden) {
    return respond(403, { error: { code: "forbidden", message: "Not covered." } });
  }
  const { method, path } = params;
  if (method === "GET" && path === "/v1/filtering-profiles") {
    return respond(
      200,
      page([profile(P1, "Primary profile", true), profile(P2, "Finance", false)])
    );
  }
  if (method === "GET" && path === `/v1/filtering-profiles/${P1}`) {
    return respond(200, profile(P1, "Primary profile", true));
  }
  if (method === "GET" && path === `/v1/filtering-profiles/${P2}`) {
    return respond(200, profile(P2, "Finance", financePrimary));
  }
  if (method === "GET" && path.endsWith("/logs")) {
    return respond(
      200,
      page([
        {
          id: "l1",
          action: "updated",
          entity: "profile",
          target_repr: "Primary profile",
          changes: [{ field: "general_threshold", old: 50, new: 60 }],
          actor_type: "api_credential",
          actor_name: "ci-bot",
          created_at: "2026-11-02T10:00:00Z",
        },
      ])
    );
  }
  if (method === "POST" && path.endsWith("/keywords")) {
    return respond(409, {
      error: {
        code: "conflict",
        message: "The request conflicts with an existing resource.",
        details: { name: ["A keyword with this name already exists."] },
      },
    });
  }
  if (method === "POST" && path.endsWith("/bypass-rules")) {
    return respond(422, {
      error: {
        code: "validation_failed",
        message: "The request failed validation.",
        details: {
          "conditions[0].condition_type": ["Not allowed here."],
          non_field_errors: ["This target already has a rule."],
        },
      },
    });
  }
  if (method === "POST" && path.endsWith("/set-primary")) {
    financePrimary = true;
    return respond(200, profile(P2, "Finance", true));
  }
  if (method === "GET") return respond(200, page([]));
  return respond(200, {});
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <FilteringPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("FilteringPage", () => {
  beforeEach(() => {
    forbidden = false;
    financePrimary = false;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "load_credentials") {
        return { profileName: "default", apiBaseUrl: "x", clientId: "c", hasSecret: true };
      }
      if (cmd === "get_token_status")
        return { accessHint: "x", expiresIn: 0, scope: "analyze", isActive: true };
      if (cmd === "filtering_request") {
        return route((args as { params: FilteringRequestParams }).params);
      }
      return null;
    });
  });

  it("lists profiles and opens one with its tabs", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Finance/ }));
    expect(await screen.findByRole("button", { name: "Make primary" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Primary profile/ }));

    expect(await screen.findByRole("heading", { name: "Primary profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    // The primary profile offers no "Make primary" action.
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    const row = (await screen.findByText("ci-bot")).closest("tr")!;
    expect(within(row).getByText("API credential")).toBeInTheDocument();
    expect(within(row).getByText("general_threshold")).toBeInTheDocument();

    for (const name of ["Keywords", "Keyword groups", "Codenames", "Labels", "Bypass rules"]) {
      await user.click(screen.getByRole("tab", { name }));
      expect(await screen.findByText("No entries yet.")).toBeInTheDocument();
    }
  });

  it("explains a primary profile cannot be deleted", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Primary profile/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/is the primary profile and cannot be deleted/)
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("shows the scope hint on 403 forbidden", async () => {
    forbidden = true;
    renderPage();
    expect(
      await screen.findByText("This credential cannot manage filtering profiles")
    ).toBeInTheDocument();
    expect(await screen.findByText("analyze")).toBeInTheDocument();
  });

  it("asks for a credential when none is stored", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_credentials" ? null : null
    );
    renderPage();
    expect(await screen.findByText("No credential configured")).toBeInTheDocument();
  });

  it("shows API field errors inline, including nested condition errors", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Primary profile/ }));

    await user.click(await screen.findByRole("tab", { name: "Keywords" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "iban");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await within(dialog).findByText("A keyword with this name already exists.")
    ).toBeInTheDocument();
    const sent = invokeMock.mock.calls.find(
      ([cmd, a]) =>
        cmd === "filtering_request" &&
        (a as { params: FilteringRequestParams }).params.method === "POST"
    );
    expect((sent?.[1] as { params: FilteringRequestParams }).params.body).toMatchObject({
      name: "iban",
      match_type: "exact",
      regex_pattern: null,
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("tab", { name: "Bypass rules" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Legal");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Not allowed here.")).toBeInTheDocument();
    expect(within(dialog).getByText("This target already has a rule.")).toBeInTheDocument();
  });

  it("keeps unsaved general edits when the profile is refetched", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Finance/ }));
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Finance edited");

    await user.click(screen.getByRole("button", { name: "Make primary" }));
    // set-primary refetches the detail (the button goes away once it shows
    // the profile as primary); the edit must survive it.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument()
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Finance edited");
    expect(screen.getByText("Unsaved changes: 1")).toBeInTheDocument();
  });

  it("offers a fresh token from the scope hint", async () => {
    forbidden = true;
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Get a fresh token" }));
    expect(invokeMock).toHaveBeenCalledWith("clear_token_cache", undefined);
  });
});
