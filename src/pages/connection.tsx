import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  getErrorMessage,
  useClearCredentials,
  useSaveCredentials,
  useStoredCredentials,
} from "@/lib/api";

const schema = z.object({
  profileName: z.string().trim().min(1, "Profile name is required"),
  apiBaseUrl: z.url("Enter a full URL, including https://"),
  clientId: z.string().trim().min(1, "Client ID is required"),
  apiSecretKey: z.string().trim().min(1, "API secret key is required"),
});

type FormValues = z.infer<typeof schema>;

export function ConnectionPage() {
  const stored = useStoredCredentials();
  const save = useSaveCredentials();
  const clear = useClearCredentials();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      profileName: "default",
      apiBaseUrl: import.meta.env.VITE_DEFAULT_API_BASE_URL ?? "https://beta-api.confinaid.com",
      clientId: "",
      apiSecretKey: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const profile = await save.mutateAsync(values);
      // The secret is now in the keychain; drop it from the form state so it
      // is not sitting in the renderer's memory or a devtools snapshot.
      form.setValue("apiSecretKey", "");
      toast.success(`Saved profile "${profile.profileName}"`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  });

  const onClear = async () => {
    try {
      await clear.mutateAsync();
      form.reset({ ...form.getValues(), clientId: "", apiSecretKey: "" });
      toast.success("Credentials removed from the keychain");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API credentials</CardTitle>
          <CardDescription>
            The client ID and endpoint are saved to a config file. The secret key goes to your OS
            keychain and is never returned to this window.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <Field
              id="profileName"
              label="Profile name"
              placeholder="default"
              error={form.formState.errors.profileName?.message}
              {...form.register("profileName")}
            />
            <Field
              id="apiBaseUrl"
              label="API base URL"
              placeholder="https://beta-api.confinaid.com"
              error={form.formState.errors.apiBaseUrl?.message}
              {...form.register("apiBaseUrl")}
            />
            <Field
              id="clientId"
              label="Client ID"
              placeholder="your-client-id"
              error={form.formState.errors.clientId?.message}
              {...form.register("clientId")}
            />
            <Field
              id="apiSecretKey"
              label="API secret key"
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
              Save credentials
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            Stored profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stored.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : stored.data ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Profile</dt>
              <dd className="font-mono">{stored.data.profileName}</dd>
              <dt className="text-muted-foreground">Endpoint</dt>
              <dd className="truncate font-mono">{stored.data.apiBaseUrl}</dd>
              <dt className="text-muted-foreground">Client ID</dt>
              <dd className="font-mono">{stored.data.clientId || "—"}</dd>
              <dt className="text-muted-foreground">Secret key</dt>
              <dd className="flex items-center gap-2 font-mono">
                <KeyRound className="text-muted-foreground size-3.5" />
                {stored.data.hasSecret ? `••••${stored.data.secretHint ?? "••••"}` : "Not stored"}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              No profile saved yet. Fill in the form above to get started.
            </p>
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
              Clear credentials
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
