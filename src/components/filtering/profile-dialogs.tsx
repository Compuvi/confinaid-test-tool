import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  useCloneFilteringProfile,
  useCreateFilteringProfile,
  useDeleteFilteringProfile,
  useFilteringProfiles,
} from "@/lib/api/hooks/use-filtering";
import { fieldErrorsOf, splitFieldErrors, type SplitFieldErrors } from "@/lib/filtering/errors";
import { emptyToNull } from "@/lib/filtering/payload";
import type { FilteringProfile, FilteringProfileCreate } from "@/types/filtering";

import { ConfirmDialog, Field, FormAlert, SelectField } from "./shared";
import { useErrorToast } from "./use-error-toast";

type FormState = { title: string; description: string; cloneFrom: string };

function TitleDescriptionFields({
  state,
  setState,
  errors,
}: {
  state: FormState;
  setState: (fn: (s: FormState) => FormState) => void;
  errors: SplitFieldErrors;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("filtering.fields.title")} htmlFor="pf-title" errors={errors.fields.title}>
        <Input
          id="pf-title"
          autoFocus
          maxLength={255}
          value={state.title}
          onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          aria-invalid={Boolean(errors.fields.title)}
        />
      </Field>
      <Field
        label={t("filtering.fields.description")}
        htmlFor="pf-desc"
        errors={errors.fields.description}
      >
        <Textarea
          id="pf-desc"
          rows={3}
          maxLength={2000}
          value={state.description}
          onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
        />
      </Field>
    </>
  );
}

/** New profile, optionally starting from a copy of another (`clone_from`). */
export function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (p: FilteringProfile) => void;
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const create = useCreateFilteringProfile();
  const sources = useFilteringProfiles({ page: 1, pageSize: 100 });
  const [state, setState] = useState<FormState>({ title: "", description: "", cloneFrom: "" });
  const [errors, setErrors] = useState(splitFieldErrors(null));

  useEffect(() => {
    if (open) {
      setState({ title: "", description: "", cloneFrom: "" });
      setErrors(splitFieldErrors(null));
    }
  }, [open]);

  const submit = async () => {
    if (!state.title.trim()) {
      setErrors(splitFieldErrors({ title: [t("filtering.validation.required")] }));
      return;
    }
    const body: FilteringProfileCreate = {
      title: state.title.trim(),
      description: emptyToNull(state.description),
      ...(state.cloneFrom ? { clone_from: state.cloneFrom } : {}),
    };
    try {
      const created = await create.mutateAsync(body);
      toast.success(t("filtering.profiles.created", { title: created.title }));
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, ["title", "description", "clone_from"]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("filtering.profiles.new")}</DialogTitle>
          <DialogDescription>{t("filtering.profiles.new_description")}</DialogDescription>
        </DialogHeader>
        <form
          id="filtering-create-profile"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormAlert messages={errors.general} />
          <TitleDescriptionFields state={state} setState={setState} errors={errors} />
          <Field
            label={t("filtering.profiles.clone_from")}
            hint={t("filtering.profiles.clone_from_hint")}
            errors={errors.fields.clone_from}
          >
            <SelectField
              value={state.cloneFrom}
              onChange={(v) => setState((s) => ({ ...s, cloneFrom: v }))}
              allowNone
              noneLabel={t("filtering.profiles.clone_from_none")}
              options={(sources.data?.results ?? []).map((p) => ({ value: p.id, label: p.title }))}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="filtering-create-profile"
            disabled={create.isPending}
            className="gap-1.5"
          >
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("filtering.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloneProfileDialog({
  profile,
  onOpenChange,
  onCloned,
}: {
  profile: FilteringProfile | null;
  onOpenChange: (v: boolean) => void;
  onCloned: (p: FilteringProfile) => void;
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const clone = useCloneFilteringProfile();
  const [state, setState] = useState<FormState>({ title: "", description: "", cloneFrom: "" });
  const [errors, setErrors] = useState(splitFieldErrors(null));

  useEffect(() => {
    if (profile) {
      setState({
        title: t("filtering.profiles.copy_title", { title: profile.title }),
        description: profile.description ?? "",
        cloneFrom: "",
      });
      setErrors(splitFieldErrors(null));
    }
  }, [profile, t]);

  const submit = async () => {
    if (!profile) return;
    try {
      const created = await clone.mutateAsync({
        id: profile.id,
        body: {
          ...(state.title.trim() ? { title: state.title.trim() } : {}),
          description: emptyToNull(state.description),
        },
      });
      toast.success(t("filtering.profiles.cloned", { title: created.title }));
      onOpenChange(false);
      onCloned(created);
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, ["title", "description"]);
    }
  };

  return (
    <Dialog open={profile !== null} onOpenChange={(o) => !clone.isPending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("filtering.profiles.clone")}</DialogTitle>
          <DialogDescription>
            {t("filtering.profiles.clone_description", { title: profile?.title ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <form
          id="filtering-clone-profile"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormAlert messages={errors.general} />
          <TitleDescriptionFields state={state} setState={setState} errors={errors} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={clone.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="filtering-clone-profile"
            disabled={clone.isPending}
            className="gap-1.5"
          >
            {clone.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("filtering.profiles.clone")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmed delete; the primary profile cannot be deleted and says why. */
export function DeleteProfileDialog({
  profile,
  onOpenChange,
  onDeleted,
}: {
  profile: FilteringProfile | null;
  onOpenChange: (v: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const remove = useDeleteFilteringProfile();
  const isPrimary = profile?.is_primary ?? false;

  return (
    <ConfirmDialog
      open={profile !== null}
      onOpenChange={onOpenChange}
      title={t("filtering.profiles.delete_title")}
      description={
        isPrimary
          ? t("filtering.profiles.delete_primary_body", { title: profile?.title ?? "" })
          : t("filtering.profiles.delete_body", { title: profile?.title ?? "" })
      }
      confirmLabel={t("filtering.common.delete")}
      pending={remove.isPending}
      confirmDisabled={isPrimary}
      onConfirm={() => {
        if (!profile || isPrimary) return;
        remove.mutate(profile.id, {
          onSuccess: () => {
            toast.success(t("filtering.profiles.deleted", { title: profile.title }));
            onOpenChange(false);
            onDeleted(profile.id);
          },
          onError: (err) => showError(err),
        });
      }}
    />
  );
}
