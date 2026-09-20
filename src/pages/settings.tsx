import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useRuntimeInfo } from "@/lib/api";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { useTheme, type Theme } from "@/providers/theme-provider";
import { useUiStore } from "@/stores/ui-store";

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const runtime = useRuntimeInfo();
  const { language, setLanguage, autoUpdateEnabled, setAutoUpdateEnabled } = useUiStore();

  const THEMES: { value: Theme; labelKey: string; icon: typeof Sun }[] = [
    { value: "light", labelKey: "settings.theme_light", icon: Sun },
    { value: "dark", labelKey: "settings.theme_dark", icon: Moon },
    { value: "system", labelKey: "settings.theme_system", icon: Monitor },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance_title")}</CardTitle>
          <CardDescription>{t("settings.appearance_description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {THEMES.map(({ value, labelKey, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon className="size-4" />
              {t(labelKey)}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language_title")}</CardTitle>
          <CardDescription>{t("settings.language_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={language} onValueChange={(val) => setLanguage(val as LanguageCode)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(({ code, label }) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Updates */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.updates_title")}</CardTitle>
          <CardDescription>{t("settings.updates_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm">{t("settings.updates_auto_check")}</span>
            <Switch
              checked={autoUpdateEnabled}
              onCheckedChange={setAutoUpdateEnabled}
              aria-label={t("settings.updates_auto_check")}
            />
          </label>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runtime.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : runtime.data ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("settings.about_version")}</dt>
              <dd className="font-mono">{runtime.data.appVersion}</dd>
              <dt className="text-muted-foreground">{t("settings.about_tauri")}</dt>
              <dd className="font-mono">{runtime.data.tauriVersion}</dd>
              <dt className="text-muted-foreground">{t("settings.about_platform")}</dt>
              <dd className="font-mono">
                {runtime.data.os} / {runtime.data.arch}
              </dd>
              <dt className="text-muted-foreground">{t("settings.about_build")}</dt>
              <dd className="font-mono">
                {runtime.data.isDebug ? t("settings.build_debug") : t("settings.build_release")}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{t("settings.about_unavailable")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
