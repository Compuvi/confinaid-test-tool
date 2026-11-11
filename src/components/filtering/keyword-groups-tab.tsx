import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";

import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useAllKeywords } from "@/lib/api/hooks/use-filtering";
import {
  buildKeywordGroupPayload,
  defaultKeywordGroupDraft,
  keywordGroupToDraft,
  patchFrom,
  type KeywordGroupDraft,
} from "@/lib/filtering/payload";
import type { FilteringProfile, KeywordGroup, KeywordGroupWrite } from "@/types/filtering";

import { CollectionTab } from "./collection-tab";
import { Field, MultiSelectList, SwitchField, TruncatedNotice } from "./shared";
import { truncationOf } from "./use-catalog-options";

export function KeywordGroupsTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const keywords = useAllKeywords(profile.id);
  const keywordOptions = useMemo(
    () =>
      (keywords.data?.items ?? []).map((k) => ({
        value: k.id,
        label: k.name,
        hint: t(`filtering.match_type.${k.match_type}`),
      })),
    [keywords.data, t]
  );
  const keywordsTruncated = truncationOf(keywords.data);
  const nameOf = (id: string) =>
    keywordOptions.find((o) => o.value === id)?.label ?? id.slice(0, 8);

  return (
    <CollectionTab<KeywordGroup, KeywordGroupDraft, KeywordGroupWrite>
      profile={profile}
      collection="keyword-groups"
      icon={Layers}
      title={t("filtering.tabs.keyword_groups")}
      description={t("filtering.keyword_groups.description")}
      searchable
      toolbarExtra={<TruncatedNotice truncated={keywordsTruncated} />}
      columns={[
        {
          header: t("filtering.fields.title"),
          cell: (g) => <span className="font-medium">{g.title}</span>,
        },
        {
          header: t("filtering.tabs.keywords"),
          cell: (g) => (
            <span className="text-muted-foreground line-clamp-2 text-xs">
              {g.keyword_ids.map(nameOf).join(", ")}
            </span>
          ),
          className: "max-w-[280px]",
        },
        { header: t("filtering.fields.min_matches"), cell: (g) => g.min_matches },
        { header: t("filtering.fields.proximity_window"), cell: (g) => g.proximity_window },
      ]}
      emptyDraft={defaultKeywordGroupDraft}
      toDraft={keywordGroupToDraft}
      buildCreate={buildKeywordGroupPayload}
      buildPatch={(o, d) => patchFrom(buildKeywordGroupPayload, o, d)}
      validate={(d) => {
        const e: Record<string, string[]> = {};
        if (!d.title.trim()) e.title = [t("filtering.validation.required")];
        if (d.keyword_ids.length < 2) e.keyword_ids = [t("filtering.validation.min_two_keywords")];
        else if (d.min_matches > d.keyword_ids.length)
          e.min_matches = [
            t("filtering.validation.min_matches_range", { max: d.keyword_ids.length }),
          ];
        return e;
      }}
      inlineFields={[
        "title",
        "description",
        "keyword_ids",
        "min_matches",
        "proximity_window",
        "is_active",
      ]}
      itemName={(g) => g.title}
      canDelete
      renderForm={({ draft, setDraft, errors }) => (
        <>
          <Field
            label={t("filtering.fields.title")}
            htmlFor="kg-title"
            errors={errors.fields.title}
          >
            <Input
              id="kg-title"
              maxLength={255}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              aria-invalid={Boolean(errors.fields.title)}
            />
          </Field>
          <Field
            label={t("filtering.tabs.keywords")}
            hint={t("filtering.keyword_groups.keywords_hint")}
            errors={errors.fields.keyword_ids}
          >
            <MultiSelectList
              options={keywordOptions}
              value={draft.keyword_ids}
              loading={keywords.isPending}
              truncated={keywordsTruncated}
              emptyText={t("filtering.keyword_groups.no_keywords")}
              onChange={(ids) =>
                setDraft((d) => ({
                  ...d,
                  keyword_ids: ids,
                  min_matches: Math.min(Math.max(2, d.min_matches), Math.max(2, ids.length)),
                }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t("filtering.fields.min_matches")}
              hint={t("filtering.keyword_groups.min_matches_hint")}
              errors={errors.fields.min_matches}
            >
              <NumberInput
                value={draft.min_matches}
                min={2}
                max={Math.max(2, draft.keyword_ids.length)}
                onChange={(v) => setDraft((d) => ({ ...d, min_matches: v }))}
              />
            </Field>
            <Field
              label={t("filtering.fields.proximity_window")}
              hint={t("filtering.keyword_groups.proximity_hint")}
              errors={errors.fields.proximity_window}
            >
              <NumberInput
                value={draft.proximity_window}
                min={0}
                onChange={(v) => setDraft((d) => ({ ...d, proximity_window: v }))}
              />
            </Field>
          </div>
          <Field
            label={t("filtering.fields.description")}
            htmlFor="kg-desc"
            errors={errors.fields.description}
          >
            <Textarea
              id="kg-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
          <SwitchField
            id="kg-active"
            label={t("filtering.common.active")}
            checked={draft.is_active}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
            errors={errors.fields.is_active}
          />
        </>
      )}
    />
  );
}
