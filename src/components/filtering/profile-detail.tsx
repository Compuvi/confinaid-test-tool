import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilteringProfile, useSetPrimaryFilteringProfile } from "@/lib/api/hooks/use-filtering";
import { formatDateTime } from "@/lib/filtering/format";
import type { FilteringProfile } from "@/types/filtering";

import { ActivityTab } from "./activity-tab";
import { BypassRulesTab } from "./bypass-rules-tab";
import { CodenamesTab } from "./codenames-tab";
import { GeneralTab } from "./general-tab";
import { KeywordGroupsTab } from "./keyword-groups-tab";
import { KeywordsTab } from "./keywords-tab";
import { LabelSettingsTab } from "./label-settings-tab";
import { CloneProfileDialog, DeleteProfileDialog } from "./profile-dialogs";
import { QueryError } from "./shared";
import { useErrorToast } from "./use-error-toast";

const TABS = [
  "general",
  "keywords",
  "keyword_groups",
  "codenames",
  "labels",
  "bypass_rules",
  "activity",
] as const;
type TabId = (typeof TABS)[number];

export function ProfileDetail({
  profileId,
  onSelect,
  onDeleted,
}: {
  profileId: string;
  onSelect: (id: string) => void;
  onDeleted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const showError = useErrorToast();
  const query = useFilteringProfile(profileId);
  const setPrimary = useSetPrimaryFilteringProfile();
  const [tab, setTab] = useState<TabId>("general");
  const [cloning, setCloning] = useState<FilteringProfile | null>(null);
  const [deleting, setDeleting] = useState<FilteringProfile | null>(null);

  if (query.isError) {
    return (
      <div className="p-6">
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const profile = query.data;

  const makePrimary = async () => {
    try {
      await setPrimary.mutateAsync(profile.id);
      toast.success(t("filtering.profiles.now_primary", { title: profile.title }));
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{profile.title}</h2>
            {profile.is_primary && (
              <Badge variant="secondary" className="gap-1">
                <Star className="size-3" />
                {t("filtering.profiles.primary")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("filtering.profiles.region")}:{" "}
            {profile.region?.name ?? t("filtering.profiles.no_region")}
            {" · "}
            {t("filtering.profiles.updated", {
              when: formatDateTime(profile.updated_at, i18n.language),
            })}
          </p>
          <p className="text-muted-foreground font-mono text-[10px]">{profile.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!profile.is_primary && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void makePrimary()}
              disabled={setPrimary.isPending}
            >
              {setPrimary.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Star className="size-3.5" />
              )}
              {t("filtering.profiles.set_primary")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setCloning(profile)}
          >
            <Copy className="size-3.5" />
            {t("filtering.profiles.clone")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="hover:text-destructive gap-1.5"
            onClick={() => setDeleting(profile)}
            title={profile.is_primary ? t("filtering.profiles.primary_locked_hint") : undefined}
          >
            <Trash2 className="size-3.5" />
            {t("filtering.common.delete")}
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="overflow-x-auto border-b px-6 pt-3 pb-2">
          <TabsList>
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`filtering.tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <TabsContent value="general">
            <GeneralTab profile={profile} />
          </TabsContent>
          <TabsContent value="keywords">
            <KeywordsTab profile={profile} />
          </TabsContent>
          <TabsContent value="keyword_groups">
            <KeywordGroupsTab profile={profile} />
          </TabsContent>
          <TabsContent value="codenames">
            <CodenamesTab profile={profile} />
          </TabsContent>
          <TabsContent value="labels">
            <LabelSettingsTab profile={profile} />
          </TabsContent>
          <TabsContent value="bypass_rules">
            <BypassRulesTab profile={profile} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityTab profile={profile} />
          </TabsContent>
        </div>
      </Tabs>

      <CloneProfileDialog
        profile={cloning}
        onOpenChange={(o) => !o && setCloning(null)}
        onCloned={(p) => onSelect(p.id)}
      />
      <DeleteProfileDialog
        profile={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
