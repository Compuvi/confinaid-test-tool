import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, FileText, Loader2, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useSetPrimaryFilteringProfile,
  useUpdateFilteringProfile,
} from "@/lib/api/hooks/use-filtering";
import { fieldErrorsOf, splitFieldErrors, type SplitFieldErrors } from "@/lib/filtering/errors";
import { formatDateTime } from "@/lib/filtering/format";
import { profilePatch, profileToDraft } from "@/lib/filtering/payload";
import { cn } from "@/lib/utils";
import type { FilteringProfile } from "@/types/filtering";

import { ActivityTab } from "./activity-tab";
import { IconTile } from "./chrome";
import { Field, FormAlert } from "./shared";
import { useErrorToast } from "./use-error-toast";

const INLINE_FIELDS = ["title", "description"] as const;

/**
 * The web app's General tab: the profile's name and description on the left,
 * primary / clone / delete on the right, and the change log underneath. The
 * risk, model and per-layer settings live on their own tabs.
 */
export function GeneralTab({
  profile,
  onClone,
  onDelete,
}: {
  profile: FilteringProfile;
  onClone: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const showError = useErrorToast();
  const update = useUpdateFilteringProfile();
  const setPrimary = useSetPrimaryFilteringProfile();

  const [title, setTitle] = useState(profile.title);
  const [description, setDescription] = useState(profile.description ?? "");
  const [errors, setErrors] = useState<SplitFieldErrors>(splitFieldErrors(null));

  const patch = useMemo(
    () => profilePatch(profile, { ...profileToDraft(profile), title, description }),
    [profile, title, description]
  );
  const dirty = Object.keys(patch).length > 0;

  // Re-seed from the server copy when it changes while there are no edits.
  const [base, setBase] = useState(profile);
  if (profile !== base) {
    if (!dirty) {
      setTitle(profile.title);
      setDescription(profile.description ?? "");
    }
    setBase(profile);
  }

  const reset = () => {
    setTitle(profile.title);
    setDescription(profile.description ?? "");
    setErrors(splitFieldErrors(null));
  };

  const save = async () => {
    if (!title.trim()) {
      setErrors(splitFieldErrors({ title: [t("filtering.validation.required")] }));
      return;
    }
    try {
      const updated = await update.mutateAsync({ id: profile.id, body: patch });
      setTitle(updated.title);
      setDescription(updated.description ?? "");
      setErrors(splitFieldErrors(null));
      toast.success(t("filtering.common.saved"));
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, INLINE_FIELDS);
    }
  };

  const makePrimary = async () => {
    try {
      await setPrimary.mutateAsync(profile.id);
      toast.success(t("filtering.profiles.now_primary", { title: profile.title }));
    } catch (err) {
      showError(err);
    }
  };

  const e = errors.fields;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="gap-0 py-0 lg:col-span-2">
          <CardHeader className="flex items-center gap-3 border-b py-4 [.border-b]:pb-4">
            <IconTile icon={FileText} />
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{t("filtering.general.details_title")}</CardTitle>
              <p className="text-muted-foreground text-xs">{t("filtering.general.details_desc")}</p>
            </div>
          </CardHeader>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            <CardContent className="space-y-4 py-5">
              <FormAlert messages={errors.general} />
              <Field label={`${t("filtering.fields.title")} *`} htmlFor="gp-title" errors={e.title}>
                <Input
                  id="gp-title"
                  maxLength={255}
                  value={title}
                  onChange={(ev) => setTitle(ev.target.value)}
                  aria-invalid={Boolean(e.title)}
                />
              </Field>
              <Field
                label={t("filtering.fields.description")}
                htmlFor="gp-desc"
                errors={e.description}
              >
                <Textarea
                  id="gp-desc"
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(ev) => setDescription(ev.target.value)}
                />
              </Field>
            </CardContent>
            <CardFooter className="flex flex-wrap items-center gap-3 border-t py-3 [.border-t]:pt-3">
              <div className="text-muted-foreground mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {dirty && (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <span className="size-1.5 rounded-full bg-current" />
                    {t("filtering.general.unsaved_short")}
                  </span>
                )}
                <span>
                  {t("filtering.common.created_at", {
                    when: formatDateTime(profile.created_at, i18n.language),
                  })}
                </span>
                <span>
                  {t("filtering.common.updated_at", {
                    when: formatDateTime(profile.updated_at, i18n.language),
                  })}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || update.isPending}
                onClick={reset}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" className="gap-1.5" disabled={!dirty || update.isPending}>
                {update.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {t("common.save")}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card className="flex flex-col gap-0 py-0">
          <CardHeader className="flex items-center gap-3 border-b py-4 [.border-b]:pb-4">
            <IconTile icon={Star} />
            <CardTitle className="text-base">{t("filtering.general.primary_title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 py-5">
            {profile.is_primary ? (
              <div className="border-primary/30 bg-primary/5 rounded-md border p-3 text-sm">
                <p className="text-primary flex items-center gap-1.5 font-medium">
                  <Star className="size-3.5" />
                  {t("filtering.profiles.primary")}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t("filtering.general.primary_current")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {t("filtering.general.primary_desc")}
                </p>
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  disabled={setPrimary.isPending}
                  onClick={() => void makePrimary()}
                >
                  {setPrimary.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Star className="size-4" />
                  )}
                  {t("filtering.profiles.set_primary")}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                {t("filtering.profiles.clone_description", { title: profile.title })}
              </p>
              <Button variant="outline" className="w-full gap-1.5" onClick={onClone}>
                <Copy className="size-4" />
                {t("filtering.profiles.clone")}
              </Button>
            </div>

            <div className="mt-auto space-y-2 border-t pt-4">
              <p
                className={cn(
                  "text-xs",
                  profile.is_primary ? "text-muted-foreground" : "text-destructive/80"
                )}
              >
                {profile.is_primary
                  ? t("filtering.profiles.primary_locked_hint")
                  : t("filtering.general.delete_hint")}
              </p>
              {/* Not disabled for the primary, unlike the web app: the test tool
                  exists to exercise the API, including its 409
                  primary_profile_locked answer (the dialog says so first). */}
              <Button variant="destructive" className="w-full gap-1.5" onClick={onDelete}>
                <Trash2 className="size-4" />
                {t("filtering.common.delete")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <ActivityTab profile={profile} />
    </div>
  );
}
