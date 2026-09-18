import { FileBarChart } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/empty-state";

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FileBarChart}
      title={t("reports.title")}
      description={t("reports.description")}
      planned={[
        "Run history with outcome and duration",
        "Per-run detail with request-level results",
        "Export to JSON, CSV or HTML, with credentials redacted",
      ]}
    />
  );
}
