/**
 * Updater store — shared state for the update check result and install progress.
 *
 * Written by `useUpdateCheck` (startup auto-check) and by the manual "Check
 * for Updates" button in Settings.  Read by both `UpdateBanner` (header) and
 * the Settings Updates card so they always agree on the current state.
 */

import { create } from "zustand";
import type { DownloadProgress, UpdateCheckResult } from "@/types/updater";

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; progress: DownloadProgress }
  | { kind: "status"; text: string }
  | { kind: "error"; message: string };

type UpdaterState = {
  /** Latest check result.  `null` = not checked yet or dismissed. */
  checkResult: UpdateCheckResult | null;
  setCheckResult: (r: UpdateCheckResult | null) => void;

  /** Whether a manual or auto check is in flight. */
  checking: boolean;
  setChecking: (v: boolean) => void;

  /** Install phase — drives the progress UI in both the banner and Settings. */
  installPhase: Phase;
  setInstallPhase: (p: Phase) => void;
};

export const useUpdaterStore = create<UpdaterState>((set) => ({
  checkResult: null,
  setCheckResult: (r) => set({ checkResult: r }),

  checking: false,
  setChecking: (v) => set({ checking: v }),

  installPhase: { kind: "idle" },
  setInstallPhase: (p) => set({ installPhase: p }),
}));
