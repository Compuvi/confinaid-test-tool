import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import type { MonitoringFilters } from "@/types/monitoring";
import { commands } from "../tauri-client";
import { queryKeys } from "../query-client";

// ── Summary / KPIs ────────────────────────────────────────────────────────────

export function useMonitoringSummary(filters: MonitoringFilters) {
  return useQuery({
    queryKey: [...queryKeys.monitoring.all, "summary", filters],
    queryFn: () => commands.monitoring.getSummary({ filters }),
    staleTime: 60_000,
  });
}

// ── Paginated record list ─────────────────────────────────────────────────────

export function useMonitoringRecords({
  filters,
  page,
  pageSize,
  ordering,
}: {
  filters: MonitoringFilters;
  page: number;
  pageSize: number;
  ordering?: string;
}) {
  return useQuery({
    queryKey: [...queryKeys.monitoring.all, "records", filters, page, pageSize, ordering],
    queryFn: () => commands.monitoring.listRecords({ filters, page, pageSize, ordering }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ── Single record detail ──────────────────────────────────────────────────────

export function useMonitoringRecord(recordId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.monitoring.all, "record", recordId],
    queryFn: () => commands.monitoring.getRecord({ recordId: recordId! }),
    enabled: !!recordId,
    staleTime: 5 * 60_000,
  });
}

// ── Manual refetch ────────────────────────────────────────────────────────────

export function useRefreshMonitoring() {
  return useMutation({
    mutationFn: (filters: MonitoringFilters) => commands.monitoring.getSummary({ filters }),
  });
}
