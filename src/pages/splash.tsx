/**
 * Splash Screen — startup update lifecycle.
 *
 * Mirrors the desktop app's UpdaterModal behaviour exactly:
 *
 *   checking
 *     ↓ no update / error     → brief result display → onComplete() (main app)
 *     ↓ update found
 *         auto-install ON     → download with progress → install → app exits
 *         auto-install OFF    → "update found, auto-install disabled" → 2.5 s
 *                               → onComplete() (header banner shows the update)
 *
 * The check result is always stored in `updaterStore` so the header banner and
 * the Settings card see it without a second network call.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { commands } from "@/lib/api/tauri-client";
import { useUpdaterStore } from "@/stores/updater-store";
import { useUiStore } from "@/stores/ui-store";
import { formatBytes, formatSpeed } from "@/components/ui/update-banner";
import type { DownloadProgress, UpdateCheckResult } from "@/types/updater";
import { cn } from "@/lib/utils";

// ─── Phase type ───────────────────────────────────────────────────────────────

type Phase =
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "update-available-auto"; update: UpdateCheckResult } // downloading next
  | { kind: "update-available-manual"; update: UpdateCheckResult } // auto-install off
  | { kind: "downloading"; progress: DownloadProgress | null; statusText: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

// ─── Component ───────────────────────────────────────────────────────────────

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const completedRef = useRef(false);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  const { resolvedTheme } = useTheme();
  const setCheckResult = useUpdaterStore((s) => s.setCheckResult);
  const autoInstallEnabled = useUiStore((s) => s.autoInstallEnabled);
  const logoSrc = resolvedTheme === "dark" ? "/logo.png" : "/logo-dark.png";

  // Fade-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => unlistenRef.current.forEach((fn) => fn());
  }, []);

  const proceed = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setExiting(true);
    setVisible(false);
    setTimeout(onComplete, 450);
  }, [onComplete]);

  // ── Auto-download + install ────────────────────────────────────────────────
  const runInstall = useCallback(
    async (update: UpdateCheckResult) => {
      if (!update.download_url || !update.filename) {
        proceed();
        return;
      }

      // Subscribe to Tauri events
      const ulProgress = await listen<DownloadProgress>("update-download-progress", (e) =>
        setPhase((p) => (p.kind === "downloading" ? { ...p, progress: e.payload } : p))
      );
      const ulStatus = await listen<string>("update-status", (e) => {
        const text = e.payload;
        setPhase((p) => (p.kind === "downloading" ? { ...p, statusText: text } : p));
      });
      unlistenRef.current = [ulProgress, ulStatus];

      setPhase({ kind: "downloading", progress: null, statusText: "Preparing download…" });

      try {
        await commands.updater.installUpdate({
          downloadUrl: update.download_url,
          checksum: update.checksum ?? "",
          downloadSize: update.download_size ?? 0,
          filename: update.filename,
        });
        // The Rust side calls app.exit(0) — if we somehow reach here, show
        // the installing spinner as a fallback.
        setPhase({ kind: "installing" });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : typeof err === "string" ? err : "Install failed";
        setPhase({ kind: "error", message: msg });
        await new Promise((r) => setTimeout(r, 2_500));
        proceed();
      } finally {
        unlistenRef.current.forEach((fn) => fn());
        unlistenRef.current = [];
      }
    },
    [proceed]
  );

  // ── Main startup logic ─────────────────────────────────────────────────────
  useEffect(() => {
    const run = async () => {
      // Hard cap — never block startup longer than 10 s
      const hardTimeout = setTimeout(proceed, 10_000);

      // Small intentional delay so the spinner is visible
      await new Promise((r) => setTimeout(r, 800));

      try {
        const result = await commands.updater.checkForUpdates();
        clearTimeout(hardTimeout);
        setCheckResult(result);

        if (!result.available) {
          // Up to date
          setPhase({ kind: "up-to-date" });
          await new Promise((r) => setTimeout(r, 900));
          proceed();
          return;
        }

        // ── Update found ──────────────────────────────────────────────────
        if (autoInstallEnabled) {
          // Auto-install: show briefly then download
          setPhase({ kind: "update-available-auto", update: result });
          await new Promise((r) => setTimeout(r, 1_500));
          await runInstall(result);
        } else {
          // Auto-install off: inform the user and proceed to the main app
          // (the header banner and Settings card will offer Install Now)
          setPhase({ kind: "update-available-manual", update: result });
          await new Promise((r) => setTimeout(r, 2_500));
          proceed();
        }
      } catch {
        clearTimeout(hardTimeout);
        setPhase({ kind: "error", message: "Could not check for updates" });
        await new Promise((r) => setTimeout(r, 1_500));
        proceed();
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "bg-background fixed inset-0 z-50 flex items-center justify-center overflow-hidden",
        "transition-opacity duration-[400ms]",
        visible && !exiting ? "opacity-100" : "opacity-0",
        exiting && "pointer-events-none"
      )}
    >
      {/* Gradient glows */}
      <div
        className="pointer-events-none absolute -top-1/4 -left-1/4 h-2/3 w-2/3 rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(147,51,234,0.22) 0%, transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -right-1/4 -bottom-1/4 h-2/3 w-2/3 rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(8,145,178,0.18) 0%, transparent 70%)" }}
      />

      {/* Content */}
      <div className="relative z-10 flex w-72 flex-col items-center gap-5 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center gap-1">
          <img
            src={logoSrc}
            alt="Confinaid Test Tool"
            className="h-8 select-none"
            onError={(e) => {
              e.currentTarget.src = "/logo.png";
            }}
          />
          <span className="text-muted-foreground/70 text-[11px] font-medium tracking-[0.2em] uppercase select-none">
            Test Tool
          </span>
        </div>

        {/* Icon */}
        <div className="bg-muted/50 flex h-14 w-14 items-center justify-center rounded-full">
          {phase.kind === "checking" && (
            <Loader2 className="text-muted-foreground size-7 animate-spin" />
          )}
          {phase.kind === "up-to-date" && <CheckCircle className="size-7 text-green-500" />}
          {(phase.kind === "update-available-auto" || phase.kind === "update-available-manual") && (
            <Download className="size-7 text-purple-500" />
          )}
          {phase.kind === "downloading" && (
            <RefreshCw className="size-7 animate-spin text-purple-500" />
          )}
          {phase.kind === "installing" && <Loader2 className="size-7 animate-spin text-cyan-500" />}
          {phase.kind === "error" && <AlertCircle className="text-destructive size-7" />}
        </div>

        {/* Status text */}
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {phase.kind === "checking" && "Checking for updates…"}
            {phase.kind === "up-to-date" && "You're on the latest version"}
            {phase.kind === "update-available-auto" &&
              `Update found — v${phase.update.new_version}`}
            {phase.kind === "update-available-manual" &&
              `Update found — v${phase.update.new_version}`}
            {phase.kind === "downloading" && (phase.statusText || "Downloading…")}
            {phase.kind === "installing" && "Launching installer…"}
            {phase.kind === "error" && "Update check failed"}
          </p>

          {/* Version line */}
          {(phase.kind === "update-available-auto" ||
            phase.kind === "update-available-manual" ||
            phase.kind === "downloading") && (
            <p className="text-muted-foreground text-xs">
              {phase.kind === "update-available-auto" && "Downloading automatically…"}
              {phase.kind === "update-available-manual" &&
                "Auto-install is off — install from Settings when ready."}
              {phase.kind === "downloading" &&
                phase.progress &&
                `v${""} · ${formatBytes(phase.progress.downloaded)}${
                  phase.progress.total > 0 ? ` / ${formatBytes(phase.progress.total)}` : ""
                }`}
            </p>
          )}

          {/* Error detail */}
          {phase.kind === "error" && (
            <p className="text-muted-foreground text-xs">Continuing to app…</p>
          )}
        </div>

        {/* Progress bar */}
        {phase.kind === "downloading" && (
          <div className="w-full space-y-1.5">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: phase.progress
                    ? `${Math.min(phase.progress.percentage, 100).toFixed(1)}%`
                    : "0%",
                  background: "linear-gradient(90deg, rgba(147,51,234,0.9), rgba(8,145,178,0.9))",
                }}
              />
            </div>
            {phase.progress && (
              <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                <span>{phase.progress.percentage.toFixed(0)}%</span>
                <span>{formatSpeed(phase.progress.speed_bps)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SplashScreen;
