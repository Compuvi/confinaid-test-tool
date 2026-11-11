import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Gauge,
  Globe,
  KeySquare,
  MessageSquareCode,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilteringProfile } from "@/lib/api/hooks/use-filtering";
import type { FilteringProfile } from "@/types/filtering";

import { BypassRulesTab } from "./bypass-rules-tab";
import { UNDERLINE_TABS_LIST, UNDERLINE_TABS_TRIGGER } from "./chrome";
import { CodenamesTab } from "./codenames-tab";
import { GeneralTab } from "./general-tab";
import { KeywordsSection } from "./keywords-section";
import { LabelSettingsTab } from "./label-settings-tab";
import { CloneProfileDialog, DeleteProfileDialog } from "./profile-dialogs";
import { RiskTab } from "./risk-tab";
import { SettingsTab } from "./settings-tab";
import { QueryError } from "./shared";

/**
 * The web app's tab order: set the line (Risk), then say who may pass it
 * (Bypass), then the filters, then settings. Assignments has no Partner API
 * equivalent and is left out; the change log sits under General, as there.
 */
const TABS: Array<{ id: string; icon: LucideIcon }> = [
  { id: "general", icon: SlidersHorizontal },
  { id: "risk", icon: Gauge },
  { id: "bypass", icon: ShieldCheck },
  { id: "labels", icon: Tags },
  { id: "keywords", icon: KeySquare },
  { id: "codenames", icon: MessageSquareCode },
  { id: "settings", icon: Globe },
];

export function ProfileDetail({
  profileId,
  onSelect,
  onBack,
  onDeleted,
}: {
  profileId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const query = useFilteringProfile(profileId);
  const [tab, setTab] = useState("general");
  const [cloning, setCloning] = useState<FilteringProfile | null>(null);
  const [deleting, setDeleting] = useState<FilteringProfile | null>(null);

  const back = (
    <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={onBack}>
      <ArrowLeft className="size-4" />
      {t("filtering.profiles.back")}
    </Button>
  );

  if (query.isError) {
    return (
      <div className="space-y-4">
        {back}
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const profile = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-3xl font-bold tracking-tight">{profile.title}</h1>
          {/* The app header already describes the page; only the profile's own text here. */}
          {profile.description && <p className="text-muted-foreground">{profile.description}</p>}
        </div>
        {back}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <TabsList className={UNDERLINE_TABS_LIST} aria-label={t("filtering.tabs.aria")}>
          {TABS.map(({ id, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className={UNDERLINE_TABS_TRIGGER}>
              <Icon className="size-4" />
              {t(`filtering.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralTab
            profile={profile}
            onClone={() => setCloning(profile)}
            onDelete={() => setDeleting(profile)}
          />
        </TabsContent>
        <TabsContent value="risk">
          <RiskTab profile={profile} />
        </TabsContent>
        <TabsContent value="bypass">
          <BypassRulesTab profile={profile} />
        </TabsContent>
        <TabsContent value="labels">
          <LabelSettingsTab profile={profile} />
        </TabsContent>
        <TabsContent value="keywords">
          <KeywordsSection profile={profile} />
        </TabsContent>
        <TabsContent value="codenames">
          <CodenamesTab profile={profile} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab profile={profile} />
        </TabsContent>
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
