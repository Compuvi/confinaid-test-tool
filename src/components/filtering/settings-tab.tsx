import { useTranslation } from "react-i18next";
import { FileType2, Globe, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { FilteringProfile } from "@/types/filtering";

import { DangerZone, FlagSwitch, SectionCard } from "./chrome";
import { useProfileFieldSave } from "./chrome-utils";
import { MultiSelectList, TruncatedNotice } from "./shared";
import { useAttachmentOptions, useLanguageOptions } from "./use-catalog-options";

/**
 * The web app's Settings tab: which attachment types the profile scans, as a
 * grid of switch tiles, the deep-scan switch in its danger zone, and the
 * profile's languages (a disabled tab of their own in the web app, kept here
 * because the Partner API still accepts them).
 */
export function SettingsTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const attachments = useAttachmentOptions();
  const languages = useLanguageOptions();
  const { save, pending } = useProfileFieldSave(profile);

  const selected = new Set(profile.attachment_ids);
  const all = attachments.options.map((o) => o.value);
  const allOn = all.length > 0 && all.every((id) => selected.has(id));

  const setAttachments = (ids: string[]) => void save({ attachment_ids: ids }).catch(() => {});

  return (
    <div className="space-y-6">
      <SectionCard
        icon={Paperclip}
        title={t("filtering.settings.attachments_title")}
        description={t("filtering.settings.attachments_desc")}
        actions={
          <Badge variant="secondary" className="tabular-nums">
            {t("filtering.settings.active_count", { count: selected.size, total: all.length })}
          </Badge>
        }
      >
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{t("filtering.settings.file_types")}</h4>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || all.length === 0}
            onClick={() => setAttachments(allOn ? [] : all)}
          >
            {allOn ? t("filtering.settings.disable_all") : t("filtering.settings.enable_all")}
          </Button>
        </div>

        {attachments.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {attachments.options.map((o) => {
              const on = selected.has(o.value);
              return (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${on ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"}`}
                >
                  <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                    <FileType2 className="text-muted-foreground size-4" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.label}</span>
                  <Switch
                    checked={on}
                    disabled={pending}
                    aria-label={o.label}
                    onCheckedChange={(v) =>
                      setAttachments(
                        v
                          ? [...profile.attachment_ids, o.value]
                          : profile.attachment_ids.filter((id) => id !== o.value)
                      )
                    }
                  />
                </label>
              );
            })}
          </div>
        )}
        <TruncatedNotice truncated={attachments.truncated} />

        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          {t("filtering.settings.hint")}
        </p>

        <DangerZone>
          <FlagSwitch
            id="settings-deep-scan"
            label={t("filtering.fields.deep_scan_enabled")}
            description={t("filtering.general.deep_scan_enabled_hint")}
            warning={t("filtering.danger.deep_scan_off")}
            checked={profile.deep_scan_enabled}
            onChange={(enabled) => save({ deep_scan_enabled: enabled })}
          />
        </DangerZone>
      </SectionCard>

      <SectionCard
        icon={Globe}
        title={t("filtering.settings.languages_title")}
        description={t("filtering.settings.languages_desc")}
        actions={
          <Badge variant="secondary" className="tabular-nums">
            {profile.language_ids.length}
          </Badge>
        }
      >
        <MultiSelectList
          options={languages.options}
          value={profile.language_ids}
          loading={languages.isLoading}
          truncated={languages.truncated}
          onChange={(ids) => void save({ language_ids: ids }).catch(() => {})}
        />
      </SectionCard>
    </div>
  );
}
