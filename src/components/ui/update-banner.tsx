/**
 * UpdateBanner + shared update hooks.
 *
 * Architecture:
 *  • `useUpdateCheck()`   — runs once at startup, writes result to `updaterStore`.
 *  • `useInstallUpdate()` — exposes `install()`, reads/writes `installPhase`
 *                           from `updaterStore`.  Shared by the banner AND the
 *                           Settings card so progress stays in sync.
 *  • `UpdateBanner`       — compact header pill; delegates to the shared hooks.
 *  • `InstallProgress`    — reusable progress/status/error UI used by both
 *                           the banner and the Settings card.
 */

import { useEffect, useRef } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/lib/api/tauri-client";
import type { DownloadProgress, UpdateCheckResult } from "@/types/updater";
import { useUpdaterStore } from "@/stores/updater-store";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

// ─── Shared install hook ──────────────────────────────────────────────────────

/**
 * Returns an `install(update)` function that drives the shared `installPhase`
 * in `updaterStore`.  Both the banner and the Settings card call this same
 * function so progress is always in sync.
 */
export function useInstallUpdate() {
  const setInstallPhase = useUpdaterStore((s) => s.setInstallPhase);
  const unlistenRef = useRef<Array<() => void>>([]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn());
    };
  }, []);

  const install = async (update: UpdateCheckResult) => {
    if (!update.download_url || !update.filename) {
      if (update.release_url) openUrl(update.release_url).catch(console.error);
      return;
    }

    setInstallPhase({ kind: "status", text: "Preparing download…" });

    const unlistenProgress = await listen<DownloadProgress>("update-download-progress", (e) =>
      setInstallPhase({ kind: "downloading", progress: e.payload })
    );
    const unlistenStatus = await listen<string>("update-status", (e) =>
      setInstallPhase({ kind: "status", text: e.payload })
    );
    unlistenRef.current = [unlistenProgress, unlistenStatus];

    try {
      await commands.updater.installUpdate({
        downloadUrl: update.download_url,
        checksum: update.checksum ?? "",
        downloadSize: update.download_size ?? 0,
        filename: update.filename,
      });
      setInstallPhase({ kind: "status", text: "Installer launched — closing…" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
      setInstallPhase({ kind: "error", message });
    } finally {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    }
  };

  return { install };
}

// ─── Reusable progress/status/error UI ───────────────────────────────────────

interface InstallProgressProps {
  phase: ReturnType<typeof useUpdaterStore.getState>["installPhase"];
  onRetry?: () => void;
  onOpenReleasePage?: () => void;
  className?: string;
}

export function InstallProgress({
  phase,
  onRetry,
  onOpenReleasePage,
  className,
}: InstallProgressProps) {
  if (phase.kind === "idle") return null;

  if (phase.kind === "downloading") {
    const p = phase.progress;
    return (
      <div className={cn("space-y-1.5", className)}>
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>Downloading…</span>
          <span className="font-mono tabular-nums">
            {p.total > 0
              ? `${formatBytes(p.downloaded)} / ${formatBytes(p.total)}`
              : formatBytes(p.downloaded)}
          </span>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all duration-150"
            style={{ width: `${p.percentage.toFixed(1)}%` }}
          />
        </div>
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>{p.percentage.toFixed(0)}%</span>
          <span>{formatSpeed(p.speed_bps)}</span>
        </div>
      </div>
    );
  }

  if (phase.kind === "status") {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs", className)}>
        <Loader2 className="text-primary size-3 animate-spin" />
        <span className="text-muted-foreground">{phase.text}</span>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-destructive text-xs">{phase.message}</p>
        <div className="flex gap-2">
          {onOpenReleasePage && (
            <button
              onClick={onOpenReleasePage}
              className="text-destructive text-xs font-medium hover:underline"
            >
              Download manually
            </button>
          )}
          {onRetry && (
            <button onClick={onRetry} className="text-muted-foreground text-xs hover:underline">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ─── Header banner component ──────────────────────────────────────────────────

interface UpdateBannerProps {
  className?: string;
}

export function UpdateBanner({ className }: UpdateBannerProps) {
  const checkResult = useUpdaterStore((s) => s.checkResult);
  const installPhase = useUpdaterStore((s) => s.installPhase);
  const setInstallPhase = useUpdaterStore((s) => s.setInstallPhase);
  const setCheckResult = useUpdaterStore((s) => s.setCheckResult);
  const { install } = useInstallUpdate();

  if (!checkResult) return null;

  const update = checkResult;
  const isInstalling = installPhase.kind !== "idle" && installPhase.kind !== "error";
  const hasInstaller = Boolean(update.download_url && update.filename);

  const openReleasePage = () => {
    if (update.release_url) openUrl(update.release_url).catch(console.error);
  };

  const accent = update.mandatory
    ? "border-amber-500/40 bg-amber-500/10"
    : "border-primary/30 bg-primary/10";
  const iconColor = update.mandatory ? "text-amber-600 dark:text-amber-400" : "text-primary";

  // ── Downloading — wide pill ────────────────────────────────────────────────
  if (installPhase.kind === "downloading") {
    const p = installPhase.progress;
    return (
      <div
        className={cn(
          "flex min-w-[240px] flex-col gap-1 rounded-xl border px-3 py-2 text-xs",
          accent,
          className
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Downloading v{update.new_version}…</span>
          <span className="text-muted-foreground font-mono tabular-nums">
            {p.total > 0
              ? `${formatBytes(p.downloaded)} / ${formatBytes(p.total)}`
              : formatBytes(p.downloaded)}
          </span>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-150",
              iconColor,
              "bg-current"
            )}
            style={{ width: `${p.percentage.toFixed(1)}%` }}
          />
        </div>
        <div className="text-muted-foreground flex justify-between">
          <span>{p.percentage.toFixed(0)}%</span>
          <span>{formatSpeed(p.speed_bps)}</span>
        </div>
      </div>
    );
  }

  // ── Status spinner ─────────────────────────────────────────────────────────
  if (installPhase.kind === "status") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          accent,
          className
        )}
      >
        <Loader2 className={cn("size-3 shrink-0 animate-spin", iconColor)} />
        <span className="text-muted-foreground">{installPhase.text}</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (installPhase.kind === "error") {
    return (
      <div
        className={cn(
          "border-destructive/40 bg-destructive/10 flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          className
        )}
      >
        <span className="text-destructive line-clamp-1 max-w-[200px]">{installPhase.message}</span>
        <button onClick={openReleasePage} className="text-destructive font-medium hover:underline">
          Download manually
        </button>
        <button
          onClick={() => setInstallPhase({ kind: "idle" })}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss error"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  // ── Idle — normal update pill ──────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
        accent,
        className
      )}
    >
      <Download className={cn("size-3 shrink-0", iconColor)} />

      <span className="text-muted-foreground">
        {update.mandatory ? "Required update" : "Update available"}
        {update.new_version && (
          <>
            {" "}
            <button
              onClick={openReleasePage}
              className={cn("font-mono font-medium hover:underline", iconColor)}
              title="Open release page"
            >
              v{update.new_version}
              <ExternalLink className="ml-0.5 inline-block size-2.5 align-middle" />
            </button>
          </>
        )}
      </span>

      {!isInstalling && hasInstaller && (
        <button
          onClick={() => install(update)}
          className={cn("font-medium hover:underline", iconColor)}
        >
          Install Now
        </button>
      )}
      {!isInstalling && !hasInstaller && (
        <button onClick={openReleasePage} className={cn("font-medium hover:underline", iconColor)}>
          Download
        </button>
      )}

      {!update.mandatory && !isInstalling && (
        <button
          onClick={() => setCheckResult(null)}
          className="text-muted-foreground hover:text-foreground ml-0.5 transition-colors"
          aria-label="Dismiss update notification"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
