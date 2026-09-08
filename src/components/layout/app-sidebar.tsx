import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

export function AppSidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-r transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <img src="/favicon.png" alt="" className="size-7 shrink-0 rounded-md" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">Confinaid</p>
            <p className="text-muted-foreground truncate text-xs leading-tight">Test Tool</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-2" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
          const link = (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:outline-none",
                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                  collapsed && "justify-center px-0"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );

          // Collapsed rails show icons only, so the label needs a tooltip.
          return collapsed ? (
            <Tooltip key={to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ) : (
            link
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
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>
    </aside>
  );
}
