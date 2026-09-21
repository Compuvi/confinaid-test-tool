import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, UserRound } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UpdateBanner } from "@/components/ui/update-banner";
import { useUpdaterStore } from "@/stores/updater-store";
import { findNavItem } from "@/config/navigation";
import {
  getErrorMessage,
  useListProfiles,
  useStoredCredentials,
  useSwitchProfile,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Nav description strings (English fallbacks kept in-file; sidebar uses i18n keys)
const NAV_DESCRIPTIONS: Record<string, string> = {
  connection: "API credentials and endpoint configuration",
  requests: "Send single or bulk requests against the Confinaid API",
  playground: "Interactive analyze & rewrite sandbox with findings overlay",
  suites: "Saved test cases with assertions",
  load: "Throughput, latency, and throttling behaviour",
  reports: "Past run history and exportable results",
  monitoring: "Partner API traffic — KPIs, request log, and per-request detail",
  docs: "API documentation, code samples, and error reference",
  settings: "Appearance and application preferences",
};

// ── Profile selector dropdown ─────────────────────────────────────────────────

function ProfileSelector() {
  const { data: active, isPending } = useStoredCredentials();
  const { data: allProfiles = [] } = useListProfiles();
  const switchProfile = useSwitchProfile();
  const navigate = useNavigate();

  if (isPending) return null;

  const configured = Boolean(active?.hasSecret);

  const handleSwitch = async (profileName: string) => {
    if (profileName === active?.profileName) return;
    try {
      await switchProfile.mutateAsync(profileName);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            "hover:bg-muted focus-visible:ring-1 focus-visible:outline-none",
            configured ? "border-border" : "text-muted-foreground border-dashed"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              configured ? "bg-emerald-500" : "bg-muted-foreground"
            )}
          />
          <span className="text-muted-foreground mr-0.5">Profile:</span>
          <span className="max-w-[140px] truncate font-mono">{active?.profileName ?? "None"}</span>
          <ChevronDown className="text-muted-foreground size-3" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Switch profile
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {allProfiles.length === 0 ? (
          <DropdownMenuItem
            className="text-muted-foreground text-xs"
            onSelect={() => void navigate("/connection")}
          >
            No profiles saved — click to configure
          </DropdownMenuItem>
        ) : (
          allProfiles.map((p) => {
            const isActive = p.profileName === active?.profileName;
            return (
              <DropdownMenuItem
                key={p.profileName}
                onSelect={() => void handleSwitch(p.profileName)}
                className="gap-2"
              >
                <UserRound className="text-muted-foreground size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.profileName}</p>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {p.clientId || "—"}
                  </p>
                </div>
                {isActive && (
                  <span className="shrink-0 text-xs font-medium text-emerald-500">✓</span>
                )}
              </DropdownMenuItem>
            );
          })
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={() => void navigate("/connection")}>
          Manage profiles…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

export function AppHeader() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const item = findNavItem(pathname);
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
        <ProfileSelector />
        <ThemeToggle />
      </div>
    </header>
  );
}
