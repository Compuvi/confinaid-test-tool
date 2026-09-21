import { useLocation } from "react-router";

import { Titlebar } from "@/components/ui/titlebar";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { Outlet } from "react-router";
import { cn } from "@/lib/utils";

/**
 * Routes that need a full-bleed two-pane layout and manage their own padding
 * internally. The shell strips its px-6 pt-1 pb-6 padding for these paths so
 * the inner scrollbars reach the window edge naturally.
 */
const FULL_BLEED_ROUTES = ["/suites", "/connection"];

export function AppShell() {
  const { pathname } = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="flex h-full flex-col">
      {/* Custom window chrome — replaces the native OS title bar. */}
      <Titlebar />

      {/* Body below the title bar */}
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          {/* Only this pane scrolls — the shell itself is fixed (see index.css).
              Full-bleed pages manage their own padding and inner scrolling. */}
          <main className={cn("min-h-0 flex-1 overflow-y-auto", !isFullBleed && "px-6 pt-1 pb-6")}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
