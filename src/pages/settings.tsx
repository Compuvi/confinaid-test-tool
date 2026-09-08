import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRuntimeInfo } from "@/lib/api";
import { useTheme, type Theme } from "@/providers/theme-provider";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const runtime = useRuntimeInfo();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose a theme, or follow your operating system.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          {runtime.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : runtime.data ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">App version</dt>
              <dd className="font-mono">{runtime.data.appVersion}</dd>
              <dt className="text-muted-foreground">Tauri</dt>
              <dd className="font-mono">{runtime.data.tauriVersion}</dd>
              <dt className="text-muted-foreground">Platform</dt>
              <dd className="font-mono">
                {runtime.data.os} / {runtime.data.arch}
              </dd>
              <dt className="text-muted-foreground">Build</dt>
              <dd className="font-mono">{runtime.data.isDebug ? "debug" : "release"}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">Runtime information unavailable.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
