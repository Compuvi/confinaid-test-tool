import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import type { FilteringProfile } from "@/types/filtering";

import { DangerZone, FlagSwitch } from "./chrome";
import { useProfileFieldSave } from "./chrome-utils";
import { KeywordGroupsTab } from "./keyword-groups-tab";
import { KeywordsTab } from "./keywords-tab";

/**
 * The web app's Keywords tab: the keywords, the keyword groups built from
 * them, and the keyword-filter switch in its danger zone, on one page.
 */
export function KeywordsSection({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const { save } = useProfileFieldSave(profile);

  return (
    <div className="space-y-6">
      <KeywordsTab profile={profile} />
      <KeywordGroupsTab profile={profile} />
      <Card className="py-0">
        <CardContent className="py-5">
          <DangerZone>
            <FlagSwitch
              id="keyword-filtering"
              label={t("filtering.fields.keyword_filtering_enabled")}
              description={t("filtering.general.keyword_filtering_enabled_hint")}
              warning={t("filtering.danger.keyword_off")}
              checked={profile.keyword_filtering_enabled}
              onChange={(enabled) => save({ keyword_filtering_enabled: enabled })}
            />
          </DangerZone>
        </CardContent>
      </Card>
    </div>
  );
}
