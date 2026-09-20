import { CheckCircle, Download, Loader2, RefreshCw } from "lucide-react";
import { Monitor, Moon, Sun } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { InstallProgress, useInstallUpdate } from "@/components/ui/update-banner";
import { useRuntimeInfo } from "@/lib/api";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { useTheme, type Theme } from "@/providers/theme-provider";
import { commands } from "@/lib/api/tauri-client";
import { useUiStore } from "@/stores/ui-store";
import { useUpdaterStore } from "@/stores/updater-store";

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const runtime = useRuntimeInfo();
  const {
    language,
    setLanguage,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    autoInstallEnabled,
    setAutoInstallEnabled,
  } = useUiStore();
  const checkResult = useUpdaterStore((s) => s.checkResult);
  const setCheckResult = useUpdaterStore((s) => s.setCheckResult);
  const checking = useUpdaterStore((s) => s.checking);
  const setChecking = useUpdaterStore((s) => s.setChecking);
  const installPhase = useUpdaterStore((s) => s.installPhase);
  const setInstallPhase = useUpdaterStore((s) => s.setInstallPhase);
  const { install } = useInstallUpdate();

  const openReleasePage = (url: string) => openUrl(url).catch(console.error);

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
        <CardContent className="divide-y">
          {/* Current version */}
          <div className="flex items-center justify-between py-3 first:pt-0">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("settings.updates_current_version")}</p>
              <p className="text-muted-foreground text-xs">{t("settings.updates_version_desc")}</p>
            </div>
            <span className="text-muted-foreground font-mono text-sm">
              v{runtime.data?.appVersion ?? "…"}
            </span>
          </div>

          {/* Auto-check toggle */}
          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("settings.updates_auto_check")}</p>
              <p className="text-muted-foreground text-xs">
                {t("settings.updates_auto_check_desc")}
              </p>
            </div>
            <Switch
              checked={autoUpdateEnabled}
              onCheckedChange={setAutoUpdateEnabled}
              aria-label={t("settings.updates_auto_check")}
            />
          </div>

          {/* Auto-install toggle */}
          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("settings.updates_auto_install")}</p>
              <p className="text-muted-foreground text-xs">
                {t("settings.updates_auto_install_desc")}
              </p>
            </div>
            <Switch
              checked={autoInstallEnabled}
              onCheckedChange={setAutoInstallEnabled}
              disabled={!autoUpdateEnabled}
              aria-label={t("settings.updates_auto_install")}
            />
          </div>

          {/* Manual check + install */}
          <div className="space-y-3 py-3 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t("settings.updates_check_now")}</p>
                {/* Result feedback */}
                {checkResult?.available ? (
                  <p className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                    <Download className="size-3" />
                    {t("settings.updates_available", { version: checkResult.new_version })}
                  </p>
                ) : checkResult && !checkResult.available ? (
                  <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle className="size-3" />
                    {t("settings.updates_up_to_date")}
                  </p>
                ) : checking ? (
                  <p className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Loader2 className="size-3 animate-spin" />
                    {t("settings.updates_checking")}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {checkResult?.available && installPhase.kind === "idle" && (
                  <Button
                    size="sm"
                    className="h-8 bg-purple-600 text-xs text-white hover:bg-purple-700"
                    onClick={() => install(checkResult)}
                  >
                    <Download className="mr-1.5 size-3.5" />
                    {t("settings.updates_install_now")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={checking || installPhase.kind !== "idle"}
                  onClick={async () => {
                    setChecking(true);
                    setCheckResult(null);
                    try {
                      const r = await commands.updater.checkForUpdates();
                      setCheckResult(r);
                      // Auto-clear "up to date" after 5 s
                      if (!r.available) {
                        setTimeout(() => setCheckResult(null), 5_000);
                      }
                    } catch {
                      setCheckResult({
                        available: false,
                        current_version: runtime.data?.appVersion ?? "",
                        new_version: null,
                        release_url: null,
                        release_notes: null,
                        mandatory: false,
                        download_url: null,
                        download_size: null,
                        checksum: null,
                        filename: null,
                      });
                    } finally {
                      setChecking(false);
                    }
                  }}
                >
                  {checking ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-3.5" />
                  )}
                  {t("settings.updates_check_now")}
                </Button>
              </div>
            </div>

            {/* Inline install progress (shown while downloading / verifying) */}
            {installPhase.kind !== "idle" && (
              <InstallProgress
                phase={installPhase}
                onRetry={
                  checkResult?.available
                    ? () => {
                        setInstallPhase({ kind: "idle" });
                      }
                    : undefined
                }
                onOpenReleasePage={
                  checkResult?.release_url
                    ? () => {
                        if (checkResult.release_url) openReleasePage(checkResult.release_url);
                      }
                    : undefined
                }
              />
            )}
          </div>
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
