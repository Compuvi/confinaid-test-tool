import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useAllKeywords } from "@/lib/api/hooks/use-filtering";
import {
  buildBypassRulePayload,
  bypassRuleToDraft,
  conditionField,
  defaultBypassRuleDraft,
  defaultConditionDraft,
  isUuid,
  patchFrom,
  type BypassRuleDraft,
  type ConditionDraft,
} from "@/lib/filtering/payload";
import type { SplitFieldErrors } from "@/lib/filtering/errors";
import {
  BYPASS_CONDITION_TYPES,
  BYPASS_STATUSES,
  BYPASS_TARGET_TYPES,
  type BypassConditionType,
  type BypassRule,
  type BypassRuleWrite,
  type BypassTargetType,
  type FilteringProfile,
  type MatchMode,
} from "@/types/filtering";
import { cn } from "@/lib/utils";

import { CollectionTab } from "./collection-tab";
import {
  Field,
  FieldError,
  MultiSelectList,
  SelectField,
  SwitchField,
  type Option,
} from "./shared";
import { truncationOf, useLabelOptions, type Truncation } from "./use-catalog-options";

export function BypassRulesTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const keywords = useAllKeywords(profile.id);
  const labels = useLabelOptions(profile);
  const keywordOptions = useMemo(
    () => (keywords.data?.items ?? []).map((k) => ({ value: k.id, label: k.name })),
    [keywords.data]
  );
  const targetOptions = BYPASS_TARGET_TYPES.map((v) => ({
    value: v,
    label: t(`filtering.target_type.${v}`),
  }));

  const conditionSummary = (r: BypassRule) =>
    r.conditions
      .map((c) => t(`filtering.condition_type.${c.condition_type}`))
      .join(
        r.match_mode === "all" ? ` ${t("filtering.bypass.and")} ` : ` ${t("filtering.bypass.or")} `
      );

  return (
    <CollectionTab<BypassRule, BypassRuleDraft, BypassRuleWrite>
      profile={profile}
      collection="bypass-rules"
      title={t("filtering.tabs.bypass_rules")}
      description={t("filtering.bypass.description")}
      searchable
      filters={[
        { key: "target_type", label: t("filtering.bypass.all_targets"), options: targetOptions },
      ]}
      columns={[
        {
          header: t("filtering.fields.title"),
          cell: (r) => <span className="font-medium">{r.title}</span>,
        },
        {
          header: t("filtering.fields.target"),
          cell: (r) => (
            <div className="space-y-0.5">
              <Badge variant="outline">{t(`filtering.target_type.${r.target_type}`)}</Badge>
              {r.target_id && (
                <p className="text-muted-foreground font-mono text-[10px]">{r.target_id}</p>
              )}
            </div>
          ),
        },
        {
          header: t("filtering.fields.conditions"),
          cell: (r) => (
            <span className="text-muted-foreground line-clamp-2 text-xs">
              {conditionSummary(r)}
            </span>
          ),
          className: "max-w-[300px]",
        },
      ]}
      emptyDraft={defaultBypassRuleDraft}
      toDraft={bypassRuleToDraft}
      buildCreate={buildBypassRulePayload}
      buildPatch={(o, d) => patchFrom(buildBypassRulePayload, o, d)}
      validate={(d) => {
        const e: Record<string, string[]> = {};
        if (!d.title.trim()) e.title = [t("filtering.validation.required")];
        if (d.target_type !== "company" && !isUuid(d.target_id))
          e.target_id = [t("filtering.validation.uuid")];
        if (d.conditions.length === 0) e.conditions = [t("filtering.validation.min_one_condition")];
        d.conditions.forEach((c, i) => {
          const field = conditionField(c.condition_type);
          if (field && field !== "threshold" && c[field].length === 0)
            e[`conditions[${i}].${field}`] = [t("filtering.validation.pick_one")];
        });
        return e;
      }}
      inlineFields={[
        "title",
        "description",
        "target_type",
        "target_id",
        "match_mode",
        "is_active",
        "conditions",
        "conditions[]",
      ]}
      itemName={(r) => r.title}
      canDelete
      dialogClassName="sm:max-w-2xl"
      renderForm={({ draft, setDraft, errors, setErrors }) => (
        <>
          <Field
            label={t("filtering.fields.title")}
            htmlFor="br-title"
            errors={errors.fields.title}
          >
            <Input
              id="br-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              aria-invalid={Boolean(errors.fields.title)}
            />
          </Field>
          <Field
            label={t("filtering.fields.description")}
            htmlFor="br-desc"
            errors={errors.fields.description}
          >
            <Textarea
              id="br-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("filtering.fields.target_type")} errors={errors.fields.target_type}>
              <SelectField
                value={draft.target_type}
                onChange={(v) => setDraft((d) => ({ ...d, target_type: v as BypassTargetType }))}
                options={targetOptions}
              />
            </Field>
            <Field label={t("filtering.fields.match_mode")} errors={errors.fields.match_mode}>
              <SelectField
                value={draft.match_mode}
                onChange={(v) => setDraft((d) => ({ ...d, match_mode: v as MatchMode }))}
                options={[
                  { value: "all", label: t("filtering.bypass.match_all") },
                  { value: "any", label: t("filtering.bypass.match_any") },
                ]}
              />
            </Field>
          </div>
          {draft.target_type !== "company" && (
            <Field
              label={t("filtering.fields.target_id")}
              htmlFor="br-target"
              hint={t("filtering.bypass.target_id_hint")}
              errors={errors.fields.target_id}
            >
              <Input
                id="br-target"
                className="font-mono"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={draft.target_id}
                onChange={(e) => setDraft((d) => ({ ...d, target_id: e.target.value }))}
                aria-invalid={Boolean(errors.fields.target_id)}
              />
            </Field>
          )}
          <SwitchField
            id="br-active"
            label={t("filtering.common.active")}
            checked={draft.is_active}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
            errors={errors.fields.is_active}
          />
          <ConditionsEditor
            conditions={draft.conditions}
            onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
            onRemoved={(index) =>
              setErrors((e) => ({ ...e, conditions: dropConditionErrors(e.conditions, index) }))
            }
            errors={errors}
            keywordOptions={keywordOptions}
            keywordsLoading={keywords.isPending}
            keywordsTruncated={truncationOf(keywords.data)}
            labelOptions={labels.options}
            labelsLoading={labels.isLoading}
            labelsTruncated={labels.truncated}
            regionName={profile.region?.name ?? null}
          />
        </>
      )}
    />
  );
}

/**
 * Condition errors are keyed by index (`conditions[2].x`). After removing
 * condition `index`, drop its errors and shift the later ones down so they
 * stay on the condition they were reported for.
 */
function dropConditionErrors(
  errors: SplitFieldErrors["conditions"],
  index: number
): SplitFieldErrors["conditions"] {
  const out: SplitFieldErrors["conditions"] = {};
  for (const [k, v] of Object.entries(errors)) {
    const i = Number(k);
    if (i < index) out[i] = v;
    else if (i > index) out[i - 1] = v;
  }
  return out;
}

function ConditionsEditor({
  conditions,
  onChange,
  onRemoved,
  errors,
  keywordOptions,
  keywordsLoading,
  keywordsTruncated,
  labelOptions,
  labelsLoading,
  labelsTruncated,
  regionName,
}: {
  conditions: ConditionDraft[];
  onChange: (c: ConditionDraft[]) => void;
  onRemoved: (index: number) => void;
  errors: SplitFieldErrors;
  keywordOptions: Option[];
  keywordsLoading: boolean;
  keywordsTruncated: Truncation;
  labelOptions: Option[];
  labelsLoading: boolean;
  labelsTruncated: Truncation;
  regionName: string | null;
}) {
  const { t } = useTranslation();
  const typeOptions = BYPASS_CONDITION_TYPES.map((v) => ({
    value: v,
    label: t(`filtering.condition_type.${v}`),
  }));
  const set = (i: number, patch: Partial<ConditionDraft>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("filtering.fields.conditions")}</p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="gap-1"
          onClick={() => onChange([...conditions, defaultConditionDraft()])}
        >
          <Plus />
          {t("filtering.bypass.add_condition")}
        </Button>
      </div>
      <FieldError messages={errors.fields.conditions} />
      {conditions.map((c, i) => {
        const field = conditionField(c.condition_type);
        const ce = errors.conditions[i] ?? {};
        const hasError = Object.keys(ce).length > 0;
        return (
          <div
            key={c.key}
            className={cn("space-y-2 rounded-md border p-3", hasError && "border-destructive/60")}
          >
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground mt-2 w-5 shrink-0 text-xs tabular-nums">
                {i + 1}.
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <SelectField
                  value={c.condition_type}
                  onChange={(v) => set(i, { condition_type: v as BypassConditionType })}
                  options={typeOptions}
                />
                <FieldError messages={ce.condition_type} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hover:text-destructive"
                onClick={() => {
                  onChange(conditions.filter((_, j) => j !== i));
                  onRemoved(i);
                }}
                aria-label={t("filtering.bypass.remove_condition")}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="pl-7">
              {field === "threshold" && (
                <Field
                  label={t("filtering.fields.threshold")}
                  hint={t("filtering.bypass.threshold_hint")}
                  errors={ce.threshold}
                >
                  <NumberInput
                    value={c.threshold}
                    min={0}
                    max={100}
                    onChange={(v) => set(i, { threshold: v })}
                  />
                </Field>
              )}
              {field === "keyword_ids" && (
                <Field label={t("filtering.tabs.keywords")} errors={ce.keyword_ids}>
                  <MultiSelectList
                    options={keywordOptions}
                    value={c.keyword_ids}
                    loading={keywordsLoading}
                    truncated={keywordsTruncated}
                    emptyText={t("filtering.keyword_groups.no_keywords")}
                    onChange={(ids) => set(i, { keyword_ids: ids })}
                  />
                </Field>
              )}
              {field === "label_ids" && (
                <Field
                  label={t("filtering.fields.labels")}
                  hint={
                    regionName
                      ? t("filtering.bypass.labels_region_hint", { region: regionName })
                      : undefined
                  }
                  errors={ce.label_ids}
                >
                  <MultiSelectList
                    options={labelOptions}
                    value={c.label_ids}
                    loading={labelsLoading}
                    truncated={labelsTruncated}
                    onChange={(ids) => set(i, { label_ids: ids })}
                  />
                </Field>
              )}
              {field === "statuses" && (
                <Field label={t("filtering.fields.statuses")} errors={ce.statuses}>
                  <div className="flex gap-2">
                    {BYPASS_STATUSES.map((s) => {
                      const on = c.statuses.includes(s);
                      return (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          aria-pressed={on}
                          onClick={() =>
                            set(i, {
                              statuses: on ? c.statuses.filter((x) => x !== s) : [...c.statuses, s],
                            })
                          }
                        >
                          {t(`filtering.status.${s}`)}
                        </Button>
                      );
                    })}
                  </div>
                </Field>
              )}
              <FieldError messages={ce._} />
              {/* Errors for fields this condition type does not show. */}
              <FieldError
                messages={Object.entries(ce)
                  .filter(([k]) => k !== "_" && k !== "condition_type" && k !== field)
                  .flatMap(([k, m]) => m.map((x) => `${k}: ${x}`))}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
