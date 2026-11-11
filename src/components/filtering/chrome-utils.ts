/**
 * Non-component helpers of the filtering editor's chrome (`chrome.tsx`): the
 * risk-score scale and the per-field profile save used by every tab.
 */

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useUpdateFilteringProfile } from "@/lib/api/hooks/use-filtering";
import { HITL_OFF_MAX_THRESHOLD } from "@/lib/filtering/payload";
import type { FilteringProfile, FilteringProfileWrite } from "@/types/filtering";

import { useErrorToast } from "./use-error-toast";

// ─── Threshold scale ──────────────────────────────────────────────────────────

/** The lowest threshold the API accepts. */
export const MIN_THRESHOLD = 20;
/** The recommended value, marked on the track. */
export const RECOMMENDED_THRESHOLD = 80;

const GRADIENT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [34, 197, 94]],
  [20, [34, 197, 94]],
  [50, [234, 179, 8]],
  [80, [239, 68, 68]],
  [100, [239, 68, 68]],
];

export const THRESHOLD_GRADIENT =
  "linear-gradient(to right, #22c55e 0%, #22c55e 20%, #eab308 50%, #ef4444 80%, #ef4444 100%)";

/** The gradient's colour at a threshold, for a number shown beside the track. */
export function thresholdColor(value: number): string {
  const x = Math.min(100, Math.max(0, value));
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const [p0, c0] = GRADIENT_STOPS[i]!;
    const [p1, c1] = GRADIENT_STOPS[i + 1]!;
    if (x >= p0 && x <= p1) {
      const t = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
      const ch = (a: number, b: number) => Math.round(a + (b - a) * t);
      return `rgb(${ch(c0[0], c1[0])}, ${ch(c0[1], c1[1])}, ${ch(c0[2], c1[2])})`;
    }
  }
  return "rgb(239, 68, 68)";
}

/** Highest threshold allowed: 100 with HITL, 80 without. */
export const maxThresholdFor = (hitlEnabled: boolean) =>
  hitlEnabled ? 100 : HITL_OFF_MAX_THRESHOLD;

// ─── Saving one field ─────────────────────────────────────────────────────────

/**
 * PATCH a few profile fields right away, as the web app does per control.
 * Resolves on success and rejects on failure (after showing the error), so
 * callers can snap a control back to the stored value.
 */
export function useProfileFieldSave(profile: FilteringProfile) {
  const { t } = useTranslation();
  const update = useUpdateFilteringProfile();
  const showError = useErrorToast();
  const save = async (body: FilteringProfileWrite, quiet = false) => {
    try {
      const updated = await update.mutateAsync({ id: profile.id, body });
      if (!quiet) toast.success(t("filtering.common.saved"));
      return updated;
    } catch (err) {
      showError(err);
      throw err;
    }
  };
  return { save, pending: update.isPending };
}
