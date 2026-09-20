/**
 * UpdateBanner
 *
 * Appears in the app header when a newer version is available.
 *
 * Behaviour:
 *  • "Install Now" → download with a live progress bar → SHA-256 verify →
 *    launch the platform installer silently → app exits.
 *  • "×" dismisses the banner for this session (mandatory updates hide it).
 *  • Falling back to "Open release page" is always available via the version
 *    link so the user can download manually if auto-install fails.
 *
 * Progress is received via Tauri events:
 *   `update-download-progress`  { downloaded, total, percentage, speed_bps }
 *   `update-status`             string
 */

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/lib/api/tauri-client";
import type { DownloadProgress, UpdateCheckResult } from "@/types/updater";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Runs one update check ~3 s after mount.
 * Returns `null` while checking or when no update is available.
 */
export function useUpdateCheck(): UpdateCheckResult | null {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const autoUpdateEnabled = useUiStore((s) => s.autoUpdateEnabled);

  useEffect(() => {
    if (!autoUpdateEnabled) return;

    const timer = setTimeout(() => {
      commands.updater
        .checkForUpdates()
        .then((r) => {
          if (r.available) setResult(r);
        })
        .catch(() => {
          // Network failure — silently ignored.
        });
    }, 3_000);

    return () => clearTimeout(timer);
  }, [autoUpdateEnabled]);

  return result;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

// ─── Component ───────────────────────────────────────────────────────────────

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; progress: DownloadProgress }
  | { kind: "status"; text: string }
  | { kind: "error"; message: string };

interface UpdateBannerProps {
  update: UpdateCheckResult;
  className?: string;
}

export function UpdateBanner({ update, className }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const unlistenRef = useRef<Array<() => void>>([]);

  // Clean up event listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn());
    };
  }, []);

  if (dismissed) return null;

  const isInstalling = phase.kind !== "idle" && phase.kind !== "error";
  const hasInstaller = Boolean(update.download_url && update.filename);

  const openReleasePage = () => {
    if (update.release_url) openUrl(update.release_url).catch(console.error);
  };

  const handleInstall = async () => {
    if (!update.download_url || !update.filename) {
      openReleasePage();
      return;
    }

    setPhase({ kind: "status", text: "Preparing download…" });

    // Subscribe to events
    const unlistenProgress = await listen<DownloadProgress>("update-download-progress", (e) =>
      setPhase({ kind: "downloading", progress: e.payload })
    );
    const unlistenStatus = await listen<string>("update-status", (e) => {
      setPhase({ kind: "status", text: e.payload });
    });
    unlistenRef.current = [unlistenProgress, unlistenStatus];

    try {
      await commands.updater.installUpdate({
        downloadUrl: update.download_url,
        checksum: update.checksum ?? "",
        downloadSize: update.download_size ?? 0,
        filename: update.filename,
      });
      // App will exit on its own after install is launched.
      setPhase({ kind: "status", text: "Installer launched — closing…" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
      setPhase({ kind: "error", message });
    } finally {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    }
  };

  const accent = update.mandatory
    ? "border-amber-500/40 bg-amber-500/10"
    : "border-primary/30 bg-primary/10";
  const iconColor = update.mandatory ? "text-amber-600 dark:text-amber-400" : "text-primary";

  // ── Downloading phase — wide pill with progress bar ─────────────────────
  if (phase.kind === "downloading") {
    const p = phase.progress;
    return (
      <div
        className={cn(
          "border-primary/30 bg-primary/10 flex min-w-[240px] flex-col gap-1 rounded-xl border px-3 py-2 text-xs",
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

        {/* Progress bar */}
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

  // ── Status / verifying phase ────────────────────────────────────────────
  if (phase.kind === "status") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          accent,
          className
        )}
      >
        <Loader2 className={cn("size-3 shrink-0 animate-spin", iconColor)} />
        <span className="text-muted-foreground">{phase.text}</span>
      </div>
    );
  }

  // ── Error phase ─────────────────────────────────────────────────────────
  if (phase.kind === "error") {
    return (
      <div
        className={cn(
          "border-destructive/40 bg-destructive/10 flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          className
        )}
      >
        <span className="text-destructive line-clamp-1 max-w-[200px]">{phase.message}</span>
        <button onClick={openReleasePage} className="text-destructive font-medium hover:underline">
          Download manually
        </button>
        <button
          onClick={() => setPhase({ kind: "idle" })}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss error"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  // ── Idle — normal update pill ───────────────────────────────────────────
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

      {isInstalling ? null : hasInstaller ? (
        <button onClick={handleInstall} className={cn("font-medium hover:underline", iconColor)}>
          Install Now
        </button>
      ) : (
        <button onClick={openReleasePage} className={cn("font-medium hover:underline", iconColor)}>
          Download
        </button>
      )}

      {!update.mandatory && !isInstalling && (
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground ml-0.5 transition-colors"
          aria-label="Dismiss update notification"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
