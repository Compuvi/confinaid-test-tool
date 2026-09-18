import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/empty-state";

export function LoadPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Gauge}
      title={t("load.title")}
      description={t("load.description")}
      planned={[
        "Concurrency and duration controls",
        "Live throughput with p50 / p95 / p99 latency",
        "Rate-limit probe that finds the 429 boundary and honours Retry-After",
      ]}
    />
  );
}
