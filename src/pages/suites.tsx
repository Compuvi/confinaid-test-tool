import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/empty-state";

export function SuitesPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FlaskConical}
      title={t("suites.title")}
      description={t("suites.description")}
      planned={[
        "Create, edit and delete test cases",
        "Status, header, body and latency assertions",
        "Run a whole suite and see pass/fail per case",
      ]}
    />
  );
}
