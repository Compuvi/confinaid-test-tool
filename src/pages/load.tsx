// SPDX-License-Identifier: Apache-2.0
/**
 * Load & Rate Limit page.
 *
 * Three test modes:
 *   count    — fire exactly N requests across C concurrent workers
 *   duration — fire for T seconds across C concurrent workers
 *   probe    — ramp concurrency from S→M in steps of K, stopping at the first
 *              level that produces a 429 (rate-limit boundary finder)
 *
 * No new Rust code is needed.  Every request goes through the existing
 * `commands.request.send` command, which handles credential injection and
 * token caching transparently.  Concurrency is achieved by launching N
 * parallel `invoke` calls; Tauri's tokio executor manages the actual HTTP
 * concurrency on the Rust side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Gauge,
  Play,
  RotateCcw,
  Square,
  Timer,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { RateLimitedError } from "@/lib/api/errors";
import { commands } from "@/lib/api/tauri-client";
import { cn } from "@/lib/utils";
import { useLoadStore, type LoadConfig, type LoadMode } from "@/stores/load-store";
import type { EndpointId } from "@/types/request";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusSample {
  body: string;
  url: string;
  durationMs: number;
  index: number; // 1-based ordinal within its status group
}

interface RunStats {
  sent: number;
  success: number;
  errors: number;
  rateLimited: number;
  /** Raw latency samples (ms) for successful requests — capped at 10 k. */
  latenciesMs: number[];
  statusCounts: Record<number, number>;
  startedAt: number;
  finishedAt: number | null;
  // probe mode
  probeCurrentConcurrency: number;
  probeLimitConcurrency: number | null;
  probeRetryAfterMs: number | null;
  /** Up to 5 response samples per distinct HTTP status code (first occurrences). */
  statusSamples: Record<number, StatusSample[]>;
  /** Up to 5 non-HTTP error messages (network failures, timeouts, etc.). */
  errorSamples: string[];
}

interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

// ─── Module-level abort signal ────────────────────────────────────────────────

// JS is single-threaded — a plain boolean is safe as a shared abort flag.
let _loadAbort = false;

// ─── Stat helpers ─────────────────────────────────────────────────────────────

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function computeLatency(latencies: number[]): LatencyStats | null {
  if (latencies.length === 0) return null;
  const s = [...latencies].sort((a, b) => a - b);
  return {
    min: s[0],
    max: s[s.length - 1],
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    p50: pctile(s, 50),
    p95: pctile(s, 95),
    p99: pctile(s, 99),
  };
}

// ─── Per-request runner ───────────────────────────────────────────────────────

async function fireOne(
  config: LoadConfig,
  body: Record<string, unknown>,
  stats: RunStats
): Promise<void> {
  try {
    const res = await commands.request.send({
      params: { endpoint: config.endpoint, body, timeoutMs: config.timeoutMs },
    });
    stats.sent++;
    stats.success++;
    if (stats.latenciesMs.length < 10_000) stats.latenciesMs.push(res.durationMs);
    stats.statusCounts[res.status] = (stats.statusCounts[res.status] ?? 0) + 1;
    // Capture up to 5 samples per distinct status code.
    const bucket = (stats.statusSamples[res.status] ??= []);
    if (bucket.length < 5) {
      bucket.push({
        body: res.body,
        url: res.url,
        durationMs: res.durationMs,
        index: bucket.length + 1,
      });
    }
  } catch (err) {
    stats.sent++;
    if (err instanceof RateLimitedError) {
      stats.rateLimited++;
      stats.statusCounts[429] = (stats.statusCounts[429] ?? 0) + 1;
      if (err.retryAfterMs !== null && stats.probeRetryAfterMs === null) {
        stats.probeRetryAfterMs = err.retryAfterMs;
      }
      const bucket429 = (stats.statusSamples[429] ??= []);
      if (bucket429.length < 5) {
        bucket429.push({ body: err.message, url: "", durationMs: 0, index: bucket429.length + 1 });
      }
    } else {
      stats.errors++;
      if (stats.errorSamples.length < 5) {
        stats.errorSamples.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
}

// ─── Run modes ────────────────────────────────────────────────────────────────

async function runCount(
  config: LoadConfig,
  body: Record<string, unknown>,
  stats: RunStats
): Promise<void> {
  // Each worker claims one slot by decrementing the shared counter.
  // JS is single-threaded so the decrement is effectively atomic.
  const shared = { remaining: config.totalRequests };
  const worker = async () => {
    while (!_loadAbort) {
      const claim = --shared.remaining;
      if (claim < 0) {
        shared.remaining++;
        break;
      }
      await fireOne(config, body, stats);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, worker));
}

async function runDuration(
  config: LoadConfig,
  body: Record<string, unknown>,
  stats: RunStats
): Promise<void> {
  const deadline = Date.now() + config.durationSecs * 1_000;
  const worker = async () => {
    while (!_loadAbort && Date.now() < deadline) {
      await fireOne(config, body, stats);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, worker));
}

async function runProbe(
  config: LoadConfig,
  body: Record<string, unknown>,
  stats: RunStats
): Promise<void> {
  for (
    let c = config.probeStartConcurrency;
    c <= config.probeMaxConcurrency && !_loadAbort;
    c += config.probeStep
  ) {
    stats.probeCurrentConcurrency = c;
    const rlBefore = stats.rateLimited;
    const shared = { remaining: config.probeStepRequests };
    const worker = async () => {
      while (!_loadAbort) {
        const claim = --shared.remaining;
        if (claim < 0) {
          shared.remaining++;
          break;
        }
        await fireOne(config, body, stats);
      }
    };
    await Promise.all(Array.from({ length: c }, worker));
    if (stats.rateLimited > rlBefore) {
      stats.probeLimitConcurrency = c;
      break;
    }
  }
}

// ─── Report download ──────────────────────────────────────────────────────────

async function downloadReport(config: LoadConfig, stats: RunStats): Promise<void> {
  const latency = computeLatency(stats.latenciesMs);
  const elapsedMs = (stats.finishedAt ?? Date.now()) - stats.startedAt;
  const throughput = elapsedMs > 0 ? (stats.sent / elapsedMs) * 1_000 : 0;

  const report = {
    generated_at: new Date().toISOString(),
    config: {
      endpoint: config.endpoint,
      mode: config.mode,
      concurrency: config.concurrency,
      total_requests: config.mode === "count" ? config.totalRequests : undefined,
      duration_secs: config.mode === "duration" ? config.durationSecs : undefined,
      probe_start_concurrency: config.mode === "probe" ? config.probeStartConcurrency : undefined,
      probe_step: config.mode === "probe" ? config.probeStep : undefined,
      probe_step_requests: config.mode === "probe" ? config.probeStepRequests : undefined,
      probe_max_concurrency: config.mode === "probe" ? config.probeMaxConcurrency : undefined,
      timeout_ms: config.timeoutMs,
      body: (() => {
        try {
          return JSON.parse(config.body);
        } catch {
          return config.body;
        }
      })(),
    },
    summary: {
      sent: stats.sent,
      success: stats.success,
      errors: stats.errors,
      rate_limited: stats.rateLimited,
      throughput_rps: Math.round(throughput * 100) / 100,
      elapsed_ms: elapsedMs,
      success_rate_pct:
        stats.sent > 0 ? Math.round((stats.success / stats.sent) * 10_000) / 100 : 0,
    },
    latency: latency
      ? {
          min_ms: latency.min,
          max_ms: latency.max,
          mean_ms: latency.mean,
          p50_ms: latency.p50,
          p95_ms: latency.p95,
          p99_ms: latency.p99,
        }
      : null,
    status_codes: stats.statusCounts,
    probe_result:
      config.mode === "probe"
        ? {
            limit_concurrency: stats.probeLimitConcurrency,
            retry_after_ms: stats.probeRetryAfterMs,
          }
        : undefined,
    response_samples: stats.statusSamples,
    error_samples: stats.errorSamples,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = await save({
    defaultPath: `load-report-${config.endpoint.toLowerCase()}-${ts}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return; // user cancelled

  await writeFile(filePath, new TextEncoder().encode(JSON.stringify(report, null, 2)));
}

// ─── Default bodies ───────────────────────────────────────────────────────────

const DEFAULT_BODIES: Record<EndpointId, string> = {
  Token: '{\n  "client_id": "",\n  "client_secret": ""\n}',
  Refresh: '{\n  "refresh_token": ""\n}',
  Revoke: '{\n  "token": ""\n}',
  Analyze: '{\n  "content": "Merhaba, sözleşme taslağını ekte gönderiyorum."\n}',
  Rewrite:
    '{\n  "content": "Merhaba, sözleşme taslağını ekte gönderiyorum.",\n  "analysis_id": ""\n}',
};

// ─── Page component ───────────────────────────────────────────────────────────

export function LoadPage() {
  const { t } = useTranslation();
  const { config, setConfig } = useLoadStore();

  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const statsRef = useRef<RunStats | null>(null);

  // Flush mutable stats ref → React state every 300 ms while running.
  const flush = useCallback(() => {
    if (statsRef.current) setStats({ ...statsRef.current });
  }, []);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(flush, 300);
    return () => clearInterval(id);
  }, [running, flush]);

  // Live elapsed timer.
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 500);
    return () => clearInterval(id);
  }, [running]);

  const latency = useMemo(() => (stats ? computeLatency(stats.latenciesMs) : null), [stats]);

  const throughput = useMemo(() => {
    if (!stats || stats.sent === 0) return 0;
    const secs = ((stats.finishedAt ?? Date.now()) - stats.startedAt) / 1_000;
    return secs > 0 ? stats.sent / secs : 0;
  }, [stats]);

  // ── Start ──────────────────────────────────────────────────────────────────
  const handleStart = async () => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(config.body) as Record<string, unknown>;
    } catch {
      setError(t("load.invalid_json"));
      return;
    }

    _loadAbort = false;
    setError(null);
    setElapsedMs(0);

    const s: RunStats = {
      sent: 0,
      success: 0,
      errors: 0,
      rateLimited: 0,
      latenciesMs: [],
      statusCounts: {},
      startedAt: Date.now(),
      finishedAt: null,
      probeCurrentConcurrency: config.probeStartConcurrency,
      probeLimitConcurrency: null,
      probeRetryAfterMs: null,
      statusSamples: {},
      errorSamples: [],
    };
    statsRef.current = s;
    setStats({ ...s });
    setRunning(true);

    try {
      if (config.mode === "count") await runCount(config, body, s);
      else if (config.mode === "duration") await runDuration(config, body, s);
      else await runProbe(config, body, s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.finishedAt = Date.now();
      setStats({ ...s });
      setRunning(false);
    }
  };

  const handleStop = () => {
    _loadAbort = true;
  };
  const handleReset = () => {
    setStats(null);
    setError(null);
    setElapsedMs(0);
    statsRef.current = null;
  };

  const fmtMs = (ms: number) => (ms >= 1_000 ? `${(ms / 1_000).toFixed(1)} s` : `${ms} ms`);
  const fmtElapsed = (ms: number) => {
    const s = Math.floor(ms / 1_000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  const displayElapsed = running
    ? elapsedMs
    : stats
      ? (stats.finishedAt ?? Date.now()) - stats.startedAt
      : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* ── Config panel ───────────────────────────────────────────────── */}
      <Card className="flex w-72 shrink-0 flex-col overflow-y-auto">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" />
            {t("load.config_title")}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pb-6">
          {/* Endpoint */}
          <div className="space-y-1.5">
            <Label>{t("load.endpoint_label")}</Label>
            <Select
              value={config.endpoint}
              onValueChange={(v) =>
                setConfig({
                  endpoint: v as EndpointId,
                  body: DEFAULT_BODIES[v as EndpointId] ?? config.body,
                })
              }
              disabled={running}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("requests.group_auth")}</SelectLabel>
                  <SelectItem value="Token">POST /v1/token</SelectItem>
                  <SelectItem value="Refresh">POST /v1/token/refresh</SelectItem>
                  <SelectItem value="Revoke">POST /v1/token/revoke</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t("requests.group_api")}</SelectLabel>
                  <SelectItem value="Analyze">POST /v1/analyze</SelectItem>
                  <SelectItem value="Rewrite">POST /v1/rewrite</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label>{t("load.body_label")}</Label>
            <Textarea
              className="font-mono text-xs"
              rows={4}
              value={config.body}
              onChange={(e) => setConfig({ body: e.target.value })}
              disabled={running}
              spellCheck={false}
            />
          </div>

          {/* Mode tabs */}
          <div className="space-y-1.5">
            <Label>{t("load.mode_label")}</Label>
            <Tabs value={config.mode} onValueChange={(v) => setConfig({ mode: v as LoadMode })}>
              <TabsList className="w-full">
                <TabsTrigger value="count" className="flex-1" disabled={running}>
                  {t("load.mode_count")}
                </TabsTrigger>
                <TabsTrigger value="duration" className="flex-1" disabled={running}>
                  {t("load.mode_duration")}
                </TabsTrigger>
                <TabsTrigger value="probe" className="flex-1" disabled={running}>
                  {t("load.mode_probe")}
                </TabsTrigger>
              </TabsList>

              {/* Count */}
              <TabsContent value="count" className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("load.total_requests_label")}</Label>
                  <NumberInput
                    min={1}
                    max={100_000}
                    value={config.totalRequests}
                    onChange={(v) => setConfig({ totalRequests: v })}
                    disabled={running}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t("load.concurrency_label")}</Label>
                    <span className="text-muted-foreground text-xs">
                      {t("load.concurrency_hint", { n: config.concurrency })}
                    </span>
                  </div>
                  <NumberInput
                    min={1}
                    max={1_000}
                    value={config.concurrency}
                    onChange={(v) => setConfig({ concurrency: v })}
                    disabled={running}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Max 1 000 parallel workers. High values will stress the API server.
                  </p>
                </div>
              </TabsContent>

              {/* Duration */}
              <TabsContent value="duration" className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("load.duration_label")}</Label>
                  <NumberInput
                    min={1}
                    max={3_600}
                    value={config.durationSecs}
                    onChange={(v) => setConfig({ durationSecs: v })}
                    disabled={running}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t("load.concurrency_label")}</Label>
                    <span className="text-muted-foreground text-xs">
                      {t("load.concurrency_hint", { n: config.concurrency })}
                    </span>
                  </div>
                  <NumberInput
                    min={1}
                    max={1_000}
                    value={config.concurrency}
                    onChange={(v) => setConfig({ concurrency: v })}
                    disabled={running}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Max 1 000 parallel workers. High values will stress the API server.
                  </p>
                </div>
              </TabsContent>

              {/* Probe */}
              <TabsContent value="probe" className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("load.probe_start_label")}</Label>
                    <NumberInput
                      min={1}
                      max={500}
                      value={config.probeStartConcurrency}
                      onChange={(v) => setConfig({ probeStartConcurrency: v })}
                      disabled={running}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("load.probe_step_label")}</Label>
                    <NumberInput
                      min={1}
                      max={100}
                      value={config.probeStep}
                      onChange={(v) => setConfig({ probeStep: v })}
                      disabled={running}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("load.probe_max_label")}</Label>
                    <NumberInput
                      min={2}
                      max={500}
                      value={config.probeMaxConcurrency}
                      onChange={(v) => setConfig({ probeMaxConcurrency: v })}
                      disabled={running}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("load.probe_step_requests_label")}</Label>
                    <NumberInput
                      min={1}
                      max={500}
                      value={config.probeStepRequests}
                      onChange={(v) => setConfig({ probeStepRequests: v })}
                      disabled={running}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">{t("load.probe_hint")}</p>
              </TabsContent>
            </Tabs>
          </div>

          {/* Timeout */}
          <div className="space-y-1.5">
            <Label>{t("load.timeout_label")}</Label>
            <NumberInput
              min={1_000}
              max={60_000}
              step={1_000}
              value={config.timeoutMs}
              onChange={(v) => setConfig({ timeoutMs: v })}
              disabled={running}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-2 text-xs">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {!running ? (
              <>
                <Button className="flex-1" onClick={handleStart}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  {t("load.start_button")}
                </Button>
                {stats && stats.finishedAt && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => void downloadReport(config, stats)}
                      title="Download JSON report"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleReset}
                      title={t("load.reset_button")}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </>
            ) : (
              <Button variant="destructive" className="flex-1" onClick={handleStop}>
                <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
                {t("load.stop_button")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Stats panel ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        {!stats ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-muted rounded-full p-5">
              <Activity className="text-muted-foreground h-9 w-9" />
            </div>
            <div>
              <p className="font-semibold">{t("load.empty_title")}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t("load.empty_desc")}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Overview row */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label={t("load.stat_sent")} value={stats.sent} />
              <StatCard label={t("load.stat_success")} value={stats.success} color="green" />
              <StatCard
                label={t("load.stat_errors")}
                value={stats.errors}
                color={stats.errors > 0 ? "red" : undefined}
              />
              <StatCard
                label={t("load.stat_rate_limited")}
                value={stats.rateLimited}
                color={stats.rateLimited > 0 ? "amber" : undefined}
              />
            </div>

            {/* Throughput + elapsed strip */}
            <div className="bg-card flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-3">
              <div className="flex items-center gap-2">
                <Zap className="text-muted-foreground h-4 w-4" />
                <span className="font-semibold tabular-nums">{throughput.toFixed(1)}</span>
                <span className="text-muted-foreground text-xs">{t("load.throughput_unit")}</span>
              </div>
              <div className="bg-border h-4 w-px" />
              <div className="flex items-center gap-2">
                <Timer className="text-muted-foreground h-4 w-4" />
                <span className="font-semibold tabular-nums">{fmtElapsed(displayElapsed)}</span>
                <span className="text-muted-foreground text-xs">{t("load.elapsed_label")}</span>
              </div>
              {running && (
                <>
                  <div className="bg-border h-4 w-px" />
                  <Badge variant="secondary" className="text-xs">
                    {config.mode === "probe"
                      ? t("load.probe_at_concurrency", { n: stats.probeCurrentConcurrency })
                      : t("load.running_label")}
                  </Badge>
                </>
              )}
              {!running && stats.finishedAt && (
                <>
                  <div className="bg-border h-4 w-px" />
                  <Badge className="text-xs">{t("load.done_label")}</Badge>
                </>
              )}
            </div>

            {/* Latency + Status codes */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("load.latency_label")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {latency ? (
                    <div className="space-y-3">
                      <LatBar
                        label="p50"
                        value={latency.p50}
                        max={latency.max}
                        color="bg-emerald-500"
                      />
                      <LatBar
                        label="p95"
                        value={latency.p95}
                        max={latency.max}
                        color="bg-amber-500"
                      />
                      <LatBar
                        label="p99"
                        value={latency.p99}
                        max={latency.max}
                        color="bg-red-500"
                      />
                      <div className="text-muted-foreground flex justify-between border-t pt-2 text-xs">
                        <span>min {latency.min} ms</span>
                        <span>avg {latency.mean} ms</span>
                        <span>max {latency.max} ms</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground py-6 text-center text-xs">
                      {t("load.no_data")}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("load.status_codes_label")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(stats.statusCounts).length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center text-xs">
                      {t("load.no_data")}
                    </p>
                  ) : (
                    <StatusBreakdown counts={stats.statusCounts} total={stats.sent} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Response Samples */}
            <ResponseSamples
              statusSamples={stats.statusSamples}
              errorSamples={stats.errorSamples}
              statusCounts={stats.statusCounts}
            />

            {/* Rate probe result */}
            {config.mode === "probe" && !running && stats.finishedAt && (
              <Card
                className={cn(
                  "border-2",
                  stats.probeLimitConcurrency !== null
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-emerald-500/40 bg-emerald-500/5"
                )}
              >
                <CardContent className="pt-4 pb-4">
                  {stats.probeLimitConcurrency !== null ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">
                        {t("load.probe_limit_found", { n: stats.probeLimitConcurrency })}
                      </p>
                      {stats.probeRetryAfterMs !== null && (
                        <p className="text-muted-foreground text-sm">
                          {t("load.probe_retry_after", { ms: fmtMs(stats.probeRetryAfterMs) })}
                        </p>
                      )}
                      <p className="text-muted-foreground text-xs">
                        {t("load.probe_recommendation", {
                          n: Math.max(1, stats.probeLimitConcurrency - config.probeStep),
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {t("load.probe_no_limit", { n: config.probeMaxConcurrency })}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResponseSamples({
  statusSamples,
  errorSamples,
  statusCounts,
}: {
  statusSamples: Record<number, StatusSample[]>;
  errorSamples: string[];
  statusCounts: Record<number, number>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const hasSamples = Object.keys(statusSamples).length > 0 || errorSamples.length > 0;
  if (!hasSamples) return null;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const statusEntries = Object.entries(statusSamples)
    .map(([code, samples]) => ({ code: parseInt(code), samples }))
    .sort((a, b) => a.code - b.code);

  const codeBadgeColor = (code: number) => {
    if (code >= 200 && code < 300) return "text-emerald-500";
    if (code === 429) return "text-amber-500";
    return "text-destructive";
  };

  const codeBorderColor = (code: number) => {
    if (code >= 200 && code < 300) return "border-emerald-500/25 bg-emerald-500/5";
    if (code === 429) return "border-amber-500/25 bg-amber-500/5";
    return "border-destructive/25 bg-destructive/5";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("load.samples_title")}</CardTitle>
        <p className="text-muted-foreground text-xs">{t("load.samples_hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusEntries.map(({ code, samples }) => {
          const groupKey = `group-${code}`;
          const groupOpen = expanded.has(groupKey);
          const totalForCode = statusCounts[code] ?? samples.length;
          const showing = samples.length;
          const more = totalForCode - showing;

          return (
            <div key={groupKey} className={cn("rounded-md border", codeBorderColor(code))}>
              {/* Group header — collapse/expand all samples for this code */}
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => toggle(groupKey)}
              >
                {groupOpen ? (
                  <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                )}
                <span className={cn("font-mono text-sm font-bold", codeBadgeColor(code))}>
                  {code}
                </span>
                {samples[0]?.url && (
                  <span className="text-muted-foreground truncate text-xs">{samples[0].url}</span>
                )}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {totalForCode.toLocaleString()} {totalForCode === 1 ? "response" : "responses"}
                </span>
              </button>

              {/* Individual sample rows */}
              {groupOpen && (
                <div className="divide-y border-t">
                  {samples.map((sample, i) => {
                    const sampleKey = `${groupKey}-${i}`;
                    const sampleOpen = expanded.has(sampleKey);
                    return (
                      <div key={sampleKey}>
                        <button
                          className="hover:bg-muted/30 flex w-full items-center gap-2 px-4 py-1.5 text-left"
                          onClick={() => toggle(sampleKey)}
                        >
                          {sampleOpen ? (
                            <ChevronDown className="text-muted-foreground h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="text-muted-foreground h-3 w-3 shrink-0" />
                          )}
                          <span className="text-muted-foreground text-xs">
                            {t("load.samples_sample_n", { n: sample.index })}
                          </span>
                          {sample.durationMs > 0 && (
                            <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                              {sample.durationMs} ms
                            </span>
                          )}
                        </button>
                        {sampleOpen && (
                          <div className="px-4 pt-1 pb-3">
                            <pre className="bg-muted/50 max-h-48 overflow-auto rounded p-2 text-xs leading-relaxed break-words whitespace-pre-wrap">
                              {sample.body || t("load.samples_empty_body")}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {more > 0 && (
                    <p className="text-muted-foreground px-4 py-2 text-xs italic">
                      {t("load.samples_more", { n: more })}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {errorSamples.length > 0 && (
          <div className="border-destructive/25 bg-destructive/5 rounded-md border">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
              onClick={() => toggle("errors")}
            >
              {expanded.has("errors") ? (
                <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              )}
              <span className="text-destructive text-sm font-semibold">
                {t("load.samples_error_title")}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">{errorSamples.length}</span>
            </button>
            {expanded.has("errors") && (
              <div className="space-y-1 border-t px-3 pt-2 pb-3">
                {errorSamples.map((msg, i) => (
                  <p key={i} className="text-destructive font-mono text-xs break-words">
                    {msg}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: "green" | "red" | "amber";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-2xl font-bold tabular-nums",
            color === "green" && "text-emerald-500",
            color === "red" && "text-destructive",
            color === "amber" && "text-amber-500"
          )}
        >
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

function LatBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 3;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-7 shrink-0 text-xs font-medium">{label}</span>
      <div className="bg-muted/60 flex-1 overflow-hidden rounded-full">
        <div
          className={cn("h-2 rounded-full transition-[width]", color)}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums">{value} ms</span>
    </div>
  );
}

function StatusBreakdown({ counts, total }: { counts: Record<number, number>; total: number }) {
  const entries = Object.entries(counts)
    .map(([c, n]) => ({ code: parseInt(c), count: n }))
    .sort((a, b) => a.code - b.code);

  return (
    <div className="space-y-2.5">
      {entries.map(({ code, count }) => {
        const w = total > 0 ? Math.max(2, (count / total) * 100) : 2;
        const ok = code >= 200 && code < 300;
        const rl = code === 429;
        return (
          <div key={code} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "w-10 shrink-0 font-mono font-semibold",
                ok ? "text-emerald-500" : rl ? "text-amber-500" : "text-destructive"
              )}
            >
              {code}
            </span>
            <div className="bg-muted/60 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  ok ? "bg-emerald-500" : rl ? "bg-amber-500" : "bg-destructive"
                )}
                style={{ width: `${w}%` }}
              />
            </div>
            <span className="text-muted-foreground w-12 shrink-0 text-right tabular-nums">
              {count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
