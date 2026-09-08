import { useLocation } from "react-router";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { findNavItem } from "@/config/navigation";
import { useStoredCredentials } from "@/lib/api";

function ConnectionBadge() {
  const { data, isPending } = useStoredCredentials();

  if (isPending) return null;

  const configured = Boolean(data?.hasSecret);
  return (
    <Badge variant={configured ? "secondary" : "outline"} className="gap-1.5">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${configured ? "bg-success" : "bg-muted-foreground"}`}
      />
      {configured ? (data?.clientId ?? "Configured") : "Not configured"}
    </Badge>
  );
}

export function AppHeader() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{item?.label ?? "Confinaid Test Tool"}</h1>
        {item && <p className="text-muted-foreground truncate text-xs">{item.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ConnectionBadge />
        <ThemeToggle />
      </div>
    </header>
  );
}
