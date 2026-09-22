/**
 * Monitoring page — local API traffic dashboard.
 *
 * Mirrors the design and features of the Confinaid frontend's monitoring
 * page, but uses data generated locally by the test tool instead of fetching
 * from the backend.  Every API call made through Requests, Test Suites, and
 * the Playground is automatically recorded in `useRequestLogStore` and
 * appears here in real time.
 *
 * Features:
 *  • Filter bar: date range presets, source, verdict, endpoint
 *  • 9 KPI tiles (Total, Analyses, Rewrites, Clean, Risky, HITL, …)
 *  • SVG line chart — API traffic over time (Day / Week / Month)
 *  • Paginated traffic table with per-row content preview dialog
 *  • Clear log button
 */

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useRequestLogStore } from "@/stores/request-log-store";
import { cn } from "@/lib/utils";
import type { RequestLogEntry, RequestSource, RequestVerdict } from "@/types/request-log";
import type { EndpointId } from "@/types/request";

// ──────────────────────────────────────────────────────── Constants ───────

const PAGE_SIZE = 20;

type DateRange = "today" | "7d" | "30d" | "all";
type FilterSource = "all" | RequestSource;
type FilterVerdict = "all" | RequestVerdict;
type FilterEndpoint = "all" | EndpointId;
type ChartMode = "day" | "week" | "month";

// ──────────────────────────────────────────────────────── Helpers ─────────

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function rangeStart(range: DateRange): number {
  const now = Date.now();
  switch (range) {
    case "today":
      return startOfDay(new Date());
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return 0;
  }
}

function bucketKey(ts: number, mode: ChartMode): string {
  const d = new Date(ts);
  if (mode === "day") return d.toISOString().slice(0, 10);
  if (mode === "month") return d.toISOString().slice(0, 7);
  // week — ISO Monday
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(ts - (day - 1) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtBucketLabel(key: string, mode: ChartMode): string {
  if (mode === "month") {
    return new Date(`${key}-01`).toLocaleString(undefined, { month: "short" });
  }
  const d = new Date(key + "T00:00:00");
  if (mode === "week") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

// ──────────────────────────────────────────────────────── Verdict UI ──────

type VerdictConfig = {
  label: string;
  icon: React.ElementType;
  className: string;
  badgeClass: string;
};

function useVerdictConfig(verdict: RequestVerdict): VerdictConfig | null {
  const { t } = useTranslation();
  if (verdict === "safe")
    return {
      label: t("monitoring.verdict_clean"),
      icon: ShieldCheck,
      className: "text-emerald-600",
      badgeClass: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    };
  if (verdict === "risky")
    return {
      label: t("monitoring.verdict_risky"),
      icon: ShieldX,
      className: "text-red-500",
      badgeClass: "bg-red-500/10 text-red-700 border-red-500/30",
    };
  if (verdict === "hitl")
    return {
      label: t("monitoring.verdict_hitl"),
      icon: ShieldAlert,
      className: "text-amber-500",
      badgeClass: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    };
  return null;
}

function VerdictBadge({ verdict }: { verdict: RequestVerdict }) {
  const cfg = useVerdictConfig(verdict);
  if (!cfg) return <span className="text-muted-foreground text-xs">—</span>;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 border text-xs font-medium", cfg.badgeClass)}>
      <Icon className="size-3" />
      {cfg.label}
    </Badge>
  );
}

function EndpointBadge({ endpoint }: { endpoint: EndpointId }) {
  const colorMap: Record<EndpointId, string> = {
    Token: "bg-blue-500/10 text-blue-700 border-blue-500/30",
    Refresh: "bg-sky-500/10 text-sky-700 border-sky-500/30",
    Revoke: "bg-slate-500/10 text-slate-700 border-slate-500/30",
    Analyze: "bg-violet-500/10 text-violet-700 border-violet-500/30",
    Rewrite: "bg-orange-500/10 text-orange-700 border-orange-500/30",
    Graphrag: "bg-teal-500/10 text-teal-700 border-teal-500/30",
  };
  const pathMap: Record<EndpointId, string> = {
    Token: "/v1/token",
    Refresh: "/v1/token/refresh",
    Revoke: "/v1/token/revoke",
    Analyze: "/v1/analyze",
    Rewrite: "/v1/rewrite",
    Graphrag: "/v1/graphrag",
  };
  return (
    <Badge variant="outline" className={cn("font-mono text-xs", colorMap[endpoint])}>
      {pathMap[endpoint]}
    </Badge>
  );
}

// ──────────────────────────────────────────────────────── KPI Tile ────────

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon?: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-card flex min-w-0 items-start gap-3 rounded-lg border p-3 shadow-sm">
      {Icon && (
        <div className="mt-0.5 shrink-0">
          <Icon className={cn("size-4", accent ?? "text-muted-foreground")} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground truncate text-xs">{label}</p>
        <p
          className={cn(
            "text-xl leading-tight font-bold tabular-nums",
            accent ?? "text-foreground"
          )}
        >
          {value}
        </p>
        {sub && <p className="text-muted-foreground mt-0.5 truncate text-xs">{sub}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────── SVG Line Chart ──

const SERIES = [
  {
    key: "analyses",
    labelKey: "monitoring.chart_analyses",
    color: "#3b82f6",
    filter: (e: RequestLogEntry) => e.endpoint === "Analyze",
  },
  {
    key: "risky",
    labelKey: "monitoring.chart_risky",
    color: "#ef4444",
    filter: (e: RequestLogEntry) => e.verdict === "risky",
  },
  {
    key: "hitl",
    labelKey: "monitoring.chart_hitl",
    color: "#f59e0b",
    filter: (e: RequestLogEntry) => e.verdict === "hitl",
  },
  {
    key: "clean",
    labelKey: "monitoring.chart_clean",
    color: "#10b981",
    filter: (e: RequestLogEntry) => e.verdict === "safe",
  },
] as const;

function LineChart({ entries, mode }: { entries: RequestLogEntry[]; mode: ChartMode }) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
        {t("monitoring.no_data_title")}
      </div>
    );
  }

  // Collect all unique bucket keys, sorted ascending
  const bucketSet = new Set<string>(entries.map((e) => bucketKey(e.timestamp, mode)));
  const buckets = [...bucketSet].sort();

  if (buckets.length === 0) return null;

  // Count per series per bucket
  const seriesData = SERIES.map((s) => ({
    ...s,
    counts: buckets.map(
      (b) => entries.filter((e) => bucketKey(e.timestamp, mode) === b && s.filter(e)).length
    ),
  }));

  const maxCount = Math.max(1, ...seriesData.flatMap((s) => s.counts));

  // SVG coordinate space
  const W = 900;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const xOf = (i: number) =>
    PAD_L + (buckets.length === 1 ? chartW / 2 : (i / (buckets.length - 1)) * chartW);
  const yOf = (v: number) => PAD_T + chartH - (v / maxCount) * chartH;

  // Y-axis tick count
  const yTicks = [0, Math.ceil(maxCount / 2), maxCount];

  // X-axis label indices (show at most 7)
  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));
  const labelIdxs = buckets
    .map((_, i) => i)
    .filter((i) => i % labelStep === 0 || i === buckets.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 280, height: 180 }}
        aria-label="API traffic chart"
      >
        {/* Grid */}
        {yTicks.map((v) => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 4}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill="currentColor"
                opacity={0.4}
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize={8.5}
            fill="currentColor"
            opacity={0.45}
          >
            {fmtBucketLabel(buckets[i], mode)}
          </text>
        ))}

        {/* Lines */}
        {seriesData.map((s) => {
          if (s.counts.every((c) => c === 0)) return null;
          const pts = s.counts.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.9}
              />
              {/* Dots */}
              {s.counts.map((v, i) =>
                v > 0 ? (
                  <circle key={i} cx={xOf(i)} cy={yOf(v)} r={3} fill={s.color} opacity={0.85} />
                ) : null
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="text-muted-foreground mt-2 flex flex-wrap justify-center gap-4 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            {t(s.labelKey)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Content dialog ──

function ContentDialog({
  entry,
  open,
  onClose,
}: {
  entry: RequestLogEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!entry) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {t("monitoring.content_dialog_title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <EndpointBadge endpoint={entry.endpoint} />
            <VerdictBadge verdict={entry.verdict} />
            <span className="text-muted-foreground text-xs">{fmtDate(entry.timestamp)}</span>
          </div>
          {entry.riskScore !== null && (
            <p className="text-muted-foreground text-xs">
              Risk score:{" "}
              <span className="font-mono font-medium">{Math.round(entry.riskScore * 100)}%</span>
            </p>
          )}
          {entry.content ? (
            <pre className="bg-muted/40 max-h-60 overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">
              {entry.content}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs italic">{t("monitoring.no_content")}</p>
          )}
          {entry.error && <p className="font-mono text-xs text-red-500">{entry.error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────── Empty state ─────

function EmptyMonitoring() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-20 text-center">
      <div className="bg-muted/60 flex h-16 w-16 items-center justify-center rounded-2xl">
        <Activity className="text-muted-foreground/70 h-8 w-8" />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h2 className="text-base font-semibold">{t("monitoring.no_data_title")}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("monitoring.no_data_desc")}
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Page ────────────

export function MonitoringPage() {
  const { t } = useTranslation();
  const { entries, clearLog } = useRequestLogStore();

  // ── Filters ───────────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [filterVerdict, setFilterVerdict] = useState<FilterVerdict>("all");
  const [filterEndpoint, setFilterEndpoint] = useState<FilterEndpoint>("all");
  const [chartMode, setChartMode] = useState<ChartMode>("day");
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dialogEntry, setDialogEntry] = useState<RequestLogEntry | null>(null);

  // ── Filtered entries ──────────────────────────────────────────────────
  const start = rangeStart(dateRange);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (e.timestamp < start) return false;
      if (filterSource !== "all" && e.source !== filterSource) return false;
      if (filterVerdict !== "all" && e.verdict !== filterVerdict) return false;
      if (filterEndpoint !== "all" && e.endpoint !== filterEndpoint) return false;
      return true;
    });
  }, [entries, start, filterSource, filterVerdict, filterEndpoint]);

  // Reset page when filters change
  const handleFilterChange =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(0);
    };

  // ── KPI computations ──────────────────────────────────────────────────
  const total = filtered.length;
  const analyses = filtered.filter((e) => e.endpoint === "Analyze").length;
  const rewrites = filtered.filter((e) => e.endpoint === "Rewrite").length;
  const clean = filtered.filter((e) => e.verdict === "safe").length;
  const risky = filtered.filter((e) => e.verdict === "risky").length;
  const hitl = filtered.filter((e) => e.verdict === "hitl").length;
  const incomplete = filtered.filter(
    (e) => e.error !== null || (e.status > 0 && (e.status < 200 || e.status >= 300))
  ).length;
  const tokenOps = filtered.filter(
    (e) => e.endpoint === "Token" || e.endpoint === "Refresh" || e.endpoint === "Revoke"
  ).length;
  const analyzeCalls = filtered.filter((e) => e.endpoint === "Analyze");
  const avgAnalysisMs =
    analyzeCalls.length === 0
      ? null
      : Math.round(analyzeCalls.reduce((a, e) => a + e.durationMs, 0) / analyzeCalls.length);

  // ── Pagination ────────────────────────────────────────────────────────
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  // ── Empty state ───────────────────────────────────────────────────────
  if (entries.length === 0) return <EmptyMonitoring />;

  return (
    <div className="flex flex-col gap-4 py-1 pb-10">
      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Date range presets */}
        <div className="flex shrink-0 overflow-hidden rounded-md border">
          {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleFilterChange(setDateRange)(r)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                dateRange === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {t(`monitoring.filter_${r}` as "monitoring.filter_today")}
            </button>
          ))}
        </div>

        {/* Source */}
        <Select
          value={filterSource}
          onValueChange={(v) => handleFilterChange(setFilterSource)(v as FilterSource)}
        >
          <SelectTrigger className="h-8 w-38 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("monitoring.filter_source_all")}</SelectItem>
            <SelectItem value="requests">{t("monitoring.filter_source_requests")}</SelectItem>
            <SelectItem value="bulk">{t("monitoring.filter_source_bulk")}</SelectItem>
            <SelectItem value="suite">{t("monitoring.filter_source_suite")}</SelectItem>
            <SelectItem value="playground">{t("monitoring.filter_source_playground")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Verdict */}
        <Select
          value={filterVerdict ?? "all"}
          onValueChange={(v) =>
            handleFilterChange(setFilterVerdict)(v === "all" ? "all" : (v as FilterVerdict))
          }
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("monitoring.filter_verdict_all")}</SelectItem>
            <SelectItem value="safe">{t("monitoring.filter_verdict_clean")}</SelectItem>
            <SelectItem value="risky">{t("monitoring.filter_verdict_risky")}</SelectItem>
            <SelectItem value="hitl">{t("monitoring.filter_verdict_hitl")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Endpoint / Operation */}
        <Select
          value={filterEndpoint}
          onValueChange={(v) => handleFilterChange(setFilterEndpoint)(v as FilterEndpoint)}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("monitoring.filter_endpoint_all")}</SelectItem>
            <SelectItem value="Analyze">/v1/analyze</SelectItem>
            <SelectItem value="Rewrite">/v1/rewrite</SelectItem>
            <SelectItem value="Graphrag">/v1/graphrag</SelectItem>
            <SelectItem value="Token">/v1/token</SelectItem>
            <SelectItem value="Refresh">/v1/token/refresh</SelectItem>
            <SelectItem value="Revoke">/v1/token/revoke</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {confirmClear ? (
            <>
              <span className="text-muted-foreground text-xs">
                {t("monitoring.clear_confirm", { count: entries.length })}
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={() => {
                  clearLog();
                  setConfirmClear(false);
                }}
              >
                {t("monitoring.clear_yes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setConfirmClear(false)}
              >
                {t("monitoring.clear_no")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-7 gap-1.5 text-xs"
              onClick={() => setConfirmClear(true)}
            >
              <RotateCcw className="size-3" />
              {t("monitoring.clear_log")}
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI tiles — row 1 ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        <KpiTile icon={Zap} label={t("monitoring.kpi_total")} value={total} />
        <KpiTile icon={Activity} label={t("monitoring.kpi_analyses")} value={analyses} />
        <KpiTile label={t("monitoring.kpi_rewrites")} value={rewrites} />
        <KpiTile
          icon={ShieldCheck}
          label={t("monitoring.kpi_clean")}
          value={clean}
          accent="text-emerald-600"
        />
        <KpiTile
          icon={ShieldX}
          label={t("monitoring.kpi_risky")}
          value={risky}
          accent="text-red-500"
        />
        <KpiTile
          icon={ShieldAlert}
          label={t("monitoring.kpi_hitl")}
          value={hitl}
          accent="text-amber-500"
        />
      </div>

      {/* ── KPI tiles — row 2 ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        <KpiTile
          label={t("monitoring.kpi_incomplete")}
          value={incomplete}
          accent={incomplete > 0 ? "text-red-500" : undefined}
        />
        <KpiTile
          icon={Clock}
          label={t("monitoring.kpi_avg_time")}
          value={avgAnalysisMs !== null ? `${avgAnalysisMs.toLocaleString()} ms` : "—"}
        />
        <KpiTile label={t("monitoring.kpi_tokens")} value={tokenOps} />
        <KpiTile
          label={t("monitoring.kpi_pass_rate")}
          value={analyses === 0 ? "—" : `${Math.round(((clean + hitl) / analyses) * 100)}%`}
          sub={analyses > 0 ? `${clean + hitl} / ${analyses} non-risky` : undefined}
        />
        <KpiTile
          label={t("monitoring.kpi_error_rate")}
          value={total === 0 ? "—" : `${Math.round((incomplete / total) * 100)}%`}
          accent={
            incomplete > 0 && total > 0 && incomplete / total > 0.1 ? "text-red-500" : undefined
          }
        />
        <KpiTile
          label={t("monitoring.kpi_sources")}
          value={new Set(filtered.map((e) => e.sourceName)).size}
          sub={[...new Set(filtered.map((e) => e.sourceName))].slice(0, 2).join(", ") || "—"}
        />
      </div>

      {/* ── API Traffic chart ──────────────────────────────────────────── */}
      <div className="bg-card rounded-lg border p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("monitoring.chart_title")}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("monitoring.chart_desc")}</p>
          </div>
          {/* Day / Week / Month toggle */}
          <div className="flex shrink-0 overflow-hidden rounded-md border">
            {(["day", "week", "month"] as ChartMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setChartMode(m)}
                className={cn(
                  "px-3 py-1 text-xs font-medium capitalize transition-colors",
                  chartMode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                {t(`monitoring.chart_${m}` as "monitoring.chart_day")}
              </button>
            ))}
          </div>
        </div>
        <LineChart entries={filtered} mode={chartMode} />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("monitoring.table_col_date")}</TableHead>
              <TableHead>{t("monitoring.table_col_endpoint")}</TableHead>
              <TableHead>{t("monitoring.table_col_content")}</TableHead>
              <TableHead>{t("monitoring.table_col_source")}</TableHead>
              <TableHead className="text-right">{t("monitoring.table_col_duration")}</TableHead>
              <TableHead className="text-right">{t("monitoring.table_col_verdict")}</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-10 text-center text-sm">
                  {t("monitoring.no_filtered_desc")}
                </TableCell>
              </TableRow>
            ) : (
              pageEntries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={cn("transition-colors", entry.error && "bg-red-500/5")}
                >
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {fmtDate(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <EndpointBadge endpoint={entry.endpoint} />
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {entry.content ? (
                      <span
                        className="text-muted-foreground block truncate text-xs"
                        title={entry.content}
                      >
                        {entry.content.slice(0, 60)}
                        {entry.content.length > 60 ? "…" : ""}
                      </span>
                    ) : entry.error ? (
                      <span className="block truncate text-xs text-red-500">
                        {entry.error.slice(0, 60)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-medium">{entry.sourceName}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {fmtDuration(entry.durationMs)}
                  </TableCell>
                  <TableCell className="text-right">
                    <VerdictBadge verdict={entry.verdict} />
                  </TableCell>
                  <TableCell>
                    {(entry.content || entry.error) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setDialogEntry(entry)}
                      >
                        <Eye className="text-muted-foreground size-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination — always visible when there are entries */}
        {total > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-muted-foreground text-xs">
                {t("monitoring.pagination_range", { from, to, total })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-muted-foreground px-1 text-xs">
                  {page + 1} / {Math.max(1, totalPages)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Content detail dialog ──────────────────────────────────────── */}
      <ContentDialog
        entry={dialogEntry}
        open={dialogEntry !== null}
        onClose={() => setDialogEntry(null)}
      />
    </div>
  );
}
