import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { NAV_ITEMS } from "@/config/navigation";
import { useUiStore } from "@/stores/ui-store";

import { AppSidebar } from "./app-sidebar";

function renderSidebar(initialPath = "/connection") {
  const router = createMemoryRouter([{ path: "*", element: <AppSidebar /> }], {
    initialEntries: [initialPath],
  });
  return render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}

describe("AppSidebar", () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarCollapsed: false });
  });

  it("renders every navigation item from the shared config", () => {
    renderSidebar();
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.to);
    }
  });

  it("marks the current route as active", () => {
    renderSidebar("/reports");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("hides labels when collapsed but keeps the links reachable", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByText("Test Tool")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByText("Test Tool")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
  });

  it("shows the app version only when expanded", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByText("vtest")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByText("vtest")).not.toBeInTheDocument();
  });
});
