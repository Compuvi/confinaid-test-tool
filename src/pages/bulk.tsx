/**
 * Batch Testing page — full-page extraction of the Bulk Import panel,
 * with new features: template download, stats card, result filtering,
 * export, save-to-suite, and CSV column mapping UI.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowDownToLine,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  FileDown,
  FileJson,
  FileText,
  Filter,
  FlaskConical,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JsonViewer } from "@/components/ui/json-highlight";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/errors";
import { logRequest, logFailedRequest } from "@/lib/api/request-logger";
import { commands } from "@/lib/api/tauri-client";
import { useRequestStore } from "@/stores/request-store";
import { useBulkStore, getBulkAbort, setBulkAbort } from "@/stores/bulk-store";
import type { BulkRowInput } from "@/stores/bulk-store";
import { useSuiteStore } from "@/stores/suite-store";
import type { TestCase } from "@/types/suite";
import { cn } from "@/lib/utils";
import type { EndpointId } from "@/types/request";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BULK_ROWS = 500;
const VALID_ENDPOINT_IDS: readonly string[] = [
  "Token",
  "Refresh",
  "Revoke",
  "Analyze",
  "Rewrite",
  "Graphrag",
];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
type FilterMode = "all" | "passed" | "failed" | "error";

// ─── CSV/JSONL parsers ────────────────────────────────────────────────────────

/**
 * Parse one CSV row, honouring double-quoted fields.
 * Adjacent double-quotes inside a quoted field are treated as an escaped quote.
 */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse JSONL (newline-delimited JSON).
 *
 * Each non-empty line must be a JSON object. Two layouts are accepted:
 *   • `{ "endpoint": "Analyze", "body": { ... } }` — explicit body wrapper
 *   • `{ "endpoint": "Analyze", "content": "…", "language": "en" }` — flat
 */
function parseJsonlFile(text: string): BulkRowInput[] {
  const rows: BulkRowInput[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const endpoint = obj.endpoint as string;
      if (!VALID_ENDPOINT_IDS.includes(endpoint)) continue;

      let body: Record<string, unknown>;
      if (obj.body && typeof obj.body === "object" && !Array.isArray(obj.body)) {
        body = obj.body as Record<string, unknown>;
      } else {
        const { endpoint: _ep, ...rest } = obj;
        body = rest;
      }
      rows.push({ endpoint: endpoint as EndpointId, body });
    } catch {
      // Skip unparseable lines silently.
    }
  }
  return rows;
}

/**
 * Parse a CSV file where the header row contains an "endpoint" column.
 * All other columns become body fields.
 */
function parseCsvFile(text: string): BulkRowInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const epIdx = headers.findIndex((h) => h.toLowerCase() === "endpoint");
  if (epIdx === -1) return [];

  const rows: BulkRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const endpoint = vals[epIdx]?.trim();
    if (!endpoint || !VALID_ENDPOINT_IDS.includes(endpoint)) continue;

    const body: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j !== epIdx && headers[j]) {
        body[headers[j]] = (vals[j] ?? "").trim();
      }
    }
    rows.push({ endpoint: endpoint as EndpointId, body });
  }
  return rows;
}

/**
 * Parse a CSV file with a custom column mapping.
 * @param endpointCol - The CSV header column that maps to the endpoint field.
 * @param bodyMapping - Maps targetField → sourceColumn for body fields.
 */
function parseCsvFileWithMapping(
  text: string,
  endpointCol: string,
  bodyMapping: Record<string, string>
): BulkRowInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const epIdx = headers.indexOf(endpointCol);
  if (epIdx === -1) return [];

  // Build (sourceColIndex → targetFieldName) map
  const colMapping: { sourceIdx: number; targetField: string }[] = [];
  for (const [targetField, sourceCol] of Object.entries(bodyMapping)) {
    if (!sourceCol) continue;
    const idx = headers.indexOf(sourceCol);
    if (idx !== -1) colMapping.push({ sourceIdx: idx, targetField });
  }

  const rows: BulkRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const endpoint = vals[epIdx]?.trim();
    if (!endpoint || !VALID_ENDPOINT_IDS.includes(endpoint)) continue;

    const body: Record<string, unknown> = {};
    for (const { sourceIdx, targetField } of colMapping) {
      body[targetField] = (vals[sourceIdx] ?? "").trim();
    }
    rows.push({ endpoint: endpoint as EndpointId, body });
  }
  return rows;
}

// ─── Download helpers ─────────────────────────────────────────────────────────

async function saveToFile(
  filename: string,
  content: string,
  filters: { name: string; extensions: string[] }[],
  label = "File"
) {
  const filePath = await save({ defaultPath: filename, filters });
  if (!filePath) return; // user cancelled
  try {
    await writeFile(filePath, new TextEncoder().encode(content));
    toast.success(`${label} saved successfully.`);
  } catch (err) {
    toast.error(`Could not save file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const CSV_TEMPLATE = `endpoint,content
Analyze,Hello I am sending you the contract draft as an attachment.
Analyze,Please find the attached NDA for your review and signature.
Analyze,I need your bank account number and routing number to process the refund.
Analyze,Your social security number is required to complete the verification.
Analyze,Meeting rescheduled to Thursday at 3 PM. Please confirm your availability.
`;

const JSONL_TEMPLATE = `{"endpoint":"Analyze","body":{"content":"Hello I am sending you the contract draft as an attachment."}}
{"endpoint":"Analyze","body":{"content":"Please find the attached NDA for your review and signature."}}
{"endpoint":"Analyze","body":{"content":"I need your bank account number and routing number to process the refund."}}
{"endpoint":"Rewrite","body":{"content":"Risky content to rewrite","analysis_id":"your-analysis-id-here"}}
`;

// ─── Column mapping state shape ───────────────────────────────────────────────

interface CsvMappingData {
  filename: string;
  text: string;
  headers: string[];
  endpointCol: string;
  bodyMapping: Record<string, string>; // targetField → sourceColumn
}

// ─── Page component ───────────────────────────────────────────────────────────

export function BatchPage() {
  const { t } = useTranslation();
  const { timeoutMs } = useRequestStore();
  const navigate = useNavigate();

  // ── Persistent state (survives navigation) ──────────────────────────────
  const {
    files,
    addFile,
    removeFile,
    moveFile,
    parseError,
    setParseError,
    rows,
    setRows,
    updateRowAtIndex,
    running,
    setRunning,
    completedCount,
    setCompletedCount,
    clear: clearStore,
  } = useBulkStore();

  const { createSuite, addCase } = useSuiteStore();

  // ── Ephemeral UI state ───────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [csvMappingData, setCsvMappingData] = useState<CsvMappingData | null>(null);
  const [autoRewrite, setAutoRewrite] = useState(false);
  // Stores rewrite results keyed by the Analyze row's _id
  const [rewriteResults, setRewriteResults] = useState<
    Map<string, { body: string; status: number }>
  >(new Map());
  // Tracks which row _ids are currently mid-rewrite
  const [rewritingRows, setRewritingRows] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  // AbortController for the current run — lets Cancel reject in-flight awaits immediately
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Derived stats ────────────────────────────────────────────────────────
  const passed = rows.filter(
    (r) =>
      r.status === "done" && r.httpStatus !== undefined && r.httpStatus >= 200 && r.httpStatus < 300
  ).length;

  const failedCount = rows.filter(
    (r) =>
      r.status === "done" &&
      r.httpStatus !== undefined &&
      (r.httpStatus < 200 || r.httpStatus >= 300)
  ).length;

  const errorCount = rows.filter((r) => r.status === "error").length;

  const allDone = rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "error");

  const canReorder = !running && rows.every((r) => r.status === "pending");

  const passRate = rows.length > 0 ? Math.round((passed / rows.length) * 100) : 0;

  const rewriteTotal = rewriteResults.size;
  const rewritePassed = [...rewriteResults.values()].filter(
    (r) => r.status >= 200 && r.status < 300
  ).length;
  const rewriteFailed = rewriteTotal - rewritePassed;

  const avgLatency = useMemo(() => {
    const doneRows = rows.filter((r) => r.status === "done" && r.durationMs !== undefined);
    if (doneRows.length === 0) return 0;
    const total = doneRows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    return Math.round(total / doneRows.length);
  }, [rows]);

  // ── Filtered rows ────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    switch (filterMode) {
      case "passed":
        return rows.filter(
          (r) =>
            r.status === "done" &&
            r.httpStatus !== undefined &&
            r.httpStatus >= 200 &&
            r.httpStatus < 300
        );
      case "failed":
        return rows.filter(
          (r) =>
            r.status === "done" &&
            r.httpStatus !== undefined &&
            (r.httpStatus < 200 || r.httpStatus >= 300)
        );
      case "error":
        return rows.filter((r) => r.status === "error");
      default:
        return rows;
    }
  }, [rows, filterMode]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Auto-follow the running row while a run is in progress (only in "all" mode).
  useEffect(() => {
    if (running && completedCount >= 0 && filterMode === "all") {
      setCurrentPage(Math.floor(completedCount / pageSize) + 1);
    }
  }, [completedCount, running, pageSize, filterMode]);

  // Reset to page 1 when filter or row list changes.
  const rowCount = rows.length;
  useEffect(() => {
    setCurrentPage(1);
  }, [rowCount, filterMode]);

  const toggleExpand = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── File loading ─────────────────────────────────────────────────────────

  /** Shared helper: validate and add parsed rows to the store. */
  const commitParsedRows = (filename: string, parsed: BulkRowInput[]) => {
    if (parsed.length === 0) {
      setParseError(t("requests.bulk_parse_error"));
      return;
    }

    const currentTotal = useBulkStore.getState().rows.length;
    const remaining = MAX_BULK_ROWS - currentTotal;
    if (remaining <= 0) {
      setParseError(t("requests.bulk_max_rows", { max: MAX_BULK_ROWS }));
      return;
    }

    const capped = parsed.slice(0, remaining);
    const fileId = crypto.randomUUID();
    const newFile = { id: fileId, filename, rowCount: capped.length };
    const newRows = capped.map((r) => ({
      ...r,
      _id: crypto.randomUUID(),
      _fileId: fileId,
      status: "pending" as const,
    }));
    addFile(newFile, newRows);
  };

  /** Parse and add a single file, with CSV column mapping detection. */
  const loadFile = async (file: File) => {
    setParseError(null);
    setCsvMappingData(null);
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

      let parsed: BulkRowInput[] = [];
      if (ext === "jsonl" || ext === "ndjson") {
        parsed = parseJsonlFile(text);
      } else if (ext === "csv") {
        parsed = parseCsvFile(text);
        // If no "endpoint" column, offer column mapping UI.
        if (parsed.length === 0) {
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length >= 1) {
            const headers = parseCsvRow(lines[0])
              .map((h) => h.trim())
              .filter(Boolean);
            if (headers.length > 0) {
              const guessEndpoint = headers.find((h) => /endpoint/i.test(h)) ?? headers[0];
              const guessContent = headers.find((h) => /content|text|body/i.test(h)) ?? headers[0];
              const guessLang = headers.find((h) => /lang/i.test(h)) ?? headers[0];
              setCsvMappingData({
                filename: file.name,
                text,
                headers,
                endpointCol: guessEndpoint,
                bodyMapping: {
                  content: guessContent,
                  language: guessLang,
                },
              });
              return;
            }
          }
          setParseError(t("requests.bulk_parse_error"));
          return;
        }
      } else {
        parsed = parseJsonlFile(text);
        if (parsed.length === 0) parsed = parseCsvFile(text);
      }

      commitParsedRows(file.name, parsed);
    } catch {
      setParseError(t("requests.bulk_parse_error"));
    }
  };

  const applyMapping = () => {
    if (!csvMappingData) return;
    const { filename, text, endpointCol, bodyMapping } = csvMappingData;
    const parsed = parseCsvFileWithMapping(text, endpointCol, bodyMapping);
    setCsvMappingData(null);
    commitParsedRows(filename, parsed);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      void loadFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      void loadFile(file);
    }
    e.target.value = "";
  };

  // ── Run / cancel / clear ─────────────────────────────────────────────────

  /**
   * Race a promise against an AbortSignal.
   * Rejects immediately with DOMException("AbortError") when the signal fires,
   * without waiting for the underlying promise to settle.
   */
  function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      const onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (v) => {
          signal.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e as Error);
        }
      );
    });
  }

  const runAll = async () => {
    if (running || rows.length === 0) return;

    const ac = new AbortController();
    abortControllerRef.current = ac;

    setBulkAbort(false);
    setRunning(true);
    setCompletedCount(0);
    setExpandedRows(new Set());
    setFilterMode("all");
    setRewriteResults(new Map());
    setRewritingRows(new Set());

    const snapshot = rows.map((r) => ({
      ...r,
      status: "pending" as const,
      httpStatus: undefined,
      durationMs: undefined,
      errorMsg: undefined,
      responseBody: undefined,
    }));
    setRows(snapshot);

    const newRewriteResults = new Map<string, { body: string; status: number }>();

    for (let i = 0; i < snapshot.length; i++) {
      if (getBulkAbort() || ac.signal.aborted) break;
      updateRowAtIndex(i, { status: "running" });

      try {
        const result = await withAbort(
          commands.request.send({
            params: { endpoint: snapshot[i].endpoint, body: snapshot[i].body, timeoutMs },
          }),
          ac.signal
        );
        updateRowAtIndex(i, {
          status: "done",
          httpStatus: result.status,
          durationMs: result.durationMs,
          responseBody: result.body.slice(0, 3_000),
        });
        logRequest({
          endpoint: snapshot[i].endpoint,
          requestBody: snapshot[i].body,
          result,
          source: "bulk",
          sourceName: "Batch Testing",
        });

        // ── Auto-rewrite: fire Rewrite if Analyze returned risky/hitl ──
        if (
          autoRewrite &&
          snapshot[i].endpoint === "Analyze" &&
          result.status >= 200 &&
          result.status < 300
        ) {
          try {
            const parsed = JSON.parse(result.body) as Record<string, unknown>;
            const isRisky =
              parsed.is_risky === true ||
              (parsed.status as string | undefined) === "risky" ||
              (parsed.status as string | undefined) === "hitl";
            if (isRisky) {
              // API may return analysis_id or request_id — accept either
              const analysisId =
                (parsed.analysis_id as string | undefined) ??
                (parsed.request_id as string | undefined);
              const content = snapshot[i].body.content as string | undefined;
              const rewriteBody: Record<string, unknown> = { content: content ?? "" };
              if (analysisId) rewriteBody.analysis_id = analysisId;

              // Show spinner while rewrite is in-flight
              setRewritingRows((prev) => new Set(prev).add(snapshot[i]._id));
              try {
                const rewriteResult = await withAbort(
                  commands.request.send({
                    params: { endpoint: "Rewrite", body: rewriteBody, timeoutMs },
                  }),
                  ac.signal
                );
                newRewriteResults.set(snapshot[i]._id, {
                  body: rewriteResult.body.slice(0, 3_000),
                  status: rewriteResult.status,
                });
                setRewriteResults(new Map(newRewriteResults));
                logRequest({
                  endpoint: "Rewrite",
                  requestBody: rewriteBody,
                  result: rewriteResult,
                  source: "bulk",
                  sourceName: "Batch Testing (Auto-Rewrite)",
                });
              } finally {
                setRewritingRows((prev) => {
                  const next = new Set(prev);
                  next.delete(snapshot[i]._id);
                  return next;
                });
              }
            }
          } catch {
            // Auto-rewrite failure is non-fatal — main row result is already saved
          }
        }
      } catch (err: unknown) {
        // AbortError means the user clicked Cancel — reset the row to pending
        // and stop the loop immediately without logging an error.
        if (err instanceof DOMException && err.name === "AbortError") {
          updateRowAtIndex(i, {
            status: "pending",
            httpStatus: undefined,
            durationMs: undefined,
            errorMsg: undefined,
            responseBody: undefined,
          });
          break;
        }
        const bulkErr = getErrorMessage(err);
        updateRowAtIndex(i, { status: "error", errorMsg: bulkErr });
        logFailedRequest({
          endpoint: snapshot[i].endpoint,
          requestBody: snapshot[i].body,
          error: bulkErr,
          source: "bulk",
          sourceName: "Batch Testing",
        });
      }

      setCompletedCount(i + 1);
    }

    setRunning(false);
  };

  const cancel = () => {
    setBulkAbort(true);
    abortControllerRef.current?.abort();
  };

  const clear = () => {
    setBulkAbort(true);
    clearStore();
    setExpandedRows(new Set());
    setCsvMappingData(null);
    setRewriteResults(new Map());
    setRewritingRows(new Set());
    setFilterMode("all");
  };

  // ── Export helpers ────────────────────────────────────────────────────────

  /** Timestamped filename so each export is unique. */
  const exportFilename = (base: string, ext: string) => {
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return `${base}-${ts}.${ext}`;
  };

  /** Try to JSON-parse a string; return original string on failure. */
  const tryParseJson = (s: string | undefined): unknown => {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };

  /** Escape HTML special characters for embedding in HTML reports. */
  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** Build a complete self-contained HTML report string. */
  const buildReportHtml = (): string => {
    const runAt = new Date().toLocaleString();
    const rowsHtml = rows
      .map((r, i) => {
        const isOk = r.httpStatus !== undefined && r.httpStatus >= 200 && r.httpStatus < 300;
        const rw = rewriteResults.get(r._id);
        const badgeClass =
          r.status === "error"
            ? "badge-error"
            : r.status === "pending"
              ? "badge-pending"
              : isOk
                ? "badge-ok"
                : "badge-fail";
        const badgeText =
          r.status === "error"
            ? "Error"
            : r.status === "pending"
              ? "Pending"
              : isOk
                ? "Passed"
                : "Failed";

        const fmtBody = (v: unknown) =>
          escHtml(typeof v === "string" ? v : JSON.stringify(v, null, 2));

        let responseCell = r.responseBody
          ? `<div class="mono">${fmtBody(tryParseJson(r.responseBody))}</div>`
          : `<em class="dim">—</em>`;

        if (rw) {
          const rwOk = rw.status >= 200 && rw.status < 300;
          responseCell += `
            <div class="rewrite-cell">
              <div class="rewrite-label">&#8635; Auto-Rewrite &rarr; HTTP ${rw.status}
                <span class="${rwOk ? "green" : "red"}">${rwOk ? "&#10003;" : "&#10007;"}</span>
              </div>
              <div class="mono">${fmtBody(tryParseJson(rw.body))}</div>
            </div>`;
        }

        return `
          <tr>
            <td class="num">${i + 1}</td>
            <td><code>/${r.endpoint.toLowerCase()}</code></td>
            <td><div class="mono">${escHtml(JSON.stringify(r.body, null, 2))}</div></td>
            <td class="num">${r.httpStatus ?? "—"}</td>
            <td class="num">${r.durationMs != null ? `${r.durationMs} ms` : "—"}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td>${responseCell}</td>
          </tr>`;
      })
      .join("");

    const rewriteBanner =
      autoRewrite && rewriteTotal > 0
        ? `<div class="rewrite-banner">&#8635; Auto-Rewrite &mdash; ${rewriteTotal} triggered &middot; <span class="green">${rewritePassed} succeeded</span>${rewriteFailed > 0 ? ` &middot; <span class="red">${rewriteFailed} failed</span>` : ""}</div>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Batch Test Report &mdash; ${runAt}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; }
    .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
    .meta { color: #6b7280; font-size: 12px; margin-top: 6px; }
    .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-value { font-size: 20px; font-weight: 700; }
    .stat-label { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .green { color: #059669; } .red { color: #dc2626; } .amber { color: #d97706; }
    .rewrite-banner { border: 1px solid #fde68a; background: #fffbeb; border-radius: 8px; padding: 10px 16px; margin-bottom: 20px; font-size: 12px; color: #92400e; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f9fafb; border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; font-weight: 600; }
    td { border: 1px solid #e5e7eb; padding: 8px 10px; vertical-align: top; }
    tr:nth-child(even) td { background: #f9fafb; }
    .mono { font-family: "Cascadia Code", "Fira Code", "Courier New", monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
    .num { text-align: right; white-space: nowrap; }
    .dim { color: #9ca3af; font-style: italic; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500; }
    .badge-ok     { background: #d1fae5; color: #065f46; }
    .badge-fail   { background: #fee2e2; color: #991b1b; }
    .badge-error  { background: #fef3c7; color: #92400e; }
    .badge-pending{ background: #f3f4f6; color: #6b7280; }
    .rewrite-cell { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }
    .rewrite-label { font-size: 10px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
    @media print {
      body { padding: 16px; font-size: 11px; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Batch Test Report</h1>
    <p class="meta">Exported: ${runAt} &nbsp;&middot;&nbsp; ${rows.length} rows</p>
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-value">${rows.length}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value green">${passed}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-value red">${failedCount}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value amber">${errorCount}</div><div class="stat-label">Errors</div></div>
    <div class="stat"><div class="stat-value">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
    <div class="stat"><div class="stat-value">${avgLatency} ms</div><div class="stat-label">Avg Latency</div></div>
  </div>

  ${rewriteBanner}

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Endpoint</th>
        <th>Request Body</th>
        <th>HTTP</th>
        <th>Latency</th>
        <th>Result</th>
        <th>Response Body</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
  };

  const exportCsv = () => {
    const csvEsc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const runAt = new Date().toISOString();
    const header =
      "row,exported_at,endpoint,request_body,http_status,latency_ms,passed,error_msg,response_body,rewrite_http_status,rewrite_body\n";
    const body = rows
      .map((r, i) => {
        const isOk = r.httpStatus !== undefined && r.httpStatus >= 200 && r.httpStatus < 300;
        const rw = rewriteResults.get(r._id);
        return [
          i + 1,
          csvEsc(runAt),
          r.endpoint,
          csvEsc(JSON.stringify(r.body)),
          r.httpStatus ?? "",
          r.durationMs ?? "",
          r.status === "done" ? (isOk ? "true" : "false") : r.status,
          csvEsc(r.errorMsg ?? ""),
          csvEsc(r.responseBody ?? ""),
          rw ? rw.status : "",
          csvEsc(rw ? rw.body : ""),
        ].join(",");
      })
      .join("\n");
    void saveToFile(
      exportFilename("batch-results", "csv"),
      header + body,
      [{ name: "CSV", extensions: ["csv"] }],
      "Results"
    );
  };

  const exportJson = () => {
    const exportedAt = new Date().toISOString();
    const data = {
      exportedAt,
      summary: {
        total: rows.length,
        passed,
        failed: failedCount,
        errors: errorCount,
        passRate: `${passRate}%`,
        avgLatencyMs: avgLatency,
        ...(autoRewrite && rewriteTotal > 0
          ? {
              autoRewrite: {
                triggered: rewriteTotal,
                succeeded: rewritePassed,
                failed: rewriteFailed,
              },
            }
          : {}),
      },
      rows: rows.map((r, i) => {
        const isOk = r.httpStatus !== undefined && r.httpStatus >= 200 && r.httpStatus < 300;
        const rw = rewriteResults.get(r._id);
        return {
          row: i + 1,
          endpoint: r.endpoint,
          requestBody: r.body,
          httpStatus: r.httpStatus ?? null,
          latencyMs: r.durationMs ?? null,
          passed: r.status === "done" ? isOk : null,
          status: r.status,
          errorMsg: r.errorMsg ?? null,
          responseBody: tryParseJson(r.responseBody),
          ...(rw
            ? {
                autoRewrite: {
                  httpStatus: rw.status,
                  passed: rw.status >= 200 && rw.status < 300,
                  responseBody: tryParseJson(rw.body),
                },
              }
            : {}),
        };
      }),
    };
    void saveToFile(
      exportFilename("batch-results", "json"),
      JSON.stringify(data, null, 2),
      [{ name: "JSON", extensions: ["json"] }],
      "Results"
    );
  };

  const exportHtml = () => {
    void saveToFile(
      exportFilename("batch-report", "html"),
      buildReportHtml(),
      [{ name: "HTML", extensions: ["html", "htm"] }],
      "Report"
    );
  };

  // ── Save to Test Suite ────────────────────────────────────────────────────

  const saveToSuite = () => {
    const suite = createSuite(`Batch Run — ${new Date().toLocaleString()}`, "");
    const passedRows = rows.filter(
      (r) =>
        r.status === "done" &&
        r.httpStatus !== undefined &&
        r.httpStatus >= 200 &&
        r.httpStatus < 300
    );
    for (const row of passedRows) {
      const testCase: TestCase = {
        id: crypto.randomUUID(),
        name: `${row.endpoint} — ${JSON.stringify(row.body).slice(0, 60)}`,
        endpoint: row.endpoint,
        body: row.body,
        assertions: [{ type: "status", op: "eq", value: 200 }],
      };
      addCase(suite.id, testCase);
    }
    void navigate("/suites");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Top toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="text-muted-foreground h-4 w-4" />
          <div>
            <h2 className="text-sm font-semibold">{t("batch.title")}</h2>
            <p className="text-muted-foreground text-xs">{t("batch.description")}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Auto-rewrite toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="auto-rewrite"
              checked={autoRewrite}
              onCheckedChange={setAutoRewrite}
              disabled={running}
            />
            <Label htmlFor="auto-rewrite" className="cursor-pointer text-xs select-none">
              Auto-Rewrite <span className="text-muted-foreground">(risky / HITL)</span>
            </Label>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="size-3.5" />
                {t("batch.download_template")}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  void saveToFile(
                    "batch-template.csv",
                    CSV_TEMPLATE,
                    [{ name: "CSV", extensions: ["csv"] }],
                    "Template"
                  )
                }
              >
                {t("batch.template_csv")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void saveToFile(
                    "batch-template.jsonl",
                    JSONL_TEMPLATE,
                    [{ name: "JSONL", extensions: ["jsonl", "ndjson"] }],
                    "Template"
                  )
                }
              >
                {t("batch.template_jsonl")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Drop / file-list zone ─────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg border-2 border-dashed transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        )}
      >
        {/* Hidden multi-file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jsonl,.ndjson,.csv,.txt"
          className="hidden"
          onChange={handleFileChange}
        />

        {files.length === 0 ? (
          /* ── Empty state: full click-to-browse zone ── */
          <div
            onClick={() => fileInputRef.current?.click()}
            className="hover:bg-muted/30 cursor-pointer px-6 py-10 text-center select-none"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="bg-muted rounded-full p-3">
                <ArrowDownToLine className="text-muted-foreground size-5" />
              </div>
              <p className="text-sm font-medium">{t("requests.bulk_drop_hint")}</p>
              <div className="text-muted-foreground space-y-1 text-xs">
                <p>
                  <code className="bg-muted rounded px-1 py-0.5">JSONL</code>{" "}
                  {t("requests.bulk_format_jsonl")}
                </p>
                <p>
                  <code className="bg-muted rounded px-1 py-0.5">CSV</code>{" "}
                  {t("requests.bulk_format_csv")}
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* ── Loaded files list ── */
          <div className="divide-y">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium">
                {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
                <span className="text-muted-foreground font-normal">{rows.length} rows total</span>
              </span>
              {!running && (
                <span className="text-muted-foreground text-xs">
                  {canReorder
                    ? "Drag-drop more files to add · use arrows to reorder"
                    : "Clear to load new files"}
                </span>
              )}
            </div>

            {/* File rows */}
            {files.map((f, fi) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <FileJson className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{f.filename}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {f.rowCount} rows
                </span>
                {/* Reorder buttons */}
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => moveFile(f.id, "up")}
                    disabled={fi === 0 || !canReorder}
                    className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => moveFile(f.id, "down")}
                    disabled={fi === files.length - 1 || !canReorder}
                    className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
                {/* Remove button */}
                <button
                  onClick={() => removeFile(f.id)}
                  disabled={running}
                  className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                  title="Remove file"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}

            {/* Add-more strip */}
            {!running && rows.length < MAX_BULK_ROWS && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="text-muted-foreground hover:bg-muted/30 hover:text-foreground flex cursor-pointer items-center gap-2 px-4 py-2 text-xs transition-colors select-none"
              >
                <Plus className="size-3.5" />
                Add more files (or drop here)
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Column mapping panel ──────────────────────────────────────────── */}
      {csvMappingData && (
        <div className="space-y-3 rounded-lg border bg-amber-50/50 p-4 dark:bg-amber-950/20">
          <div>
            <p className="text-sm font-semibold">{t("batch.column_mapping_title")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("batch.column_mapping_desc")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Endpoint column */}
            <div className="space-y-1">
              <label className="text-xs font-medium">endpoint</label>
              <Select
                value={csvMappingData.endpointCol}
                onValueChange={(v) =>
                  setCsvMappingData((prev) => prev && { ...prev, endpointCol: v })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {csvMappingData.headers.map((h) => (
                    <SelectItem key={h} value={h} className="text-xs">
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* content mapping */}
            <div className="space-y-1">
              <label className="text-xs font-medium">content</label>
              <Select
                value={csvMappingData.bodyMapping.content ?? ""}
                onValueChange={(v) =>
                  setCsvMappingData(
                    (prev) => prev && { ...prev, bodyMapping: { ...prev.bodyMapping, content: v } }
                  )
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {csvMappingData.headers.map((h) => (
                    <SelectItem key={h} value={h} className="text-xs">
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* language mapping */}
            <div className="space-y-1">
              <label className="text-xs font-medium">language</label>
              <Select
                value={csvMappingData.bodyMapping.language ?? ""}
                onValueChange={(v) =>
                  setCsvMappingData(
                    (prev) => prev && { ...prev, bodyMapping: { ...prev.bodyMapping, language: v } }
                  )
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {csvMappingData.headers.map((h) => (
                    <SelectItem key={h} value={h} className="text-xs">
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={applyMapping}>
              {t("batch.column_mapping_apply")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCsvMappingData(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Parse error ───────────────────────────────────────────────────── */}
      {parseError && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3">
          <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-destructive text-sm">{parseError}</p>
        </div>
      )}

      {/* ── Run controls ──────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            {allDone && (
              <p
                className={cn(
                  "text-xs font-medium",
                  failedCount + errorCount > 0
                    ? "text-destructive"
                    : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {t("requests.bulk_done_summary", {
                  passed,
                  failed: failedCount + errorCount,
                })}
              </p>
            )}
            {rows.length >= MAX_BULK_ROWS && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("requests.bulk_max_rows", { max: MAX_BULK_ROWS })}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {running ? (
              <>
                <span className="text-muted-foreground text-xs">
                  {t("requests.bulk_running", {
                    done: completedCount,
                    total: rows.length,
                  })}
                </span>
                <Button variant="outline" size="sm" onClick={cancel}>
                  {t("requests.bulk_cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={clear}>
                  {t("requests.bulk_clear")}
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void runAll()}
                  disabled={rows.length === 0}
                >
                  <Play className="size-3.5" />
                  {t("requests.bulk_run_all")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Stats card (shown after allDone) ─────────────────────────────── */}
      {allDone && (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="text-muted-foreground size-4" />
            <span className="text-sm font-semibold">Results Summary</span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <StatTile label={t("batch.stats_total")} value={rows.length} />
            <StatTile
              label={t("batch.stats_passed")}
              value={passed}
              className="text-emerald-600 dark:text-emerald-400"
            />
            <StatTile
              label={t("batch.stats_failed")}
              value={failedCount}
              className="text-destructive"
            />
            <StatTile
              label={t("batch.stats_errors")}
              value={errorCount}
              className="text-amber-600 dark:text-amber-400"
            />
            <StatTile label={t("batch.stats_pass_rate")} value={`${passRate}%`} />
            <StatTile label={t("batch.stats_avg_latency")} value={`${avgLatency} ms`} />
          </div>

          {/* Auto-rewrite summary — only when rewrites were triggered */}
          {autoRewrite && rewriteTotal > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50/50 px-4 py-2.5 text-xs dark:border-amber-800/40 dark:bg-amber-950/20">
              <RefreshCw className="size-3.5 shrink-0 text-amber-500" />
              <span className="font-medium text-amber-700 dark:text-amber-400">Auto-Rewrite</span>
              <span className="text-muted-foreground">·</span>
              <span>
                <span className="font-semibold">{rewriteTotal}</span> triggered
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-emerald-600 dark:text-emerald-400">
                <span className="font-semibold">{rewritePassed}</span> succeeded
              </span>
              {rewriteFailed > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-destructive">
                    <span className="font-semibold">{rewriteFailed}</span> failed
                  </span>
                </>
              )}
            </div>
          )}

          {/* Export + Save to Suite buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileDown className="size-3.5" />
                  Export Results
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="gap-2" onClick={exportCsv}>
                  <FileDown className="size-3.5" />
                  {t("batch.export_csv")}
                  <span className="text-muted-foreground ml-auto text-[10px]">.csv</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={exportJson}>
                  <FileJson className="size-3.5" />
                  {t("batch.export_json")}
                  <span className="text-muted-foreground ml-auto text-[10px]">.json</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={exportHtml}>
                  <FileText className="size-3.5" />
                  HTML Report
                  <span className="text-muted-foreground ml-auto text-[10px]">.html</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {passed > 0 && (
              <Button size="sm" className="gap-1.5" onClick={saveToSuite}>
                <FlaskConical className="size-3.5" />
                {t("batch.save_to_suite")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Rows table ────────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          {/* ── Filter bar ─────────────────────────────────────────────── */}
          {allDone && (
            <div className="bg-muted/20 flex items-center gap-2 border-b px-4 py-2">
              <Filter className="text-muted-foreground size-3.5 shrink-0" />
              <div className="flex gap-1">
                {(
                  [
                    ["all", t("batch.filter_all")],
                    ["passed", t("batch.filter_passed")],
                    ["failed", t("batch.filter_failed")],
                    ["error", t("batch.filter_error")],
                  ] as [FilterMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setFilterMode(mode)}
                    className={cn(
                      "rounded px-2.5 py-0.5 text-xs font-medium transition-colors",
                      filterMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {filterMode !== "all" && (
                <span className="text-muted-foreground ml-auto text-xs">
                  {filteredRows.length} row{filteredRows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}

          {/* Column headers */}
          <div className="bg-muted/40 text-muted-foreground grid grid-cols-[2.5rem_7rem_1fr_10rem_1.5rem] gap-3 border-b px-4 py-2 text-xs font-medium">
            <span>#</span>
            <span>Endpoint</span>
            <span>Body</span>
            <span className="text-right">Status</span>
            <span />
          </div>

          {/* Paged rows */}
          <div className="divide-y">
            {pagedRows.map((row, pageIdx) => {
              const globalIdx =
                filterMode === "all" ? (currentPage - 1) * pageSize + pageIdx : rows.indexOf(row);
              const isOk =
                row.httpStatus !== undefined && row.httpStatus >= 200 && row.httpStatus < 300;
              const canExpand = row.status === "done" || row.status === "error";
              const isExpanded = expandedRows.has(row._id);

              return (
                <div key={row._id}>
                  <div
                    onClick={() => canExpand && toggleExpand(row._id)}
                    className={cn(
                      "grid grid-cols-[2.5rem_7rem_1fr_10rem_1.5rem] items-center gap-3 px-4 py-2 text-xs",
                      canExpand && "hover:bg-muted/40 cursor-pointer",
                      row.status === "running" && "bg-primary/5",
                      isExpanded && "bg-muted/30"
                    )}
                  >
                    <span className="text-muted-foreground font-mono">{globalIdx + 1}</span>

                    <span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        /{row.endpoint.toLowerCase()}
                      </Badge>
                    </span>

                    <span className="text-muted-foreground min-w-0 truncate font-mono">
                      {JSON.stringify(row.body).slice(0, 90)}
                    </span>

                    <span className="flex items-center justify-end gap-1.5 font-mono">
                      {row.status === "pending" && (
                        <span className="text-muted-foreground">{t("requests.bulk_pending")}</span>
                      )}
                      {row.status === "running" && (
                        <Loader2 className="text-primary ml-auto size-3.5 animate-spin" />
                      )}
                      {row.status === "done" && (
                        <span
                          className={cn(
                            isOk ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                          )}
                        >
                          {t("requests.bulk_status_done", {
                            status: row.httpStatus,
                            ms: row.durationMs,
                          })}
                        </span>
                      )}
                      {row.status === "error" && (
                        <span className="text-destructive">{t("requests.bulk_status_error")}</span>
                      )}
                      {/* Auto-rewrite indicators */}
                      {rewritingRows.has(row._id) && (
                        <span
                          title="Auto-Rewrite in progress…"
                          className="flex items-center gap-0.5 text-[10px] text-amber-500"
                        >
                          <RefreshCw className="size-3 animate-spin" />
                          Rewriting…
                        </span>
                      )}
                      {!rewritingRows.has(row._id) &&
                        rewriteResults.has(row._id) &&
                        (() => {
                          const rw = rewriteResults.get(row._id)!;
                          const rwOk = rw.status >= 200 && rw.status < 300;
                          return (
                            <span
                              title={`Auto-Rewrite → HTTP ${rw.status}`}
                              className={cn(
                                "flex items-center gap-0.5 text-[10px]",
                                rwOk ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                              )}
                            >
                              <RefreshCw className="size-3" />
                              {rwOk ? "Rewritten" : `Rewrite ${rw.status}`}
                            </span>
                          );
                        })()}
                    </span>

                    <span className="text-muted-foreground flex justify-center">
                      {canExpand &&
                        (isExpanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        ))}
                    </span>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="bg-muted/20 space-y-2 border-t px-6 py-3">
                      {row.status === "error" && (
                        <div className="flex items-start gap-2">
                          <AlertCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
                          <p className="text-destructive text-xs break-all">
                            {row.errorMsg ?? "Unknown error"}
                          </p>
                        </div>
                      )}
                      {row.status === "done" && (
                        <>
                          <div className="text-muted-foreground flex items-center gap-3 text-xs">
                            <span>
                              HTTP{" "}
                              <span
                                className={cn(
                                  "font-mono font-bold",
                                  isOk
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-destructive"
                                )}
                              >
                                {row.httpStatus}
                              </span>
                            </span>
                            <span>·</span>
                            <span>{row.durationMs} ms</span>
                          </div>
                          {row.responseBody ? (
                            <div className="bg-muted/50 max-h-52 overflow-auto rounded-md border p-3">
                              <JsonViewer code={row.responseBody} />
                              {row.responseBody.length >= 3_000 && (
                                <p className="mt-1 text-[11px] text-amber-500">
                                  … (truncated at 3 000 chars)
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-xs italic">
                              Empty body (204 No Content)
                            </p>
                          )}

                          {/* Auto-rewrite result */}
                          {rewriteResults.has(row._id) &&
                            (() => {
                              const rw = rewriteResults.get(row._id)!;
                              const rwOk = rw.status >= 200 && rw.status < 300;
                              return (
                                <div className="mt-2 space-y-1">
                                  <p
                                    className={cn(
                                      "text-[11px] font-semibold",
                                      rwOk
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-destructive"
                                    )}
                                  >
                                    Auto-Rewrite → HTTP {rw.status}
                                  </p>
                                  <div className="bg-muted/50 max-h-40 overflow-auto rounded-md border p-3">
                                    <JsonViewer code={rw.body} />
                                  </div>
                                </div>
                              );
                            })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Pagination bar ────────────────────────────────────────── */}
          <div className="bg-muted/20 flex items-center justify-between border-t px-4 py-2">
            {/* Page-size selector */}
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as PageSize);
                  setCurrentPage(1);
                }}
                className="bg-background border-input rounded border px-1.5 py-0.5 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            {/* Page navigation */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  ‹ Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next ›
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat tile sub-component ──────────────────────────────────────────────────

function StatTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className="bg-muted/20 rounded-md border px-3 py-2 text-center">
      <p className={cn("text-lg font-bold tabular-nums", className)}>{value}</p>
      <p className="text-muted-foreground mt-0.5 text-[10px]">{label}</p>
    </div>
  );
}
