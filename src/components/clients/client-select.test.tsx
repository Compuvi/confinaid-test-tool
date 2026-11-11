import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/api/query-client";

import { ClientSelect } from "./client-select";

const invokeMock = vi.mocked(invoke);
const PICKED = "11111111-2222-4333-8444-555555555555";

function respond(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    status,
    statusText: "",
    durationMs: 1,
    sizeBytes: text.length,
    body: text,
    isJson: true,
    headers: [],
    url: "u",
  };
}

function renderSelect(value: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ClientSelect value={value} onChange={() => {}} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("ClientSelect", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_credentials") {
        return { profileName: "default", apiBaseUrl: "x", clientId: "c", hasSecret: true };
      }
      if (cmd === "get_token_status")
        return { accessHint: "x", expiresIn: 0, scope: "analyze", isActive: true };
      // The credential has no clients_read: listing clients is refused.
      if (cmd === "clients_request") {
        return respond(403, { error: { code: "forbidden", message: "Not covered." } });
      }
      return null;
    });
  });

  it("keeps a picked client visible and clearable when clients cannot be listed", async () => {
    renderSelect(PICKED);
    const trigger = screen.getByRole("combobox");
    // Before the fix it read "No client" and was disabled while the request
    // still carried the id.
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent(PICKED);
  });

  it("is disabled when clients cannot be listed and none is picked", async () => {
    renderSelect("");
    const trigger = screen.getByRole("combobox");
    await waitFor(() => expect(trigger).toHaveTextContent("No client"));
    await waitFor(() => expect(trigger).toBeDisabled());
  });
});
