import { FlaskConical } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export function SuitesPage() {
  return (
    <EmptyState
      icon={FlaskConical}
      title="Test suites are not built yet"
      description="This page will hold saved test cases with assertions, grouped into suites you can run on demand."
      planned={[
        "Create, edit and delete test cases",
        "Status, header, body and latency assertions",
        "Run a whole suite and see pass/fail per case",
      ]}
    />
  );
}
