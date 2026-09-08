import { Outlet } from "react-router";

import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";

export function AppShell() {
  return (
    <div className="flex h-full">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        {/* Only this pane scrolls — the shell itself is fixed (see index.css). */}
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
