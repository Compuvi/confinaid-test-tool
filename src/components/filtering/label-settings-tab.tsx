import { useTranslation } from "react-i18next";
import { MapPin, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildLabelSettingPayload,
  defaultLabelSettingDraft,
  HITL_OFF_MAX_THRESHOLD,
  labelSettingToDraft,
  patchFrom,
  type LabelSettingDraft,
} from "@/lib/filtering/payload";
import type { FilteringProfile, LabelSetting, LabelSettingCreate } from "@/types/filtering";

import { DangerZone, FlagSwitch } from "./chrome";
import { useProfileFieldSave } from "./chrome-utils";
import { CollectionTab } from "./collection-tab";
import { Field, SelectField, SwitchField, TruncatedNotice } from "./shared";
import { useLabelConditions, useLabelOptions } from "./use-catalog-options";

export function LabelSettingsTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const labels = useLabelOptions(profile);
  const conditions = useLabelConditions();
  const { save } = useProfileFieldSave(profile);
  const maxThreshold = profile.hitl_enabled ? 100 : HITL_OFF_MAX_THRESHOLD;

  const flags = (s: LabelSetting) =>
    [
      s.is_clean && t("filtering.fields.is_clean"),
      s.is_blocked && t("filtering.fields.is_blocked"),
      s.is_exempt && t("filtering.fields.is_exempt"),
      s.hitl_threshold_enabled && t("filtering.label_settings.hitl_band"),
    ].filter(Boolean) as string[];

  return (
    <CollectionTab<LabelSetting, LabelSettingDraft, LabelSettingCreate>
      profile={profile}
      collection="label-settings"
      icon={Tags}
      intro={
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <MapPin className="size-3.5" />
          {t("filtering.profiles.region")}:{" "}
          <span className="text-foreground font-medium">
            {profile.region?.name ?? t("filtering.profiles.no_region")}
          </span>
        </p>
      }
      footer={
        <DangerZone>
          <FlagSwitch
            id="label-filtering"
            label={t("filtering.fields.label_filtering_enabled")}
            description={t("filtering.general.label_filtering_enabled_hint")}
            warning={t("filtering.danger.label_off")}
            checked={profile.label_filtering_enabled}
            onChange={(enabled) => save({ label_filtering_enabled: enabled })}
          />
        </DangerZone>
      }
      title={t("filtering.tabs.labels")}
      description={
        profile.region
          ? t("filtering.label_settings.description_region", { region: profile.region.name })
          : t("filtering.label_settings.description")
      }
      filters={[
        { key: "labels", label: t("filtering.label_settings.all_labels"), options: labels.options },
      ]}
      columns={[
        {
          header: t("filtering.fields.label"),
          cell: (s) => <span className="font-medium">{labels.labelOf(s.label_id)}</span>,
          className: "max-w-[260px]",
        },
        { header: t("filtering.fields.threshold"), cell: (s) => s.threshold },
        {
          header: t("filtering.label_settings.flags"),
          cell: (s) => (
            <div className="flex flex-wrap gap-1">
              {flags(s).map((f) => (
                <Badge key={f} variant="outline">
                  {f}
                </Badge>
              ))}
            </div>
          ),
        },
        {
          header: t("filtering.label_settings.condition"),
          cell: (s) => {
            const matched = conditions.conditionsOf(s.label_id);
            return (
              <div className="space-y-0.5 text-xs">
                <p className={matched.length ? "" : "text-muted-foreground"}>
                  {matched.length
                    ? matched.map((c) => c.title).join(", ")
                    : t("filtering.label_settings.condition_none")}
                </p>
                {s.condition_status && (
                  <p className="text-muted-foreground">
                    {t("filtering.fields.condition_status")}: {s.condition_status}
                  </p>
                )}
              </div>
            );
          },
          className: "max-w-[260px]",
        },
      ]}
      emptyDraft={defaultLabelSettingDraft}
      toDraft={labelSettingToDraft}
      buildCreate={(d) => ({ label_id: d.label_id, ...buildLabelSettingPayload(d) })}
      buildPatch={(o, d) =>
        patchFrom(buildLabelSettingPayload, o, d) as Partial<LabelSettingCreate>
      }
      validate={(d, isNew): Record<string, string[]> =>
        isNew && !d.label_id ? { label_id: [t("filtering.validation.required")] } : {}
      }
      inlineFields={[
        "label_id",
        "threshold",
        "is_active",
        "is_clean",
        "is_blocked",
        "hitl_threshold_enabled",
        "hitl_threshold_min",
        "hitl_threshold_max",
        "exception_text",
        "is_exempt",
      ]}
      itemName={(s) => labels.labelOf(s.label_id)}
      canDelete={false}
      toolbarExtra={
        <>
          <span className="text-muted-foreground text-xs">
            {t("filtering.label_settings.no_delete")}
          </span>
          <TruncatedNotice truncated={labels.truncated} />
          <TruncatedNotice truncated={conditions.truncated} />
        </>
      }
      renderForm={({ draft, setDraft, errors, isNew }) => (
        <>
          <Field
            label={t("filtering.fields.label")}
            hint={isNew ? undefined : t("filtering.label_settings.label_fixed")}
            errors={errors.fields.label_id}
          >
            <SelectField
              value={draft.label_id}
              onChange={(v) => setDraft((d) => ({ ...d, label_id: v }))}
              options={labels.options}
              placeholder={
                labels.isLoading ? t("common.loading") : t("filtering.label_settings.pick_label")
              }
              disabled={!isNew}
            />
            {isNew && <TruncatedNotice truncated={labels.truncated} />}
          </Field>
          {conditions.conditionsOf(draft.label_id).length > 0 && (
            <div className="bg-muted/40 space-y-1.5 rounded-md border p-3 text-xs">
              <p className="font-medium">{t("filtering.label_settings.condition")}</p>
              {conditions.conditionsOf(draft.label_id).map((c) => (
                <div key={c.id}>
                  <p>{c.title}</p>
                  {c.description && <p className="text-muted-foreground">{c.description}</p>}
                </div>
              ))}
              <p className="text-muted-foreground">
                {t("filtering.label_settings.condition_hint")}
              </p>
            </div>
          )}
          <Field
            label={t("filtering.fields.threshold")}
            hint={t("filtering.common.threshold_hint", { max: maxThreshold })}
            errors={errors.fields.threshold}
          >
            <NumberInput
              value={draft.threshold}
              min={20}
              max={maxThreshold}
              onChange={(v) => setDraft((d) => ({ ...d, threshold: v }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <SwitchField
              id="ls-active"
              label={t("filtering.common.active")}
              checked={draft.is_active}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
              errors={errors.fields.is_active}
            />
            <SwitchField
              id="ls-clean"
              label={t("filtering.fields.is_clean")}
              checked={draft.is_clean}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_clean: v }))}
              errors={errors.fields.is_clean}
            />
            <SwitchField
              id="ls-blocked"
              label={t("filtering.fields.is_blocked")}
              checked={draft.is_blocked}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_blocked: v }))}
              errors={errors.fields.is_blocked}
            />
            <SwitchField
              id="ls-exempt"
              label={t("filtering.fields.is_exempt")}
              checked={draft.is_exempt}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_exempt: v }))}
              errors={errors.fields.is_exempt}
            />
          </div>
          <SwitchField
            id="ls-hitl"
            label={t("filtering.fields.hitl_threshold_enabled")}
            description={t("filtering.label_settings.hitl_band_hint")}
            checked={draft.hitl_threshold_enabled}
            onCheckedChange={(v) =>
              setDraft((d) => ({
                ...d,
                hitl_threshold_enabled: v,
                hitl_threshold_min: v ? (d.hitl_threshold_min ?? 40) : d.hitl_threshold_min,
                hitl_threshold_max: v ? (d.hitl_threshold_max ?? 70) : d.hitl_threshold_max,
              }))
            }
            errors={errors.fields.hitl_threshold_enabled}
          />
          {draft.hitl_threshold_enabled && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={t("filtering.fields.hitl_threshold_min")}
                errors={errors.fields.hitl_threshold_min}
              >
                <NumberInput
                  value={draft.hitl_threshold_min ?? 0}
                  min={0}
                  max={100}
                  onChange={(v) => setDraft((d) => ({ ...d, hitl_threshold_min: v }))}
                />
              </Field>
              <Field
                label={t("filtering.fields.hitl_threshold_max")}
                errors={errors.fields.hitl_threshold_max}
              >
                <NumberInput
                  value={draft.hitl_threshold_max ?? 0}
                  min={0}
                  max={100}
                  onChange={(v) => setDraft((d) => ({ ...d, hitl_threshold_max: v }))}
                />
              </Field>
            </div>
          )}
          <Field
            label={t("filtering.fields.exception_text")}
            htmlFor="ls-exc"
            errors={errors.fields.exception_text}
          >
            <Textarea
              id="ls-exc"
              rows={2}
              value={draft.exception_text}
              onChange={(e) => setDraft((d) => ({ ...d, exception_text: e.target.value }))}
            />
          </Field>
        </>
      )}
    />
  );
}
