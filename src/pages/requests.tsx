import { Send } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export function RequestsPage() {
  return (
    <EmptyState
      icon={Send}
      title="Request builder is not built yet"
      description="This page will send single and bulk requests against the Confinaid API using the credentials from the Connection page."
      planned={[
        "Method, path, headers and body editor",
        "Bulk import from CSV or JSONL",
        "Response viewer with timing and status breakdown",
      ]}
    />
  );
}
