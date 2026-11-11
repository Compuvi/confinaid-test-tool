/**
 * Filtering page — manage the filtering profiles of the active credential's
 * company through the Partner API (`/v1/filtering-profiles*`,
 * `/v1/filtering/*`). Calls go through the `filtering_request` Rust command,
 * which validates every path and attaches the bearer token.
 *
 * Layout mirrors the Confinaid web app's filtering editor: a table of
 * profiles, and a profile's detail (header, back button and underline tabs)
 * in its place once one is opened.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateProfileDialog } from "@/components/filtering/profile-dialogs";
import { ProfileDetail } from "@/components/filtering/profile-detail";
import { ProfileList } from "@/components/filtering/profile-list";
import { useFilteringScope, useStoredCredentials } from "@/lib/api";

export function FilteringPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const credentials = useStoredCredentials();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The selection belongs to one company; drop it when the credential
  // identity (profile name, client ID or base URL) changes.
  const cred = useFilteringScope();
  const [selectionCred, setSelectionCred] = useState(cred);
  if (cred !== selectionCred) {
    setSelectionCred(cred);
    setSelectedId(null);
  }

  if (credentials.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!cred) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="bg-muted rounded-full p-4">
          <PlugZap className="text-muted-foreground size-8" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="font-medium">{t("filtering.no_credential.title")}</p>
          <p className="text-muted-foreground text-sm">{t("filtering.no_credential.body")}</p>
        </div>
        <Button onClick={() => void navigate("/connection")}>
          {t("filtering.no_credential.action")}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {selectedId ? (
          <ProfileDetail
            key={selectedId}
            profileId={selectedId}
            onSelect={setSelectedId}
            onBack={() => setSelectedId(null)}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          // The app header already names the page; no title of our own.
          <ProfileList key={cred} onSelect={setSelectedId} onNew={() => setCreating(true)} />
        )}
      </div>
      <CreateProfileDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(p) => setSelectedId(p.id)}
      />
    </div>
  );
}
