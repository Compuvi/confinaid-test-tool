import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

export function AppSidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-r transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div className="border-border/50 flex h-14 items-center gap-1 border-b px-2">
        <div className="flex flex-1 items-center overflow-hidden">
          {collapsed ? (
            <img src="/favicon.png" alt="" className="mx-auto size-7 shrink-0 rounded-md" />
          ) : (
            <div className="flex items-center gap-2 px-1">
              <img src="/favicon.png" alt="" className="size-7 shrink-0 rounded-md" />
              <div className="min-w-0">
                <p className="truncate text-sm leading-tight font-semibold">Confinaid</p>
                <p className="text-muted-foreground truncate text-xs leading-tight">Test Tool</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <nav
        className={cn("flex-1 px-2 py-2", collapsed ? "space-y-2" : "space-y-1")}
        aria-label="Main"
      >
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => {
          const label = t(`nav.${labelKey}`);

          if (collapsed) {
            const isActive = pathname === to || pathname.startsWith(to + "/");
            return (
              <div
                key={to}
                className={cn(
                  "flex justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={to}
                      className={cn(
                        "flex w-9 items-center justify-center py-2 text-sm transition-colors",
                        "focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none",
                        isActive && "font-medium"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              </div>
            );
          }

          // Expanded: full-width row with icon + label.
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none",
                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div
        className={cn(
          "border-sidebar-border flex items-center border-t p-2",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <span className="text-muted-foreground px-2 font-mono text-xs">v{__APP_VERSION__}</span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hover:bg-sidebar-accent text-muted-foreground flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </button>
      </div>
    </aside>
  );
}
