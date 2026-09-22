/**
 * Reports page — interactive run history, charts, and export.
 *
 * Data source: `useSuiteStore().runHistory`, a persisted list of every
 * `SuiteRunResult` appended by the suite runner after each run. No API
 * calls needed — all data is local.
 *
 * Features:
 *  • KPI tiles (total runs, pass rate, cases executed, avg duration)
 *  • SVG pass-rate donut + run-trend bar chart
 *  • Per-suite breakdown table
 *  • Searchable / filterable / sortable run history accordion
 *  • Per-case assertion detail inside each run
 *  • Export to JSON, CSV, or HTML (response bodies stripped for privacy)
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileBarChart,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useSuiteStore } from "@/stores/suite-store";
import { useRequestLogStore } from "@/stores/request-log-store";
import { cn } from "@/lib/utils";
import type { AssertionResult, CaseResult, SuiteRunResult } from "@/types/suite";
import type { RequestLogEntry, RequestSource } from "@/types/request-log";
import type { EndpointId } from "@/types/request";

// ──────────────────────────────────────────────────────── Helpers ─────────

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function passColor(rate: number): string {
  if (rate >= 0.9) return "#10b981";
  if (rate >= 0.5) return "#f59e0b";
  return "#ef4444";
}

function passTextClass(rate: number): string {
  if (rate >= 0.9) return "text-emerald-600";
  if (rate >= 0.5) return "text-amber-500";
  return "text-red-500";
}

// ──────────────────────────────────────────────────────── Date filter ────

type DatePreset = "all" | "today" | "week" | "month" | "custom";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: "All time",
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  custom: "Custom range",
};

function applyDateFilter(ts: number, preset: DatePreset, from: string, to: string): boolean {
  if (preset === "all") return true;
  const now = Date.now();
  if (preset === "today") {
    const sod = new Date();
    sod.setHours(0, 0, 0, 0);
    return ts >= sod.getTime();
  }
  if (preset === "week") return ts >= now - 7 * 86_400_000;
  if (preset === "month") return ts >= now - 30 * 86_400_000;
  if (preset === "custom") {
    const lo = from ? new Date(from).getTime() : 0;
    const hi = to ? new Date(to + "T23:59:59.999").getTime() : Infinity;
    return ts >= lo && ts <= hi;
  }
  return true;
}

function DateRangeFilter({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onFromChange,
  onToChange,
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (p: DatePreset) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarDays className="text-muted-foreground size-3.5 shrink-0" />
      {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPresetChange(p)}
          className={cn(
            "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
            preset === p
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground hover:bg-muted"
          )}
        >
          {DATE_PRESET_LABELS[p]}
        </button>
      ))}
      {preset === "custom" && (
        <>
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => onFromChange(e.target.value)}
            className="h-7 w-36 px-2 text-xs"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => onToChange(e.target.value)}
            className="h-7 w-36 px-2 text-xs"
          />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────── SVG Charts ──────

/** Ring / donut chart showing a percentage. */
function DonutChart({
  passed,
  total,
  size = 120,
  label,
}: {
  passed: number;
  total: number;
  size?: number;
  label?: string;
}) {
  const rate = total === 0 ? 0 : passed / total;
  const r = (size - 20) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * rate;
  const color = total === 0 ? "#9ca3af" : passColor(rate);
  const pct = Math.round(rate * 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        aria-label={`${pct}% pass rate`}
      >
        {/* Track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          className="text-muted/60"
        />
        {/* Fill */}
        {total > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeDasharray={`${filled} ${circumference - filled}`}
            strokeDashoffset={circumference / 4}
            strokeLinecap="round"
          />
        )}
        {/* Center text */}
        <text
          x={c}
          y={c - 5}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size / 4.5}
          fontWeight="700"
          fill={color}
        >
          {pct}%
        </text>
        <text
          x={c}
          y={c + size / 7}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size / 9}
          fill="currentColor"
          opacity={0.45}
        >
          {passed}/{total}
        </text>
      </svg>
      {label && <span className="text-muted-foreground text-xs font-medium">{label}</span>}
    </div>
  );
}

/** Vertical stacked bar chart showing pass (green) / fail (red) per run. */
function TrendBars({ runs }: { runs: SuiteRunResult[] }) {
  // Show last 30 runs, oldest left → newest right
  const displayed = [...runs].reverse().slice(0, 30);
  if (displayed.length === 0) {
    return (
      <div className="text-muted-foreground flex h-16 w-full items-center justify-center text-xs">
        No data yet
      </div>
    );
  }

  const BAR_H = 72;
  const BAR_W = 12;
  const GAP = 3;
  const totalW = displayed.length * (BAR_W + GAP);
  const maxTotal = Math.max(...displayed.map((r) => r.total), 1);

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalW}
        height={BAR_H}
        viewBox={`0 0 ${totalW} ${BAR_H}`}
        aria-label="Run trend chart"
      >
        {displayed.map((run, i) => {
          const x = i * (BAR_W + GAP);
          const scaledH = (run.total / maxTotal) * BAR_H;
          const passH = run.total === 0 ? 0 : (run.passed / run.total) * scaledH;
          const failH = scaledH - passH;
          const allPassed = run.failed === 0;

          return (
            <g key={run.startedAt}>
              <title>
                {run.suiteName}: {run.passed}/{run.total} passed ·{" "}
                {fmtDuration(run.finishedAt - run.startedAt)}
              </title>
              {/* Fail segment (top) */}
              {failH > 0 && (
                <rect
                  x={x}
                  y={BAR_H - scaledH}
                  width={BAR_W}
                  height={failH}
                  fill="#ef4444"
                  opacity={0.75}
                  rx={1}
                />
              )}
              {/* Pass segment (bottom) */}
              {passH > 0 && (
                <rect
                  x={x}
                  y={BAR_H - passH}
                  width={BAR_W}
                  height={passH}
                  fill={allPassed ? "#10b981" : "#34d399"}
                  opacity={0.85}
                  rx={1}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────── KPI Card ────────

function KpiCard({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <Card className="min-w-0 flex-1">
      <CardContent className="px-5 py-4">
        <p className="text-muted-foreground truncate text-xs font-medium tracking-wider uppercase">
          {label}
        </p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums", colorClass ?? "text-foreground")}>
          {value}
        </p>
        {sub && <p className="text-muted-foreground mt-0.5 truncate text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────── Per-Suite ───────

function PerSuiteBreakdown({ history }: { history: SuiteRunResult[] }) {
  const { t } = useTranslation();
  type SuiteStat = { name: string; runs: number; cases: number; passed: number; totalMs: number };
  const map = new Map<string, SuiteStat>();
  for (const run of history) {
    const stat = map.get(run.suiteId) ?? {
      name: run.suiteName,
      runs: 0,
      cases: 0,
      passed: 0,
      totalMs: 0,
    };
    stat.runs += 1;
    stat.cases += run.total;
    stat.passed += run.passed;
    stat.totalMs += run.finishedAt - run.startedAt;
    map.set(run.suiteId, stat);
  }
  const rows = [...map.values()].sort((a, b) => b.runs - a.runs);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reports.col_suite")}</TableHead>
          <TableHead className="text-right">{t("reports.col_runs")}</TableHead>
          <TableHead className="text-right">{t("reports.col_cases")}</TableHead>
          <TableHead className="text-right">{t("reports.col_pass_rate")}</TableHead>
          <TableHead className="text-right">{t("reports.col_avg_dur")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const rate = row.cases === 0 ? 0 : row.passed / row.cases;
          const avgMs = row.runs === 0 ? 0 : row.totalMs / row.runs;
          return (
            <TableRow key={row.name}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell className="text-muted-foreground text-right">{row.runs}</TableCell>
              <TableCell className="text-muted-foreground text-right">{row.cases}</TableCell>
              <TableCell className={cn("text-right font-medium", passTextClass(rate))}>
                {Math.round(rate * 100)}%
              </TableCell>
              <TableCell className="text-muted-foreground text-right">
                {fmtDuration(Math.round(avgMs))}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ──────────────────────────────────────────────────────── Case detail ─────

function AssertionRow({ ar }: { ar: AssertionResult }) {
  return (
    <div className="flex items-start gap-2 py-0.5 font-mono text-xs">
      {ar.passed ? (
        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-3 shrink-0 text-red-500" />
      )}
      <span className="text-muted-foreground">{ar.label}</span>
      {!ar.passed && <span className="ml-auto shrink-0 text-red-500">got: {ar.actual}</span>}
    </div>
  );
}

function CaseDetailTable({ caseResults }: { caseResults: CaseResult[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>{t("reports.case_col_name")}</TableHead>
            <TableHead>{t("reports.case_col_endpoint")}</TableHead>
            <TableHead className="text-right">{t("reports.case_col_status")}</TableHead>
            <TableHead className="text-right">{t("reports.case_col_duration")}</TableHead>
            <TableHead className="text-right">{t("reports.case_col_outcome")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {caseResults.map((cr) => {
            const isOpen = expanded.has(cr.caseId);
            const hasAssertions = cr.assertionResults.length > 0;
            const hasError = Boolean(cr.error);
            const hasBody = Boolean(cr.responseBody) && !cr.passed;

            return (
              <React.Fragment key={cr.caseId}>
                <TableRow
                  className={cn(
                    "transition-colors",
                    (hasAssertions || hasError || hasBody) && "hover:bg-muted/40 cursor-pointer"
                  )}
                  onClick={() => {
                    if (hasAssertions || hasError || hasBody) toggle(cr.caseId);
                  }}
                >
                  <TableCell className="pr-0">
                    {hasAssertions || hasError || hasBody ? (
                      isOpen ? (
                        <ChevronDown className="text-muted-foreground size-3" />
                      ) : (
                        <ChevronRight className="text-muted-foreground size-3" />
                      )
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{cr.caseName}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {/* caseId doesn't store endpoint, use responseBody to derive... nope.
                        We don't have endpoint stored in CaseResult, so leave a dash. */}
                    —
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {cr.status > 0 ? (
                      <span
                        className={cn(
                          cr.status >= 200 && cr.status < 300 ? "text-emerald-600" : "text-red-500"
                        )}
                      >
                        {cr.status}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {fmtDuration(cr.durationMs)}
                  </TableCell>
                  <TableCell className="text-right">
                    {cr.passed ? (
                      <Badge className="gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-600">
                        <CheckCircle2 className="size-3" />
                        {t("reports.passed")}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1 text-xs">
                        <XCircle className="size-3" />
                        {cr.error ? t("reports.error") : t("reports.failed")}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>

                {/* Expanded: assertions + error + body */}
                {isOpen && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell />
                    <TableCell colSpan={5} className="px-3 py-2">
                      <div className="space-y-2">
                        {cr.error && <p className="font-mono text-xs text-red-500">{cr.error}</p>}

                        {cr.assertionResults.length > 0 && (
                          <div className="space-y-0.5">
                            {cr.assertionResults.map((ar, idx) => (
                              <AssertionRow key={idx} ar={ar} />
                            ))}
                          </div>
                        )}

                        {!cr.passed && cr.responseBody && (
                          <div className="space-y-1 pt-1">
                            <p className="text-muted-foreground text-xs font-medium">
                              {t("reports.response_body")}
                            </p>
                            <pre className="bg-background max-h-40 overflow-auto rounded border p-2 font-mono text-xs break-all whitespace-pre-wrap">
                              {cr.responseBody}
                            </pre>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Run row ─────────

function RunRow({ run, onDelete }: { run: SuiteRunResult; onDelete: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const allPassed = run.failed === 0;
  const durationMs = run.finishedAt - run.startedAt;
  const passRate = run.total === 0 ? 1 : run.passed / run.total;

  return (
    <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
      {/* Header row */}
      <button
        type="button"
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Chevron */}
        {open ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}

        {/* Outcome icon */}
        {allPassed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="size-4 shrink-0 text-red-500" />
        )}

        {/* Suite name */}
        <span className="flex-1 truncate text-sm font-medium">{run.suiteName}</span>

        {/* Pass/fail badge */}
        <Badge
          className={cn(
            "shrink-0 gap-1 text-xs",
            allPassed
              ? "bg-emerald-600 text-white hover:bg-emerald-600"
              : "bg-red-500 text-white hover:bg-red-500"
          )}
        >
          {run.passed}/{run.total} {t("reports.passed")}
        </Badge>

        {/* Mini pass bar */}
        <div className="bg-muted h-1.5 w-16 shrink-0 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(passRate * 100)}%`,
              backgroundColor: passColor(passRate),
            }}
          />
        </div>

        {/* Duration */}
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <Clock className="size-3" />
          {fmtDuration(durationMs)}
        </span>

        {/* Date */}
        <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
          {fmtDate(run.startedAt)}
        </span>

        {/* Delete */}
        <button
          type="button"
          className="text-muted-foreground shrink-0 rounded p-1 transition-colors hover:text-red-500"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={t("reports.delete_run")}
        >
          <Trash2 className="size-3.5" />
        </button>
      </button>

      {/* Expanded: case table */}
      {open && (
        <div className="border-t px-4 py-3">
          <CaseDetailTable caseResults={run.caseResults} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────── Export helpers ──

function redact(runs: SuiteRunResult[]): SuiteRunResult[] {
  return runs.map((run) => ({
    ...run,
    caseResults: run.caseResults.map((cr) => ({
      ...cr,
      responseBody: undefined, // strip raw response content
    })),
  }));
}

async function exportJSON(runs: SuiteRunResult[], t: (k: string) => string) {
  const payload = {
    exportedAt: new Date().toISOString(),
    note: t("reports.export_redacted_note"),
    totalRuns: runs.length,
    runs: redact(runs),
  };
  const content = JSON.stringify(payload, null, 2);
  const filePath = await save({
    defaultPath: `confinaid-report-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(content));
}

async function exportCSV(runs: SuiteRunResult[]) {
  const header =
    "runDate,suiteName,runDurationMs,runPassed,runFailed,runTotal,caseName,caseStatus,caseDurationMs,caseOutcome,caseError,failedAssertions";
  const rows: string[] = [header];

  for (const run of runs) {
    const runDate = new Date(run.startedAt).toISOString();
    const runDur = run.finishedAt - run.startedAt;
    for (const cr of run.caseResults) {
      const failedA = cr.assertionResults
        .filter((a) => !a.passed)
        .map((a) => `${a.label} (got: ${a.actual})`)
        .join("; ");
      const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      rows.push(
        [
          cell(runDate),
          cell(run.suiteName),
          runDur,
          run.passed,
          run.failed,
          run.total,
          cell(cr.caseName),
          cr.status,
          cr.durationMs,
          cell(cr.passed ? "passed" : cr.error ? "error" : "failed"),
          cell(cr.error ?? ""),
          cell(failedA),
        ].join(",")
      );
    }
  }

  const content = rows.join("\n");
  const filePath = await save({
    defaultPath: `confinaid-report-${Date.now()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(content));
}

async function exportHTML(runs: SuiteRunResult[], t: (k: string) => string) {
  const totalCases = runs.reduce((a, r) => a + r.total, 0);
  const totalPassed = runs.reduce((a, r) => a + r.passed, 0);
  const passRate = totalCases === 0 ? 0 : Math.round((totalPassed / totalCases) * 100);
  const avgDur =
    runs.length === 0
      ? 0
      : Math.round(runs.reduce((a, r) => a + (r.finishedAt - r.startedAt), 0) / runs.length);

  const badge = (passed: boolean) =>
    passed
      ? `<span class="badge pass">✓ passed</span>`
      : `<span class="badge fail">✗ failed</span>`;

  const runSections = runs
    .map((run) => {
      const dur = run.finishedAt - run.startedAt;
      const caseRows = run.caseResults
        .map((cr) => {
          const failedA = cr.assertionResults
            .filter((a) => !a.passed)
            .map((a) => `${a.label} → got: ${a.actual}`)
            .join("<br>");
          return `<tr>
            <td>${cr.caseName}</td>
            <td>${cr.status > 0 ? cr.status : "—"}</td>
            <td>${cr.durationMs}ms</td>
            <td>${badge(cr.passed)}</td>
            <td class="mono small">${cr.error ? cr.error : failedA}</td>
          </tr>`;
        })
        .join("\n");

      const allPassed = run.failed === 0;
      return `<section class="run ${allPassed ? "run-pass" : "run-fail"}">
        <div class="run-header">
          <span class="run-name">${run.suiteName}</span>
          <span class="run-meta">${new Date(run.startedAt).toLocaleString()} · ${dur}ms · ${run.passed}/${run.total} passed</span>
          ${badge(allPassed)}
        </div>
        <table>
          <thead><tr><th>Case</th><th>Status</th><th>Duration</th><th>Outcome</th><th>Failures</th></tr></thead>
          <tbody>${caseRows}</tbody>
        </table>
      </section>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Confinaid Test Report — ${new Date().toLocaleDateString()}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; color: #111; background: #f9fafb; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .kpi-row { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  .kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; min-width: 120px; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin-bottom: 4px; }
  .kpi-value { font-size: 26px; font-weight: 700; }
  .green { color: #059669; } .yellow { color: #d97706; } .red { color: #dc2626; } .gray { color: #374151; }
  .run { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .run-pass .run-header { border-left: 4px solid #10b981; }
  .run-fail .run-header { border-left: 4px solid #ef4444; }
  .run-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #f9fafb; flex-wrap: wrap; }
  .run-name { font-weight: 600; font-size: 15px; flex: 1; }
  .run-meta { font-size: 12px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; }
  td { padding: 8px 12px; border-top: 1px solid #f3f4f6; font-size: 13px; vertical-align: top; }
  tr:hover td { background: #f9fafb; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .badge.pass { background: #d1fae5; color: #065f46; }
  .badge.fail { background: #fee2e2; color: #991b1b; }
  .mono { font-family: monospace; font-size: 11px; color: #6b7280; }
  .small { font-size: 11px; }
  .note { font-size: 11px; color: #9ca3af; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
</style>
</head>
<body>
<h1>Confinaid Test Report</h1>
<p class="subtitle">${t("reports.export_redacted_note")} · Exported ${new Date().toLocaleString()}</p>

<div class="kpi-row">
  <div class="kpi">
    <div class="kpi-label">Total Runs</div>
    <div class="kpi-value gray">${runs.length}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Pass Rate</div>
    <div class="kpi-value ${passRate >= 90 ? "green" : passRate >= 50 ? "yellow" : "red"}">${passRate}%</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Cases Run</div>
    <div class="kpi-value gray">${totalCases}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Avg Duration</div>
    <div class="kpi-value gray">${fmtDuration(avgDur)}</div>
  </div>
</div>

${runSections}

<p class="note">API secrets are managed by the OS keychain and are never included in exports. Response bodies have been omitted.</p>
</body>
</html>`;

  const filePath = await save({
    defaultPath: `confinaid-report-${Date.now()}.html`,
    filters: [{ name: "HTML Document", extensions: ["html"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(html));
}

// ──────────────────────────────────────────────────────── API Requests tab ─

const LOG_PAGE_SIZE = 20;

type LogSourceFilter = "all" | RequestSource;

const SOURCE_LABELS: Record<RequestSource, string> = {
  requests: "Requests",
  bulk: "Bulk Import",
  suite: "Suite Cases",
  playground: "Playground",
};

const ENDPOINT_PATHS: Record<EndpointId, string> = {
  Token: "/v1/token",
  Refresh: "/v1/token/refresh",
  Revoke: "/v1/token/revoke",
  Analyze: "/v1/analyze",
  Rewrite: "/v1/rewrite",
  Graphrag: "/v1/graphrag",
};

const ENDPOINT_BADGE_CLASSES: Record<EndpointId, string> = {
  Token: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  Refresh: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  Revoke: "bg-slate-500/10 text-slate-700 border-slate-500/30",
  Analyze: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  Rewrite: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  Graphrag: "bg-teal-500/10 text-teal-700 border-teal-500/30",
};

function verdictColor(v: RequestLogEntry["verdict"]) {
  if (v === "safe") return "text-emerald-600";
  if (v === "risky") return "text-red-500";
  if (v === "hitl") return "text-amber-500";
  return "text-muted-foreground";
}

function verdictLabel(v: RequestLogEntry["verdict"]): string {
  if (v === "safe") return "Clean";
  if (v === "risky") return "Risky";
  if (v === "hitl") return "HITL";
  return "—";
}

// Minimal SVG line chart for the API requests tab
const LOG_SERIES = [
  {
    key: "a",
    label: "Analyses",
    color: "#3b82f6",
    test: (e: RequestLogEntry) => e.endpoint === "Analyze",
  },
  {
    key: "r",
    label: "Risky",
    color: "#ef4444",
    test: (e: RequestLogEntry) => e.verdict === "risky",
  },
  { key: "h", label: "HITL", color: "#f59e0b", test: (e: RequestLogEntry) => e.verdict === "hitl" },
  {
    key: "c",
    label: "Clean",
    color: "#10b981",
    test: (e: RequestLogEntry) => e.verdict === "safe",
  },
] as const;

function LogLineChart({ entries }: { entries: RequestLogEntry[] }) {
  if (entries.length === 0)
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-xs">
        No data
      </div>
    );

  const bucketOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const buckets = [...new Set(entries.map((e) => bucketOf(e.timestamp)))].sort();
  const counts = LOG_SERIES.map((s) => ({
    ...s,
    pts: buckets.map((b) => entries.filter((e) => bucketOf(e.timestamp) === b && s.test(e)).length),
  }));
  const maxC = Math.max(1, ...counts.flatMap((s) => s.pts));

  const W = 800;
  const H = 120;
  const PL = 28;
  const PR = 12;
  const PT = 8;
  const PB = 24;
  const cW = W - PL - PR;
  const cH = H - PT - PB;
  const xOf = (i: number) => PL + (buckets.length === 1 ? cW / 2 : (i / (buckets.length - 1)) * cW);
  const yOf = (v: number) => PT + cH - (v / maxC) * cH;

  const step = Math.max(1, Math.ceil(buckets.length / 6));
  const labelIdxs = buckets
    .map((_, i) => i)
    .filter((i) => i % step === 0 || i === buckets.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 240, height: 120 }}>
        {[0, Math.ceil(maxC / 2), maxC].map((v) => (
          <g key={v}>
            <line
              x1={PL}
              y1={yOf(v)}
              x2={W - PR}
              y2={yOf(v)}
              stroke="currentColor"
              strokeOpacity={0.07}
              strokeWidth={1}
            />
            <text
              x={PL - 4}
              y={yOf(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.4}
            >
              {v}
            </text>
          </g>
        ))}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={H - 5}
            textAnchor="middle"
            fontSize={8}
            fill="currentColor"
            opacity={0.4}
          >
            {new Date(buckets[i] + "T00:00:00").toLocaleString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </text>
        ))}
        {counts.map((s) => {
          if (s.pts.every((v) => v === 0)) return null;
          const pts = s.pts.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.9}
              />
              {s.pts.map((v, i) =>
                v > 0 ? (
                  <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2.5} fill={s.color} opacity={0.85} />
                ) : null
              )}
            </g>
          );
        })}
      </svg>
      <div className="text-muted-foreground mt-1 flex flex-wrap justify-center gap-3 text-xs">
        {LOG_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-4 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Log export helpers ────────────────────────────────────────────────────

async function exportLogJSON(entries: RequestLogEntry[]) {
  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Client secrets are managed by the OS keychain and are never included in exports.",
    totalEntries: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      endpoint: e.endpoint,
      source: e.source,
      sourceName: e.sourceName,
      verdict: e.verdict,
      riskScore: e.riskScore,
      durationMs: e.durationMs,
      content: e.content ?? null,
      error: e.error ?? null,
    })),
  };
  const filePath = await save({
    defaultPath: `confinaid-api-log-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
}

async function exportLogCSV(entries: RequestLogEntry[]) {
  const header = "date,endpoint,source,sourceName,verdict,riskScore,durationMs,error,content";
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    header,
    ...entries.map((e) =>
      [
        cell(new Date(e.timestamp).toISOString()),
        cell(e.endpoint),
        cell(e.source),
        cell(e.sourceName),
        cell(e.verdict ?? ""),
        e.riskScore !== null && e.riskScore !== undefined
          ? Math.round(e.riskScore * 100) + "%"
          : "",
        e.durationMs,
        cell(e.error ?? ""),
        cell(e.content ?? ""),
      ].join(",")
    ),
  ];
  const filePath = await save({
    defaultPath: `confinaid-api-log-${Date.now()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(rows.join("\n")));
}

async function exportLogHTML(entries: RequestLogEntry[]) {
  const total = entries.length;
  const safe = entries.filter((e) => e.verdict === "safe").length;
  const risky = entries.filter((e) => e.verdict === "risky").length;
  const hitl = entries.filter((e) => e.verdict === "hitl").length;
  const safeRate = total === 0 ? 0 : Math.round((safe / total) * 100);

  const verdictBadge = (v: string | null | undefined) => {
    if (v === "safe") return `<span class="badge pass">✓ safe</span>`;
    if (v === "risky") return `<span class="badge fail">✗ risky</span>`;
    if (v === "hitl") return `<span class="badge warn">⚠ hitl</span>`;
    return `<span class="badge gray">—</span>`;
  };

  const rows = entries
    .map(
      (e) => `<tr>
    <td class="small">${new Date(e.timestamp).toLocaleString()}</td>
    <td class="mono">${ENDPOINT_PATHS[e.endpoint]}</td>
    <td>${e.sourceName}</td>
    <td>${verdictBadge(e.verdict)}</td>
    <td class="mono small">${e.riskScore !== null && e.riskScore !== undefined ? Math.round(e.riskScore * 100) + "%" : "—"}</td>
    <td class="small">${e.durationMs > 0 ? e.durationMs + " ms" : "—"}</td>
    <td class="small mono">${e.error ? `<span class="err">${e.error.slice(0, 120)}</span>` : e.content ? e.content.slice(0, 120) + (e.content.length > 120 ? "…" : "") : "—"}</td>
  </tr>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Confinaid API Request Log — ${new Date().toLocaleDateString()}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; color: #111; background: #f9fafb; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .kpi-row { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  .kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; min-width: 100px; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin-bottom: 4px; }
  .kpi-value { font-size: 26px; font-weight: 700; }
  .green { color: #059669; } .yellow { color: #d97706; } .red { color: #dc2626; } .gray { color: #374151; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 8px 12px; border-top: 1px solid #f3f4f6; font-size: 13px; vertical-align: top; }
  tr:hover td { background: #f9fafb; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .badge.pass { background: #d1fae5; color: #065f46; }
  .badge.fail { background: #fee2e2; color: #991b1b; }
  .badge.warn { background: #fef3c7; color: #92400e; }
  .badge.gray { background: #f3f4f6; color: #6b7280; }
  .mono { font-family: monospace; }
  .small { font-size: 12px; color: #6b7280; }
  .err { color: #dc2626; }
  .note { font-size: 11px; color: #9ca3af; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
</style>
</head>
<body>
<h1>Confinaid API Request Log</h1>
<p class="subtitle">Exported ${new Date().toLocaleString()}</p>

<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value gray">${total}</div></div>
  <div class="kpi"><div class="kpi-label">Safe rate</div><div class="kpi-value ${safeRate >= 80 ? "green" : safeRate >= 50 ? "yellow" : "red"}">${safeRate}%</div></div>
  <div class="kpi"><div class="kpi-label">Safe</div><div class="kpi-value green">${safe}</div></div>
  <div class="kpi"><div class="kpi-label">Risky</div><div class="kpi-value red">${risky}</div></div>
  <div class="kpi"><div class="kpi-label">HITL</div><div class="kpi-value yellow">${hitl}</div></div>
</div>

<table>
  <thead><tr><th>Date</th><th>Endpoint</th><th>Source</th><th>Verdict</th><th>Risk</th><th>Duration</th><th>Content / Error</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<p class="note">Client secrets are managed by the OS keychain and are never included in exports.</p>
</body>
</html>`;

  const filePath = await save({
    defaultPath: `confinaid-api-log-${Date.now()}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!filePath) return;
  await writeFile(filePath, new TextEncoder().encode(html));
}

// ─── API Requests tab ──────────────────────────────────────────────────────

function ApiRequestsTab() {
  const { entries } = useRequestLogStore();
  const [sourceFilter, setSourceFilter] = useState<LogSourceFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [logPage, setLogPage] = useState(0);
  const [dialogEntry, setDialogEntry] = useState<RequestLogEntry | null>(null);

  const filtered = entries.filter(
    (e) =>
      (sourceFilter === "all" || e.source === sourceFilter) &&
      applyDateFilter(e.timestamp, datePreset, dateFrom, dateTo)
  );

  const totalPages = Math.ceil(filtered.length / LOG_PAGE_SIZE);
  const pageEntries = filtered.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : logPage * LOG_PAGE_SIZE + 1;
  const to = Math.min((logPage + 1) * LOG_PAGE_SIZE, filtered.length);

  const analyses = filtered.filter((e) => e.endpoint === "Analyze").length;
  const rewrites = filtered.filter((e) => e.endpoint === "Rewrite").length;
  const clean = filtered.filter((e) => e.verdict === "safe").length;
  const risky = filtered.filter((e) => e.verdict === "risky").length;
  const hitl = filtered.filter((e) => e.verdict === "hitl").length;

  const handleSourceChange = (v: LogSourceFilter) => {
    setSourceFilter(v);
    setLogPage(0);
  };
  const handlePresetChange = (p: DatePreset) => {
    setDatePreset(p);
    setLogPage(0);
  };

  if (entries.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Activity className="text-muted-foreground/50 size-8" />
        <p className="text-sm font-medium">No API requests logged yet</p>
        <p className="text-muted-foreground max-w-xs text-xs">
          Send requests from the Requests page, run a Test Suite, or use the Playground — every call
          is logged here automatically.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Source filter + export */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "requests", "bulk", "playground", "suite"] as LogSourceFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSourceChange(s)}
            className={cn(
              "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
              sourceFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {s === "all" ? "All sources" : SOURCE_LABELS[s]}
          </button>
        ))}
        <span className="text-muted-foreground text-xs">{filtered.length} entries</span>

        {/* Export dropdown */}
        {filtered.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 text-xs">
                <Download className="size-3" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2" onClick={() => void exportLogJSON(filtered)}>
                <FileText className="size-4" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => void exportLogCSV(filtered)}>
                <FileSpreadsheet className="size-4" />
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => void exportLogHTML(filtered)}>
                <FileCode2 className="size-4" />
                Export as HTML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Date range filter */}
      <DateRangeFilter
        preset={datePreset}
        customFrom={dateFrom}
        customTo={dateTo}
        onPresetChange={handlePresetChange}
        onFromChange={(v) => {
          setDateFrom(v);
          setLogPage(0);
        }}
        onToChange={(v) => {
          setDateTo(v);
          setLogPage(0);
        }}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <KpiCard label="Total" value={String(filtered.length)} />
        <KpiCard label="Analyses" value={String(analyses)} />
        <KpiCard label="Rewrites" value={String(rewrites)} />
        <KpiCard label="Clean" value={String(clean)} colorClass="text-emerald-600" />
        <KpiCard label="Risky" value={String(risky)} colorClass="text-red-500" />
        <KpiCard label="HITL" value={String(hitl)} colorClass="text-amber-500" />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="px-4 pt-3 pb-1">
          <CardTitle className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            API Traffic Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <LogLineChart entries={filtered} />
        </CardContent>
      </Card>

      {/* Table */}
      <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Content</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Verdict</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
                  No entries match this filter.
                </TableCell>
              </TableRow>
            ) : (
              pageEntries.map((entry) => (
                <TableRow key={entry.id} className={cn(entry.error && "bg-red-500/5")}>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {fmtDate(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("font-mono text-xs", ENDPOINT_BADGE_CLASSES[entry.endpoint])}
                    >
                      {ENDPOINT_PATHS[entry.endpoint]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    {entry.content ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {entry.content.slice(0, 55)}
                        {entry.content.length > 55 ? "…" : ""}
                      </span>
                    ) : entry.error ? (
                      <span className="block truncate text-xs text-red-500">
                        {entry.error.slice(0, 55)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{entry.sourceName}</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {entry.durationMs > 0 ? `${entry.durationMs} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn("text-xs font-medium", verdictColor(entry.verdict))}>
                      {verdictLabel(entry.verdict)}
                    </span>
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
        {filtered.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-muted-foreground text-xs">
                {from}–{to} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={logPage === 0}
                  onClick={() => setLogPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-muted-foreground px-1 text-xs">
                  {logPage + 1} / {Math.max(1, totalPages)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={logPage >= totalPages - 1}
                  onClick={() => setLogPage((p) => p + 1)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={dialogEntry !== null} onOpenChange={(v) => !v && setDialogEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Request detail</DialogTitle>
          </DialogHeader>
          {dialogEntry && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("font-mono text-xs", ENDPOINT_BADGE_CLASSES[dialogEntry.endpoint])}
                >
                  {ENDPOINT_PATHS[dialogEntry.endpoint]}
                </Badge>
                <span className={cn("text-xs font-medium", verdictColor(dialogEntry.verdict))}>
                  {verdictLabel(dialogEntry.verdict)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {fmtDate(dialogEntry.timestamp)}
                </span>
              </div>
              {dialogEntry.riskScore !== null && (
                <p className="text-muted-foreground text-xs">
                  Risk score:{" "}
                  <span className="font-mono font-medium">
                    {Math.round((dialogEntry.riskScore ?? 0) * 100)}%
                  </span>
                </p>
              )}
              {dialogEntry.content ? (
                <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">
                  {dialogEntry.content}
                </pre>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  No content for this endpoint type.
                </p>
              )}
              {dialogEntry.error && (
                <p className="font-mono text-xs text-red-500">{dialogEntry.error}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Empty state ─────

function EmptyReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="bg-muted/60 flex h-16 w-16 items-center justify-center rounded-2xl">
        <FileBarChart className="text-muted-foreground/70 h-8 w-8" />
      </div>
      <div className="max-w-sm space-y-1">
        <h2 className="text-base font-semibold">{t("reports.no_history_title")}</h2>
        <p className="text-muted-foreground text-sm">{t("reports.no_history_desc")}</p>
      </div>
      <Button variant="outline" className="gap-2" onClick={() => void navigate("/suites")}>
        <FlaskConical className="size-4" />
        {t("reports.go_to_suites")}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Page ────────────

type FilterOutcome = "all" | "passed" | "failed";
type SortBy = "newest" | "oldest" | "duration_desc";

export function ReportsPage() {
  const { t } = useTranslation();
  const { runHistory, deleteHistoryEntry, clearHistory } = useSuiteStore();
  const { entries: logEntries } = useRequestLogStore();

  const [search, setSearch] = useState("");
  const [filterOutcome, setFilterOutcome] = useState<FilterOutcome>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [confirmClear, setConfirmClear] = useState(false);
  const [suiteDatePreset, setSuiteDatePreset] = useState<DatePreset>("all");
  const [suiteDateFrom, setSuiteDateFrom] = useState("");
  const [suiteDateTo, setSuiteDateTo] = useState("");

  // ── Filter + sort (date filter applied first so KPIs/charts reflect it) ─
  const filtered = runHistory
    .filter((r) => {
      const matchSearch =
        search.trim() === "" || r.suiteName.toLowerCase().includes(search.toLowerCase());
      const matchOutcome =
        filterOutcome === "all" ||
        (filterOutcome === "passed" && r.failed === 0) ||
        (filterOutcome === "failed" && r.failed > 0);
      const matchDate = applyDateFilter(r.startedAt, suiteDatePreset, suiteDateFrom, suiteDateTo);
      return matchSearch && matchOutcome && matchDate;
    })
    .sort((a, b) => {
      if (sortBy === "newest") return b.startedAt - a.startedAt;
      if (sortBy === "oldest") return a.startedAt - b.startedAt;
      return b.finishedAt - b.startedAt - (a.finishedAt - a.startedAt);
    });

  // ── Derived stats — computed from filtered so date range updates everything ─
  const totalRuns = filtered.length;
  const totalCases = filtered.reduce((a, r) => a + r.total, 0);
  const totalPassed = filtered.reduce((a, r) => a + r.passed, 0);
  const passRate = totalCases === 0 ? 0 : totalPassed / totalCases;
  const avgDurMs =
    totalRuns === 0
      ? 0
      : filtered.reduce((a, r) => a + (r.finishedAt - r.startedAt), 0) / totalRuns;

  const hasHistory = runHistory.length > 0; // use full history for empty-state check
  const hasLog = logEntries.length > 0;

  if (!hasHistory && !hasLog) return <EmptyReports />;

  return (
    <Tabs
      defaultValue={hasHistory ? "suites" : "requests"}
      className="flex flex-col gap-4 py-1 pb-10"
    >
      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="suites" className="gap-1.5">
            <FlaskConical className="size-3.5" />
            {t("reports.tab_suites")}
            {totalRuns > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-xs">
                {totalRuns}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5">
            <Activity className="size-3.5" />
            {t("reports.tab_requests")}
            {logEntries.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-xs">
                {logEntries.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      {/* ══ Test Suites tab ════════════════════════════════════════════════ */}
      <TabsContent value="suites" className="mt-0">
        {!hasHistory ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <FlaskConical className="text-muted-foreground/50 size-8" />
            <p className="text-sm font-medium">{t("reports.no_history_title")}</p>
            <p className="text-muted-foreground max-w-xs text-xs">{t("reports.no_history_desc")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* ── Page header ────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-lg font-semibold">{t("reports.title")}</h1>

              <div className="flex items-center gap-2">
                {/* Export dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Download className="size-3.5" />
                      {t("reports.export_title")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => void exportJSON(filtered, t)}
                    >
                      <FileText className="size-4" />
                      {t("reports.export_json")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2" onClick={() => void exportCSV(filtered)}>
                      <FileSpreadsheet className="size-4" />
                      {t("reports.export_csv")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => void exportHTML(filtered, t)}
                    >
                      <FileCode2 className="size-4" />
                      {t("reports.export_html")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Clear history */}
                {confirmClear ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">
                      {t("reports.clear_confirm", { count: runHistory.length })}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        clearHistory();
                        setConfirmClear(false);
                      }}
                    >
                      {t("reports.clear_yes")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setConfirmClear(false)}
                    >
                      {t("reports.clear_no")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground gap-1.5"
                    onClick={() => setConfirmClear(true)}
                  >
                    <RotateCcw className="size-3.5" />
                    {t("reports.clear_history")}
                  </Button>
                )}
              </div>
            </div>

            {/* ── Date range filter ──────────────────────────────────────────── */}
            <DateRangeFilter
              preset={suiteDatePreset}
              customFrom={suiteDateFrom}
              customTo={suiteDateTo}
              onPresetChange={(p) => setSuiteDatePreset(p)}
              onFromChange={(v) => setSuiteDateFrom(v)}
              onToChange={(v) => setSuiteDateTo(v)}
            />

            {/* ── KPI tiles ──────────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-3">
              <KpiCard
                label={t("reports.kpi_total_runs")}
                value={String(totalRuns)}
                sub={`${filtered.filter((r) => r.failed === 0).length} fully passed`}
              />
              <KpiCard
                label={t("reports.kpi_pass_rate")}
                value={`${Math.round(passRate * 100)}%`}
                sub={`${totalPassed} / ${totalCases} cases`}
                colorClass={passTextClass(passRate)}
              />
              <KpiCard
                label={t("reports.kpi_cases_run")}
                value={String(totalCases)}
                sub={`${totalRuns} runs`}
              />
              <KpiCard
                label={t("reports.kpi_avg_duration")}
                value={fmtDuration(Math.round(avgDurMs))}
                sub={`per suite run`}
              />
            </div>

            {/* ── Charts row ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Donut */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t("reports.chart_passrate_title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3 pb-4">
                  <DonutChart passed={totalPassed} total={totalCases} size={130} />
                  <div className="flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      {t("reports.passed")} ({totalPassed})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                      {t("reports.failed")} ({totalCases - totalPassed})
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Trend bars (span 2 cols) */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    {t("reports.chart_trend_title")}
                    <span className="text-muted-foreground text-xs font-normal">
                      {t("reports.chart_trend_desc")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex min-h-[80px] items-end gap-1">
                    <TrendBars runs={filtered} />
                  </div>
                  <div className="text-muted-foreground mt-2 flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded bg-emerald-500" />
                      Passed
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded bg-red-500" />
                      Failed
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Per-suite breakdown ─────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("reports.suite_breakdown_title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <PerSuiteBreakdown history={filtered} />
              </CardContent>
            </Card>

            {/* ── Run history ────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t("reports.history_title")}</h2>
                <span className="text-muted-foreground text-xs">
                  {filtered.length} / {totalRuns}
                </span>
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    placeholder={t("reports.search_placeholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <Select
                  value={filterOutcome}
                  onValueChange={(v) => setFilterOutcome(v as FilterOutcome)}
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("reports.filter_all")}</SelectItem>
                    <SelectItem value="passed">{t("reports.filter_passed")}</SelectItem>
                    <SelectItem value="failed">{t("reports.filter_failed")}</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("reports.sort_newest")}</SelectItem>
                    <SelectItem value="oldest">{t("reports.sort_oldest")}</SelectItem>
                    <SelectItem value="duration_desc">{t("reports.sort_duration")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* List */}
              {filtered.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("reports.no_runs_match")}
                </p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((run) => (
                    <RunRow
                      key={`${run.suiteId}-${run.startedAt}`}
                      run={run}
                      onDelete={() => deleteHistoryEntry(run.startedAt)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Export note ────────────────────────────────────────────────── */}
            <p className="text-muted-foreground/60 text-center text-xs">
              {t("reports.export_redacted_note")}
            </p>
          </div>
        )}
      </TabsContent>

      {/* ══ API Requests tab ═══════════════════════════════════════════════ */}
      <TabsContent value="requests" className="mt-0">
        <ApiRequestsTab />
      </TabsContent>
    </Tabs>
  );
}
