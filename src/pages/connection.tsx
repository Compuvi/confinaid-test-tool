import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getErrorMessage,
  useClearCredentials,
  useSaveCredentials,
  useStoredCredentials,
} from "@/lib/api";

const KNOWN_ENV_VALUES = ["https://api.confinaid.com", "https://beta-api.confinaid.com"] as const;

function buildSchema(t: (k: string) => string) {
  return z.object({
    profileName: z.string().trim().min(1, t("connection.error_profile_required")),
    apiBaseUrl: z.url(t("connection.error_url_invalid")),
    clientId: z.string().trim().min(1, t("connection.error_client_id_required")),
    apiSecretKey: z.string().trim().min(1, t("connection.error_secret_required")),
  });
}

type FormValues = {
  profileName: string;
  apiBaseUrl: string;
  clientId: string;
  apiSecretKey: string;
};

export function ConnectionPage() {
  const { t } = useTranslation();
  const stored = useStoredCredentials();
  const save = useSaveCredentials();
  const clear = useClearCredentials();

  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(t)),
    defaultValues: {
      profileName: "default",
      apiBaseUrl: import.meta.env.VITE_DEFAULT_API_BASE_URL ?? "https://api.confinaid.com",
      clientId: "",
      apiSecretKey: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const profile = await save.mutateAsync(values);
      form.setValue("apiSecretKey", "");
      toast.success(t("connection.saved_toast", { name: profile.profileName }));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  });

  const onClear = async () => {
    try {
      await clear.mutateAsync();
      form.reset({ ...form.getValues(), clientId: "", apiSecretKey: "" });
      toast.success(t("connection.cleared_toast"));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const knownEnvs = [
    { label: t("connection.env_production"), value: KNOWN_ENV_VALUES[0] },
    { label: t("connection.env_beta"), value: KNOWN_ENV_VALUES[1] },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("connection.title")}</CardTitle>
          <CardDescription>{t("connection.description")}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <Field
              id="profileName"
              label={t("connection.profile_name")}
              placeholder="default"
              error={form.formState.errors.profileName?.message}
              {...form.register("profileName")}
            />

            {/* Environment quick-picker */}
            <div className="space-y-2">
              <Label>{t("connection.env_label")}</Label>
              <Select
                value={
                  knownEnvs.find((e) => e.value === form.watch("apiBaseUrl"))?.value ?? "__custom__"
                }
                onValueChange={(val) => {
                  if (val !== "__custom__")
                    form.setValue("apiBaseUrl", val, { shouldValidate: true });
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
            </div>

            <Field
              id="apiBaseUrl"
              label={t("connection.api_base_url")}
              placeholder="https://api.confinaid.com"
              error={form.formState.errors.apiBaseUrl?.message}
              {...form.register("apiBaseUrl")}
            />
            <Field
              id="clientId"
              label={t("connection.client_id")}
              placeholder="your-client-id"
              error={form.formState.errors.clientId?.message}
              {...form.register("clientId")}
            />
            <Field
              id="apiSecretKey"
              label={t("connection.api_secret_key")}
              type="password"
              autoComplete="off"
              placeholder="••••••••••••••••"
              error={form.formState.errors.apiSecretKey?.message}
              {...form.register("apiSecretKey")}
            />
          </CardContent>
          <CardFooter className="mt-6 justify-end gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("connection.save_credentials")}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            {t("connection.stored_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stored.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : stored.data ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("connection.stored_profile")}</dt>
              <dd className="font-mono">{stored.data.profileName}</dd>
              <dt className="text-muted-foreground">{t("connection.stored_endpoint")}</dt>
              <dd className="truncate font-mono">{stored.data.apiBaseUrl}</dd>
              <dt className="text-muted-foreground">{t("connection.stored_client_id")}</dt>
              <dd className="font-mono">{stored.data.clientId || "—"}</dd>
              <dt className="text-muted-foreground">{t("connection.stored_secret")}</dt>
              <dd className="flex items-center gap-2 font-mono">
                <KeyRound className="text-muted-foreground size-3.5" />
                {stored.data.hasSecret
                  ? `••••${stored.data.secretHint ?? "••••"}`
                  : t("connection.not_stored")}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{t("connection.stored_empty")}</p>
          )}
        </CardContent>
        {stored.data && (
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={onClear} disabled={clear.isPending}>
              {clear.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("connection.clear_credentials")}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

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
