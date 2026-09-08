import { FileBarChart } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export function ReportsPage() {
  return (
    <EmptyState
      icon={FileBarChart}
      title="Reports are not built yet"
      description="This page will list past runs and let you open, compare and export them."
      planned={[
        "Run history with outcome and duration",
        "Per-run detail with request-level results",
        "Export to JSON, CSV or HTML, with credentials redacted",
      ]}
    />
  );
}
