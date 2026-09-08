import { Gauge } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export function LoadPage() {
  return (
    <EmptyState
      icon={Gauge}
      title="Load and rate-limit testing is not built yet"
      description="This page will drive sustained traffic at the Confinaid API and report how it behaves under load and at the throttling boundary."
      planned={[
        "Concurrency and duration controls",
        "Live throughput with p50 / p95 / p99 latency",
        "Rate-limit probe that finds the 429 boundary and honours Retry-After",
      ]}
    />
  );
}
