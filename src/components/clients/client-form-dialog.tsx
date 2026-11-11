/**
 * Create / edit dialog for one client.
 *
 * The filtering profile select lists `/v1/filtering-profiles`, which needs
 * `filtering_read`. A credential with only the clients scopes cannot list
 * profiles, so the select gives way to a plain id field: the current id is
 * kept, a known id can be pasted, or the field cleared.
 */

import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SelectField, SwitchField } from "@/components/filtering/shared";
import { useFilteringProfiles } from "@/lib/api/hooks/use-filtering";
import { CLIENT_LIMITS, type ClientDraft } from "@/lib/clients/payload";
import { isScopeError, type SplitFieldErrors } from "@/lib/filtering/errors";
import type { Client } from "@/types/clients";

export function ClientFormDialog({
  open,
  editing,
  draft,
  setDraft,
  errors,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** The client being edited, or null when creating. */
  editing: Client | null;
  draft: ClientDraft;
  setDraft: (fn: (d: ClientDraft) => ClientDraft) => void;
  errors: SplitFieldErrors;
  pending: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("clients.form.edit_title") : t("clients.form.new_title")}
          </DialogTitle>
          <DialogDescription>{t("clients.form.description")}</DialogDescription>
        </DialogHeader>
        <form
          id="clients-form"
          className="max-h-[65vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <FormAlert messages={errors.general} />
          {editing?.logo_url && (
            <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
              <img
                src={editing.logo_url}
                alt={t("clients.fields.logo_alt", { name: editing.name })}
                className="size-10 rounded object-contain"
              />
              <p className="text-muted-foreground text-xs">{t("clients.fields.logo_hint")}</p>
            </div>
          )}
          <Field label={t("clients.fields.name")} htmlFor="client-name" errors={errors.fields.name}>
            <Input
              id="client-name"
              autoFocus
              maxLength={CLIENT_LIMITS.name}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              aria-invalid={Boolean(errors.fields.name)}
            />
          </Field>
          <Field
            label={t("clients.fields.description")}
            htmlFor="client-description"
            errors={errors.fields.description}
          >
            <Textarea
              id="client-description"
              rows={3}
              maxLength={CLIENT_LIMITS.description}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
          <Field
            label={t("clients.fields.external_id")}
            htmlFor="client-external-id"
            hint={t("clients.fields.external_id_hint")}
            errors={errors.fields.external_id}
          >
            <Input
              id="client-external-id"
              maxLength={CLIENT_LIMITS.externalId}
              value={draft.external_id}
              onChange={(e) => setDraft((d) => ({ ...d, external_id: e.target.value }))}
              aria-invalid={Boolean(errors.fields.external_id)}
              className="font-mono"
            />
          </Field>
          <ProfileField
            value={draft.filtering_profile_id}
            currentTitle={
              editing && editing.filtering_profile_id === draft.filtering_profile_id
                ? editing.filtering_profile_title
                : ""
            }
            onChange={(v) => setDraft((d) => ({ ...d, filtering_profile_id: v }))}
            errors={errors.fields.filtering_profile_id}
          />
          <SwitchField
            id="client-active"
            label={t("clients.fields.is_active")}
            description={t("clients.fields.is_active_hint")}
            checked={draft.is_active}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
            errors={errors.fields.is_active}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="clients-form" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? t("common.save") : t("filtering.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileField({
  value,
  currentTitle,
  onChange,
  errors,
}: {
  value: string;
  currentTitle: string;
  onChange: (v: string) => void;
  errors?: string[];
}) {
  const { t } = useTranslation();
  const profiles = useFilteringProfiles({ page: 1, pageSize: 100, ordering: "title" });

  if (profiles.isError) {
    // Most often 403: the credential has no filtering_read. Any other failure
    // gets the same fallback so the client can still be saved.
    return (
      <Field
        label={t("clients.fields.filtering_profile")}
        htmlFor="client-profile-id"
        hint={
          isScopeError(profiles.error)
            ? t("clients.fields.profile_no_scope")
            : t("clients.fields.profile_load_failed")
        }
        errors={errors}
      >
        <div className="flex gap-2">
          <Input
            id="client-profile-id"
            value={value}
            placeholder={t("clients.fields.profile_id_placeholder")}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(errors)}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange("")}
            disabled={value === ""}
          >
            {t("clients.fields.profile_clear")}
          </Button>
        </div>
        {currentTitle && (
          <p className="text-muted-foreground text-xs">
            {t("clients.fields.profile_current", { title: currentTitle })}
          </p>
        )}
      </Field>
    );
  }

  const options = (profiles.data?.results ?? []).map((p) => ({
    value: p.id,
    label: p.is_primary ? `${p.title} · ${t("filtering.profiles.primary")}` : p.title,
  }));
  // Keep a value outside the loaded page selectable instead of dropping it.
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: currentTitle || value });
  }

  return (
    <Field
      label={t("clients.fields.filtering_profile")}
      htmlFor="client-profile"
      hint={t("clients.fields.profile_hint")}
      errors={errors}
    >
      <SelectField
        id="client-profile"
        value={value}
        onChange={onChange}
        allowNone
        noneLabel={t("clients.fields.profile_none")}
        options={options}
        disabled={profiles.isPending}
      />
    </Field>
  );
}
