import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { UpdateBanner } from "@/components/ui/update-banner";
import { useUpdaterStore } from "@/stores/updater-store";
import { findNavItem } from "@/config/navigation";
import { useStoredCredentials } from "@/lib/api";

// Nav description strings (English fallbacks kept in-file; sidebar uses i18n keys)
const NAV_DESCRIPTIONS: Record<string, string> = {
  connection: "API credentials and endpoint configuration",
  requests: "Send single or bulk requests against the Confinaid API",
  playground: "Interactive analyze & rewrite sandbox with findings overlay",
  suites: "Saved test cases with assertions",
  load: "Throughput, latency, and throttling behaviour",
  reports: "Past runs and exportable results",
  settings: "Appearance and application preferences",
};

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
  const { t } = useTranslation();
  const item = findNavItem(pathname);
  // The splash screen already ran the startup check and wrote to updaterStore.
  const hasUpdate = useUpdaterStore((s) => s.checkResult?.available ?? false);

  const title = item ? t(`nav.${item.labelKey}`) : "Confinaid Test Tool";
  const description = item ? NAV_DESCRIPTIONS[item.labelKey] : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground truncate text-xs">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hasUpdate && <UpdateBanner />}
        <ConnectionBadge />
        <ThemeToggle />
      </div>
    </header>
  );
}
