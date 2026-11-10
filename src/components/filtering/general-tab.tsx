import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateFilteringProfile } from "@/lib/api/hooks/use-filtering";
import { fieldErrorsOf, splitFieldErrors, type SplitFieldErrors } from "@/lib/filtering/errors";
import {
  HITL_OFF_MAX_THRESHOLD,
  profilePatch,
  profileToDraft,
  type ProfileDraft,
} from "@/lib/filtering/payload";
import type { FilteringProfile } from "@/types/filtering";

import { Field, FormAlert, MultiSelectList, SelectField, SwitchField } from "./shared";
import { useAiModelOptions, useAttachmentOptions, useLanguageOptions } from "./use-catalog-options";
import { useErrorToast } from "./use-error-toast";

const INLINE_FIELDS = [
  "title",
  "description",
  "context",
  "general_threshold",
  "ai_model_id",
  "keyword_filtering_enabled",
  "codename_filtering_enabled",
  "label_filtering_enabled",
  "rewrite_enabled",
  "hitl_enabled",
  "deep_scan_enabled",
  "language_ids",
  "attachment_ids",
] as const;

const FLAGS = [
  "keyword_filtering_enabled",
  "codename_filtering_enabled",
  "label_filtering_enabled",
  "rewrite_enabled",
  "hitl_enabled",
  "deep_scan_enabled",
] as const;

export function GeneralTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const update = useUpdateFilteringProfile();
  const languages = useLanguageOptions();
  const attachments = useAttachmentOptions();
  const models = useAiModelOptions();

  const [draft, setDraft] = useState<ProfileDraft>(() => profileToDraft(profile));
  const [errors, setErrors] = useState<SplitFieldErrors>(splitFieldErrors(null));

  // Re-seed from the server copy when another profile is shown, or when it
  // was refetched (e.g. after Make primary) while there are no local edits.
  // Unsaved edits survive a refetch of the same profile.
  const [base, setBase] = useState(profile);
  if (profile !== base) {
    if (profile.id !== base.id || Object.keys(profilePatch(base, draft)).length === 0) {
      setDraft(profileToDraft(profile));
      setErrors(splitFieldErrors(null));
    }
    setBase(profile);
  }

  const patch = useMemo(() => profilePatch(profile, draft), [profile, draft]);
  const dirty = Object.keys(patch).length > 0;
  const maxThreshold = draft.hitl_enabled ? 100 : HITL_OFF_MAX_THRESHOLD;

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((d) => {
      const next = { ...d, [key]: value };
      // Mirrors the server: without HITL the threshold is capped at 80.
      if (key === "hitl_enabled" && !value && next.general_threshold > HITL_OFF_MAX_THRESHOLD) {
        next.general_threshold = HITL_OFF_MAX_THRESHOLD;
      }
      return next;
    });

  const save = async () => {
    if (!draft.title.trim()) {
      setErrors(splitFieldErrors({ title: [t("filtering.validation.required")] }));
      return;
    }
    try {
      const updated = await update.mutateAsync({ id: profile.id, body: patch });
      // Adopt the server's version, which may normalise values.
      setDraft(profileToDraft(updated));
      setBase(updated);
      setErrors(splitFieldErrors(null));
      toast.success(t("filtering.common.saved"));
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, INLINE_FIELDS);
    }
  };

  const e = errors.fields;
  return (
    <form
      className="space-y-6"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <FormAlert messages={errors.general} />

      <section className="grid gap-4 md:grid-cols-2">
        <Field label={t("filtering.fields.title")} htmlFor="gp-title" errors={e.title}>
          <Input
            id="gp-title"
            maxLength={255}
            value={draft.title}
            onChange={(ev) => set("title", ev.target.value)}
            aria-invalid={Boolean(e.title)}
          />
        </Field>
        <Field label={t("filtering.fields.ai_model")} errors={e.ai_model_id}>
          <SelectField
            value={draft.ai_model_id}
            onChange={(v) => set("ai_model_id", v)}
            options={models.options}
            placeholder={models.isLoading ? t("common.loading") : t("filtering.general.pick_model")}
          />
        </Field>
        <Field
          label={t("filtering.fields.description")}
          htmlFor="gp-desc"
          errors={e.description}
          className="md:col-span-2"
        >
          <Textarea
            id="gp-desc"
            rows={2}
            maxLength={2000}
            value={draft.description}
            onChange={(ev) => set("description", ev.target.value)}
          />
        </Field>
        <Field
          label={t("filtering.fields.context")}
          htmlFor="gp-context"
          hint={t("filtering.general.context_hint")}
          errors={e.context}
          className="md:col-span-2"
        >
          <Textarea
            id="gp-context"
            rows={4}
            maxLength={10000}
            value={draft.context}
            onChange={(ev) => set("context", ev.target.value)}
          />
        </Field>
        <Field
          label={t("filtering.fields.general_threshold")}
          hint={t("filtering.common.threshold_hint", { max: maxThreshold })}
          errors={e.general_threshold}
        >
          <NumberInput
            value={draft.general_threshold}
            min={20}
            max={maxThreshold}
            onChange={(v) => set("general_threshold", v)}
          />
        </Field>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">{t("filtering.general.features")}</h4>
        <div className="grid gap-2 md:grid-cols-2">
          {FLAGS.map((flag) => (
            <SwitchField
              key={flag}
              id={`gp-${flag}`}
              label={t(`filtering.fields.${flag}`)}
              description={t(`filtering.general.${flag}_hint`)}
              checked={draft[flag]}
              onCheckedChange={(v) => set(flag, v)}
              errors={e[flag]}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Field label={t("filtering.fields.languages")} errors={e.language_ids}>
          <MultiSelectList
            options={languages.options}
            value={draft.language_ids}
            loading={languages.isLoading}
            truncated={languages.truncated}
            onChange={(ids) => set("language_ids", ids)}
          />
        </Field>
        <Field label={t("filtering.fields.attachments")} errors={e.attachment_ids}>
          <MultiSelectList
            options={attachments.options}
            value={draft.attachment_ids}
            loading={attachments.isLoading}
            truncated={attachments.truncated}
            onChange={(ids) => set("attachment_ids", ids)}
          />
        </Field>
      </section>

      <div className="bg-background sticky bottom-0 flex items-center justify-end gap-2 border-t py-3">
        {dirty && (
          <span className="text-muted-foreground mr-auto text-xs">
            {t("filtering.general.unsaved", { count: Object.keys(patch).length })}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={!dirty || update.isPending}
          onClick={() => {
            setDraft(profileToDraft(profile));
            setErrors(splitFieldErrors(null));
          }}
        >
          <RotateCcw className="size-4" />
          {t("filtering.general.reset")}
        </Button>
        <Button type="submit" className="gap-1.5" disabled={!dirty || update.isPending}>
          {update.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
