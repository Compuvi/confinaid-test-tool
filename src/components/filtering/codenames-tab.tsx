import { useTranslation } from "react-i18next";
import { MessageSquareCode } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCodenamePayload,
  codenameToDraft,
  defaultCodenameDraft,
  patchFrom,
  type CodenameDraft,
} from "@/lib/filtering/payload";
import type { Codename, CodenameWrite, FilteringProfile } from "@/types/filtering";

import { DangerZone, FlagSwitch } from "./chrome";
import { useProfileFieldSave } from "./chrome-utils";
import { CollectionTab } from "./collection-tab";
import { Field, SelectField, SwitchField } from "./shared";
import { useLanguageOptions } from "./use-catalog-options";

export function CodenamesTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const languages = useLanguageOptions();
  const { save } = useProfileFieldSave(profile);

  return (
    <CollectionTab<Codename, CodenameDraft, CodenameWrite>
      profile={profile}
      collection="codenames"
      icon={MessageSquareCode}
      accent="amber"
      footer={
        <DangerZone>
          <FlagSwitch
            id="codename-filtering"
            label={t("filtering.fields.codename_filtering_enabled")}
            description={t("filtering.general.codename_filtering_enabled_hint")}
            warning={t("filtering.danger.codename_off")}
            checked={profile.codename_filtering_enabled}
            onChange={(enabled) => save({ codename_filtering_enabled: enabled })}
          />
        </DangerZone>
      }
      title={t("filtering.tabs.codenames")}
      description={t("filtering.codenames.description")}
      searchable
      filters={[
        { key: "language", label: t("filtering.common.all_languages"), options: languages.options },
      ]}
      columns={[
        {
          header: t("filtering.fields.name"),
          cell: (c) => <span className="font-medium">{c.name}</span>,
        },
        {
          header: t("filtering.fields.original_name"),
          cell: (c) => c.original_name ?? "—",
        },
        { header: t("filtering.fields.language"), cell: (c) => languages.labelOf(c.language_id) },
        {
          header: t("filtering.fields.description"),
          cell: (c) => <span className="text-muted-foreground line-clamp-1">{c.description}</span>,
          className: "max-w-[240px]",
        },
      ]}
      emptyDraft={defaultCodenameDraft}
      toDraft={codenameToDraft}
      buildCreate={buildCodenamePayload}
      buildPatch={(o, d) => patchFrom(buildCodenamePayload, o, d)}
      validate={(d): Record<string, string[]> =>
        d.name.trim() ? {} : { name: [t("filtering.validation.required")] }
      }
      inlineFields={["name", "original_name", "language_id", "description", "is_active"]}
      itemName={(c) => c.name}
      canDelete
      renderForm={({ draft, setDraft, errors }) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("filtering.fields.name")} htmlFor="cn-name" errors={errors.fields.name}>
              <Input
                id="cn-name"
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                aria-invalid={Boolean(errors.fields.name)}
              />
            </Field>
            <Field
              label={t("filtering.fields.original_name")}
              htmlFor="cn-orig"
              errors={errors.fields.original_name}
            >
              <Input
                id="cn-orig"
                maxLength={100}
                value={draft.original_name}
                onChange={(e) => setDraft((d) => ({ ...d, original_name: e.target.value }))}
              />
            </Field>
          </div>
          <Field label={t("filtering.fields.language")} errors={errors.fields.language_id}>
            <SelectField
              value={draft.language_id}
              onChange={(v) => setDraft((d) => ({ ...d, language_id: v }))}
              options={languages.options}
              allowNone
              noneLabel={t("filtering.common.any_language")}
            />
          </Field>
          <Field
            label={t("filtering.fields.description")}
            htmlFor="cn-desc"
            errors={errors.fields.description}
          >
            <Textarea
              id="cn-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
          <SwitchField
            id="cn-active"
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
