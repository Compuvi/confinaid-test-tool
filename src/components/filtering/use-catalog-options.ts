/**
 * Catalog entries as select options, plus an id -> label lookup for tables
 * and the truncation state of the underlying `fetchAllPages`.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useCatalog } from "@/lib/api/hooks/use-filtering";
import type { AllPages } from "@/lib/filtering/client";
import type {
  CatalogAiModel,
  CatalogAttachment,
  CatalogLabel,
  CatalogLabelCondition,
  CatalogLanguage,
  FilteringProfile,
} from "@/types/filtering";

import type { Option } from "./shared";

/** `{shown, count}` when a list was cut off by the page cap, else `null`. */
export type Truncation = { shown: number; count: number } | null;

export function truncationOf(data: AllPages<unknown> | undefined): Truncation {
  return data?.truncated ? { shown: data.items.length, count: data.count } : null;
}

function withLookup(options: Option[], data: AllPages<unknown> | undefined, isPending: boolean) {
  return {
    options,
    labelOf: (id: string | null | undefined) =>
      id ? (options.find((o) => o.value === id)?.label ?? id) : "—",
    truncated: truncationOf(data),
    isLoading: isPending,
  };
}

export function useLanguageOptions() {
  const { data, isPending } = useCatalog<CatalogLanguage>("languages");
  const options = useMemo(
    () => (data?.items ?? []).map((l) => ({ value: l.id, label: l.name, hint: l.code })),
    [data]
  );
  return withLookup(options, data, isPending);
}

export function useAttachmentOptions() {
  const { data, isPending } = useCatalog<CatalogAttachment>("attachments");
  const options = useMemo(
    () => (data?.items ?? []).map((a) => ({ value: a.id, label: a.name })),
    [data]
  );
  return withLookup(options, data, isPending);
}

export function useAiModelOptions() {
  const { t } = useTranslation();
  const { data, isPending } = useCatalog<CatalogAiModel>("ai-models");
  const options = useMemo(
    () =>
      (data?.items ?? []).map((m) => ({
        value: m.id,
        label:
          (m.version ? `${m.name} (${m.version})` : m.name) +
          (m.is_default ? ` · ${t("filtering.general.default_model")}` : ""),
      })),
    [data, t]
  );
  return withLookup(options, data, isPending);
}

/**
 * Labels of the profile's region (`?region=<region.id>`): the only labels a
 * bypass label condition accepts. Without a region the full catalog is used.
 */
export function useLabelOptions(profile: FilteringProfile) {
  const region = profile.region?.id;
  const { data, isPending } = useCatalog<CatalogLabel>("labels", region ? { region } : {});
  const options = useMemo(
    () => (data?.items ?? []).map((l) => ({ value: l.id, label: l.title, hint: l.key })),
    [data]
  );
  return withLookup(options, data, isPending);
}

/**
 * The platform's label conditions, grouped by the label they are reviewed
 * against. A label setting's `condition_status` is the outcome of that review,
 * and without this the status reads as a verdict on nothing in particular.
 * Inactive conditions are not reviewed, so they are left out.
 */
export function useLabelConditions() {
  const { data, isPending } = useCatalog<CatalogLabelCondition>("label-conditions");
  const byLabel = useMemo(() => {
    const map = new Map<string, CatalogLabelCondition[]>();
    for (const c of data?.items ?? []) {
      if (c.is_active === false) continue;
      map.set(c.label, [...(map.get(c.label) ?? []), c]);
    }
    return map;
  }, [data]);
  return {
    conditionsOf: (labelId: string | null | undefined) =>
      labelId ? (byLabel.get(labelId) ?? []) : [],
    truncated: truncationOf(data),
    isLoading: isPending,
  };
}
