import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCatalog } from "@/lib/api/hooks/use-filtering";
import {
  buildKeywordPayload,
  defaultKeywordDraft,
  keywordToDraft,
  patchFrom,
  type KeywordDraft,
} from "@/lib/filtering/payload";
import type { FilteringProfile, Keyword, KeywordWrite, MatchType } from "@/types/filtering";

import { CollectionTab } from "./collection-tab";
import { Field, SelectField, SwitchField } from "./shared";
import { useLanguageOptions } from "./use-catalog-options";

const MATCH_TYPES: MatchType[] = ["exact", "partial", "regex"];

type KeywordTemplate = {
  key?: string;
  title?: string;
  match_type?: string;
  regex_pattern?: string;
};

export function KeywordsTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const languages = useLanguageOptions();
  const templates = useCatalog<KeywordTemplate>("keyword-templates");
  const matchOptions = MATCH_TYPES.map((m) => ({
    value: m,
    label: t(`filtering.match_type.${m}`),
  }));

  return (
    <CollectionTab<Keyword, KeywordDraft, KeywordWrite>
      profile={profile}
      collection="keywords"
      title={t("filtering.tabs.keywords")}
      description={t("filtering.keywords.description")}
      searchable
      filters={[
        {
          key: "match_type",
          label: t("filtering.keywords.all_match_types"),
          options: matchOptions,
        },
        { key: "language", label: t("filtering.common.all_languages"), options: languages.options },
      ]}
      columns={[
        {
          header: t("filtering.fields.name"),
          cell: (k) => (
            <div className="min-w-0">
              <p className="truncate font-medium">{k.name}</p>
              {k.match_type === "regex" && k.regex_pattern && (
                <p className="text-muted-foreground truncate font-mono text-xs">
                  {k.regex_pattern}
                </p>
              )}
            </div>
          ),
          className: "max-w-[260px]",
        },
        {
          header: t("filtering.fields.match_type"),
          cell: (k) => <Badge variant="outline">{t(`filtering.match_type.${k.match_type}`)}</Badge>,
        },
        { header: t("filtering.fields.language"), cell: (k) => languages.labelOf(k.language_id) },
        {
          header: t("filtering.fields.description"),
          cell: (k) => <span className="text-muted-foreground line-clamp-1">{k.description}</span>,
          className: "max-w-[240px]",
        },
      ]}
      emptyDraft={defaultKeywordDraft}
      toDraft={keywordToDraft}
      buildCreate={buildKeywordPayload}
      buildPatch={(o, d) => patchFrom(buildKeywordPayload, o, d)}
      validate={(d) => {
        const e: Record<string, string[]> = {};
        if (!d.name.trim()) e.name = [t("filtering.validation.required")];
        if (d.match_type === "regex" && !d.regex_pattern.trim())
          e.regex_pattern = [t("filtering.validation.regex_required")];
        return e;
      }}
      inlineFields={[
        "name",
        "match_type",
        "regex_pattern",
        "language_id",
        "description",
        "is_active",
      ]}
      itemName={(k) => k.name}
      canDelete
      renderForm={({ draft, setDraft, errors, isNew }) => (
        <>
          {isNew && templates.data && templates.data.items.length > 0 && (
            <Field
              label={t("filtering.keywords.template")}
              hint={t("filtering.keywords.template_hint")}
            >
              <SelectField
                value=""
                allowNone
                noneLabel={t("filtering.keywords.template_none")}
                onChange={(key) => {
                  const tpl = templates.data?.items.find((x, i) => (x.key ?? String(i)) === key);
                  if (!tpl) return;
                  const mt = MATCH_TYPES.includes(tpl.match_type as MatchType)
                    ? (tpl.match_type as MatchType)
                    : draft.match_type;
                  setDraft((d) => ({
                    ...d,
                    name: d.name || (tpl.title ?? "").slice(0, 50),
                    match_type: mt,
                    regex_pattern: tpl.regex_pattern ?? d.regex_pattern,
                  }));
                }}
                options={templates.data.items.map((x, i) => ({
                  value: x.key ?? String(i),
                  label: x.title ?? x.key ?? String(i),
                }))}
              />
            </Field>
          )}
          <Field label={t("filtering.fields.name")} htmlFor="kw-name" errors={errors.fields.name}>
            <Input
              id="kw-name"
              maxLength={50}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              aria-invalid={Boolean(errors.fields.name)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("filtering.fields.match_type")} errors={errors.fields.match_type}>
              <SelectField
                value={draft.match_type}
                onChange={(v) => setDraft((d) => ({ ...d, match_type: v as MatchType }))}
                options={matchOptions}
              />
            </Field>
            <Field label={t("filtering.fields.language")} errors={errors.fields.language_id}>
              <SelectField
                value={draft.language_id}
                onChange={(v) => setDraft((d) => ({ ...d, language_id: v }))}
                options={languages.options}
                allowNone
                noneLabel={t("filtering.common.any_language")}
              />
            </Field>
          </div>
          {draft.match_type === "regex" && (
            <Field
              label={t("filtering.fields.regex_pattern")}
              htmlFor="kw-regex"
              hint={t("filtering.keywords.regex_hint")}
              errors={errors.fields.regex_pattern}
            >
              <Input
                id="kw-regex"
                className="font-mono"
                maxLength={500}
                value={draft.regex_pattern}
                onChange={(e) => setDraft((d) => ({ ...d, regex_pattern: e.target.value }))}
                aria-invalid={Boolean(errors.fields.regex_pattern)}
              />
            </Field>
          )}
          <Field
            label={t("filtering.fields.description")}
            htmlFor="kw-desc"
            errors={errors.fields.description}
          >
            <Textarea
              id="kw-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
          <SwitchField
            id="kw-active"
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
