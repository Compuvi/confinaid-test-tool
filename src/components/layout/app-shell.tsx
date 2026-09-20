import { Outlet } from "react-router";

import { Titlebar } from "@/components/ui/titlebar";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      {/* Custom window chrome — replaces the native OS title bar. */}
      <Titlebar />

      {/* Body below the title bar */}
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          {/* Only this pane scrolls — the shell itself is fixed (see index.css). */}
          <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
