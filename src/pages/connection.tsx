import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getErrorMessage,
  useDeleteProfile,
  useListProfiles,
  useSaveCredentials,
  useStoredCredentials,
  useSwitchProfile,
} from "@/lib/api";
import type { StoredCredentialProfile } from "@/types/credentials";
import { cn } from "@/lib/utils";

const KNOWN_ENV_VALUES = ["https://api.confinaid.com", "https://beta.confinaid.com"] as const;

// ── Zod schema ────────────────────────────────────────────────────────────────

type FormValues = {
  profileName: string;
  apiBaseUrl: string;
  clientId: string;
  apiSecretKey: string;
};

const baseSchema = z.object({
  profileName: z.string().trim().min(1, "Profile name is required"),
  apiBaseUrl: z.string().url("Enter a full URL, including https://"),
  clientId: z.string().trim().min(1, "Client ID is required"),
  apiSecretKey: z.string(),
});

// ── Page ──────────────────────────────────────────────────────────────────────

export function ConnectionPage() {
  const { t } = useTranslation();

  const stored = useStoredCredentials();
  const profiles = useListProfiles();
  const save = useSaveCredentials();
  const switchProfile = useSwitchProfile();
  const deleteProfile = useDeleteProfile();

  const [editing, setEditing] = useState<StoredCredentialProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  const requireSecret = isNew || !editing?.hasSecret;

  const form = useForm<FormValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      profileName: "",
      apiBaseUrl: import.meta.env.VITE_DEFAULT_API_BASE_URL ?? "https://api.confinaid.com",
      clientId: "",
      apiSecretKey: "",
    },
  });

  // Pre-select the active profile on first load.
  useEffect(() => {
    if (stored.data && !editing && !isNew) {
      setEditing(stored.data);
      form.reset({
        profileName: stored.data.profileName,
        apiBaseUrl: stored.data.apiBaseUrl,
        clientId: stored.data.clientId,
        apiSecretKey: "",
      });
    }
  }, [stored.data, editing, isNew, form]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectProfile = async (p: StoredCredentialProfile) => {
    try {
      await switchProfile.mutateAsync(p.profileName);
    } catch {
      /* profile might have been freshly saved; ignore */
    }
    setEditing(p);
    setIsNew(false);
    form.reset({
      profileName: p.profileName,
      apiBaseUrl: p.apiBaseUrl,
      clientId: p.clientId,
      apiSecretKey: "",
    });
  };

  const handleNewProfile = () => {
    setEditing(null);
    setIsNew(true);
    form.reset({
      profileName: "",
      apiBaseUrl: import.meta.env.VITE_DEFAULT_API_BASE_URL ?? "https://api.confinaid.com",
      clientId: "",
      apiSecretKey: "",
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    // Secret is required when creating a new profile or when no secret exists yet.
    if (requireSecret && !values.apiSecretKey.trim()) {
      form.setError("apiSecretKey", { message: t("connection.error_secret_required") });
      return;
    }
    try {
      const saved = await save.mutateAsync({
        profileName: values.profileName,
        apiBaseUrl: values.apiBaseUrl,
        clientId: values.clientId,
        apiSecretKey: values.apiSecretKey,
      });
      setEditing(saved);
      setIsNew(false);
      form.setValue("apiSecretKey", "");
      toast.success(t("connection.saved_toast", { name: saved.profileName }));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  });

  const onDelete = async () => {
    if (!editing) return;
    const name = editing.profileName;
    try {
      const newActive = await deleteProfile.mutateAsync(name);
      toast.success(t("connection.deleted_toast", { name }));
      if (newActive) {
        setEditing(newActive);
        form.reset({
          profileName: newActive.profileName,
          apiBaseUrl: newActive.apiBaseUrl,
          clientId: newActive.clientId,
          apiSecretKey: "",
        });
      } else {
        handleNewProfile();
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const knownEnvs = [
    { label: t("connection.env_production"), value: KNOWN_ENV_VALUES[0] },
    { label: t("connection.env_beta"), value: KNOWN_ENV_VALUES[1] },
  ];

  const activeProfileName = stored.data?.profileName;
  const profileList = profiles.data ?? [];

  const formTitle = isNew
    ? t("connection.create_profile_title")
    : editing
      ? t("connection.edit_profile_title", { name: editing.profileName })
      : t("connection.title");

  // ── Layout: left list | right form ───────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ── Left: profile list ───────────────────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">{t("connection.profiles_title")}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={handleNewProfile}
          >
            <Plus className="size-3" />
            {t("connection.new_profile")}
          </Button>
        </div>

        {/* Profile list */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0.5 p-2">
            {profiles.isPending ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : profileList.length === 0 ? (
              <p className="text-muted-foreground px-3 py-4 text-xs">
                {t("connection.no_profiles")}
              </p>
            ) : (
              profileList.map((p) => {
                const isActive = p.profileName === activeProfileName;
                const isSelected = !isNew && editing?.profileName === p.profileName;
                return (
                  <button
                    key={p.profileName}
                    type="button"
                    onClick={() => void handleSelectProfile(p)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                      "hover:bg-muted",
                      isSelected && "bg-muted"
                    )}
                  >
                    <UserRound className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{p.profileName}</span>
                        {isActive && (
                          <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                            {t("connection.active_badge")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground truncate text-xs">{p.clientId || "—"}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Right: editor form ───────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!editing && !isNew ? (
          /* Empty state when no profile exists */
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="bg-muted rounded-full p-4">
              <UserRound className="text-muted-foreground size-8" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t("connection.no_profiles")}</p>
            </div>
            <Button onClick={handleNewProfile} className="gap-1.5">
              <Plus className="size-4" />
              {t("connection.new_profile")}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex h-full flex-col">
            {/* Form header */}
            <div className="border-b px-6 py-4">
              <h2 className="text-base font-semibold">{formTitle}</h2>
              {isNew && (
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {t("connection.create_profile_description")}
                </p>
              )}
            </div>

            {/* Form fields */}
            <div className="flex-1 space-y-5 px-6 py-6">
              <Field
                id="profileName"
                label={t("connection.profile_name")}
                placeholder="default"
                error={form.formState.errors.profileName?.message}
                readOnly={!isNew && !!editing}
                className={!isNew && editing ? "bg-muted/40 cursor-default" : ""}
                {...form.register("profileName")}
              />

              {/* Environment / API base URL */}
              <div className="space-y-2">
                <Label>{t("connection.env_label")}</Label>
                <Select
                  value={
                    knownEnvs.find((e) => e.value === form.watch("apiBaseUrl"))?.value ??
                    "__custom__"
                  }
                  onValueChange={(val) => {
                    if (val !== "__custom__")
                      form.setValue("apiBaseUrl", val, { shouldValidate: true });
                    else form.setValue("apiBaseUrl", "", { shouldValidate: false });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("connection.env_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {knownEnvs.map((env) => (
                      <SelectItem key={env.value} value={env.value}>
                        {env.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">{t("connection.env_custom")}</SelectItem>
                  </SelectContent>
                </Select>
                {!knownEnvs.some((e) => e.value === form.watch("apiBaseUrl")) && (
                  <div className="pt-1">
                    <Input
                      id="apiBaseUrl"
                      placeholder="https://api.example.com"
                      aria-invalid={Boolean(form.formState.errors.apiBaseUrl)}
                      {...form.register("apiBaseUrl")}
                    />
                    {form.formState.errors.apiBaseUrl && (
                      <p className="text-destructive mt-1 text-xs">
                        {form.formState.errors.apiBaseUrl.message}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Field
                id="clientId"
                label={t("connection.client_id")}
                placeholder="your-client-id"
                error={form.formState.errors.clientId?.message}
                {...form.register("clientId")}
              />

              <div className="space-y-2">
                <Label htmlFor="apiSecretKey">{t("connection.api_secret_key")}</Label>
                <Input
                  id="apiSecretKey"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    editing && !isNew ? "••••••••••••••••" : t("connection.secret_placeholder")
                  }
                  aria-invalid={Boolean(form.formState.errors.apiSecretKey)}
                  {...form.register("apiSecretKey")}
                />
                {editing && !isNew && (
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <KeyRound className="size-3" />
                    {editing.hasSecret
                      ? t("connection.secret_hint_stored", {
                          hint: `••••${editing.secretHint ?? "••••"}`,
                        })
                      : t("connection.not_stored")}
                    {" · "}
                    {t("connection.secret_optional_hint")}
                  </p>
                )}
                {form.formState.errors.apiSecretKey && (
                  <p className="text-destructive text-xs">
                    {form.formState.errors.apiSecretKey.message}
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4">
              <Separator className="mb-4 hidden" />
              <div className="flex items-center justify-between">
                <div>
                  {!isNew && editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive gap-1.5"
                      disabled={deleteProfile.isPending}
                      onClick={() => void onDelete()}
                    >
                      {deleteProfile.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      {t("connection.delete_profile")}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {isNew && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsNew(false);
                        if (stored.data) {
                          setEditing(stored.data);
                          form.reset({
                            profileName: stored.data.profileName,
                            apiBaseUrl: stored.data.apiBaseUrl,
                            clientId: stored.data.clientId,
                            apiSecretKey: "",
                          });
                        } else {
                          setEditing(null);
                          form.reset();
                        }
                      }}
                    >
                      {t("connection.cancel")}
                    </Button>
                  )}
                  <Button type="submit" disabled={save.isPending} className="gap-1.5">
                    {save.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                    {t("connection.save_credentials")}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Field helper ──────────────────────────────────────────────────────────────

type FieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
};

function Field({ id, label, error, ...props }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={Boolean(error)} {...props} />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
