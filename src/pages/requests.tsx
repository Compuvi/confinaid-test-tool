/**
 * Requests page — a faithful port of the frontend's ApiRequestConsole.
 *
 * Adaptations from the original:
 *   - fetch() → Rust IPC (useSendRequest / commands.request.send)
 *   - i18n via react-i18next (same 5 languages as the rest of the app)
 *   - No syntax-highlighted CodeBlock: plain <pre> with monospace
 *   - No TokenizedTextarea: plain <Textarea>
 *   - No motion/react: simple spinner instead of animated placeholder
 *   - No CORS warnings: calls go through Rust, not the browser's fetch
 *   - Token state from Zustand store (captured from responses) instead of props
 *   - client_secret is optional — falls back to the OS keychain when left blank
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  FileJson,
  Fingerprint,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { useSendRequest, useTokenStatus } from "@/lib/api/hooks/use-request";
import { useStoredCredentials } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/errors";
import { logRequest, logFailedRequest } from "@/lib/api/request-logger";
import { commands } from "@/lib/api/tauri-client";
import { useRequestStore } from "@/stores/request-store";
import { useBulkStore, getBulkAbort, setBulkAbort } from "@/stores/bulk-store";
import type { BulkRowInput } from "@/stores/bulk-store";
import { cn } from "@/lib/utils";
import type { EndpointId } from "@/types/request";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Sample text to pre-fill the content field — same as the frontend. */
const SAMPLE_TEXT = "Merhaba, sözleşme taslağını ekte gönderiyorum.";

// ─── Endpoint spec ────────────────────────────────────────────────────────────

type FieldKind = "text" | "textarea" | "secret" | "clientId";

interface FillContext {
  /** Token pair from the last successful /v1/token or /v1/token/refresh. */
  tokenPair: { access_token: string; refresh_token: string } | null;
  /** analysis_id from the last successful /v1/analyze call. */
  analysisId: string;
  /** client_id from the stored Connection credentials. */
  storedClientId: string;
}

interface FieldSpec {
  name: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
  /** Derived value shown until the user types over it. */
  fill?: (ctx: FillContext) => string;
}

interface EndpointSpec {
  id: EndpointId;
  method: "POST";
  path: string;
  group: "auth" | "api";
  requiresAuth: boolean;
  fields: readonly FieldSpec[];
  /** Maps field values → the exact JSON body sent. Omits empty optional keys. */
  toBody: (values: Record<string, string>) => unknown;
  /** Maps a JSON body back onto field values (used when leaving JSON mode). */
  fromBody: (body: Record<string, unknown>) => Record<string, string>;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

const ENDPOINTS: readonly EndpointSpec[] = [
  {
    id: "Token",
    method: "POST",
    path: "/v1/token",
    group: "auth",
    requiresAuth: false,
    fields: [
      {
        name: "client_id",
        kind: "clientId",
        required: true,
        fill: ({ storedClientId }) => storedClientId,
      },
      {
        name: "client_secret",
        kind: "secret",
        required: false,
        placeholder: "Leave blank to use keychain secret",
      },
    ],
    toBody: (v) => ({
      client_id: v.client_id,
      ...(v.client_secret?.trim() ? { client_secret: v.client_secret } : {}),
    }),
    fromBody: (b) => ({
      client_id: asText(b.client_id),
      client_secret: asText(b.client_secret),
    }),
  },
  {
    id: "Refresh",
    method: "POST",
    path: "/v1/token/refresh",
    group: "auth",
    requiresAuth: false,
    fields: [
      {
        name: "refresh_token",
        kind: "secret",
        required: true,
        fill: ({ tokenPair }) => tokenPair?.refresh_token ?? "",
      },
    ],
    toBody: (v) => ({ refresh_token: v.refresh_token }),
    fromBody: (b) => ({ refresh_token: asText(b.refresh_token) }),
  },
  {
    id: "Revoke",
    method: "POST",
    path: "/v1/token/revoke",
    group: "auth",
    requiresAuth: false,
    fields: [
      {
        name: "token",
        kind: "secret",
        required: true,
        fill: ({ tokenPair }) => tokenPair?.access_token ?? "",
      },
    ],
    toBody: (v) => ({ token: v.token }),
    fromBody: (b) => ({ token: asText(b.token) }),
  },
  {
    id: "Analyze",
    method: "POST",
    path: "/v1/analyze",
    group: "api",
    requiresAuth: true,
    fields: [
      {
        name: "content",
        kind: "textarea",
        required: true,
        fill: () => SAMPLE_TEXT,
      },
    ],
    toBody: (v) => ({ content: v.content }),
    fromBody: (b) => ({ content: asText(b.content) }),
  },
  {
    id: "Rewrite",
    method: "POST",
    path: "/v1/rewrite",
    group: "api",
    requiresAuth: true,
    fields: [
      {
        name: "content",
        kind: "textarea",
        required: true,
        fill: () => SAMPLE_TEXT,
      },
      {
        name: "analysis_id",
        kind: "text",
        placeholder: "Filled automatically from the last Analyze response",
        fill: ({ analysisId }) => analysisId,
      },
    ],
    toBody: (v) => ({
      content: v.content,
      ...(v.analysis_id?.trim() ? { analysis_id: v.analysis_id.trim() } : {}),
    }),
    fromBody: (b) => ({
      content: asText(b.content),
      analysis_id: asText(b.analysis_id),
    }),
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusTone(status: number): string {
  if (status >= 200 && status < 300)
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status >= 300 && status < 400)
    return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  if (status >= 400 && status < 500)
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";
}

const STATUS_REASONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function statusReason(status: number): string {
  return STATUS_REASONS[status] ?? "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HttpMethodBadge({ method }: { method: "POST" }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-emerald-600 dark:text-emerald-400">
      {method}
    </span>
  );
}

function SectionHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      {icon}
      {title}
    </h3>
  );
}

function MetaChip({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <span
      title={label}
      className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-[11px]"
    >
      <span className="shrink-0 opacity-70" aria-hidden>
        {icon}
      </span>
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}

function ResponsePlaceholder({ isSending, t }: { isSending: boolean; t: (key: string) => string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-4 py-14 text-center">
      <div className="bg-muted/40 flex h-12 w-12 items-center justify-center rounded-2xl border">
        {isSending ? (
          <Loader2 className="text-primary h-5 w-5 animate-spin" />
        ) : (
          <Inbox className="text-muted-foreground h-5 w-5" />
        )}
      </div>
      <div className="space-y-1">
        <p className="text-foreground/70 text-sm font-medium">
          {isSending ? t("requests.sending_button") : t("requests.empty_title")}
        </p>
        <p className="text-muted-foreground mx-auto max-w-xs text-xs leading-relaxed">
          {isSending ? t("requests.sending_button") : t("requests.empty_description")}
        </p>
      </div>
    </div>
  );
}

// ─── Bulk import ─────────────────────────────────────────────────────────────

const MAX_BULK_ROWS = 500;

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
  // Split on \r\n (Windows) or \n (Unix) so CRLF files parse cleanly.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const endpoint = obj.endpoint as string;
      if (!ENDPOINTS.some((e) => e.id === endpoint)) continue;

      // Prefer an explicit `body` key; fall back to everything else.
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
  // Split on \r\n (Windows) or \n (Unix) — the trailing \r in CRLF files was
  // leaking into field values and causing 400 errors ("language":"en\r").
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const epIdx = headers.findIndex((h) => h.toLowerCase() === "endpoint");
  if (epIdx === -1) return [];

  const rows: BulkRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const endpoint = vals[epIdx]?.trim();
    if (!endpoint || !ENDPOINTS.some((e) => e.id === endpoint)) continue;

    const body: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j !== epIdx && headers[j]) {
        // Trim each value so trailing \r or spaces never contaminate the body.
        body[headers[j]] = (vals[j] ?? "").trim();
      }
    }
    rows.push({ endpoint: endpoint as EndpointId, body });
  }
  return rows;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function BulkImportPanel() {
  const { t } = useTranslation();
  const { timeoutMs } = useRequestStore();

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

  // ── Ephemeral UI state (fine to reset on remount) ───────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  // Auto-follow the running row while a run is in progress.
  useEffect(() => {
    if (running && completedCount >= 0) {
      setCurrentPage(Math.floor(completedCount / pageSize) + 1);
    }
  }, [completedCount, running, pageSize]);

  // Reset to page 1 whenever the row list changes shape (new file, remove file).
  const rowCount = rows.length;
  useEffect(() => {
    setCurrentPage(1);
  }, [rowCount]);

  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleExpand = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Parse and add a single file. Enforces the global MAX_BULK_ROWS cap. */
  const loadFile = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

      let parsed: BulkRowInput[] = [];
      if (ext === "jsonl" || ext === "ndjson") {
        parsed = parseJsonlFile(text);
      } else if (ext === "csv") {
        parsed = parseCsvFile(text);
      } else {
        parsed = parseJsonlFile(text);
        if (parsed.length === 0) parsed = parseCsvFile(text);
      }

      if (parsed.length === 0) {
        setParseError(t("requests.bulk_parse_error"));
        return;
      }

      // Enforce global cap across all loaded files.
      const currentTotal = useBulkStore.getState().rows.length;
      const remaining = MAX_BULK_ROWS - currentTotal;
      if (remaining <= 0) {
        setParseError(t("requests.bulk_max_rows", { max: MAX_BULK_ROWS }));
        return;
      }
      const capped = parsed.slice(0, remaining);
      const fileId = crypto.randomUUID();
      const newFile = { id: fileId, filename: file.name, rowCount: capped.length };
      const newRows = capped.map((r) => ({
        ...r,
        _id: crypto.randomUUID(),
        _fileId: fileId,
        status: "pending" as const,
      }));
      addFile(newFile, newRows);
    } catch {
      setParseError(t("requests.bulk_parse_error"));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    // Accept all dropped files so the user can drop a folder's worth at once.
    for (const file of Array.from(e.dataTransfer.files)) {
      void loadFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      void loadFile(file);
    }
    e.target.value = ""; // allow re-selecting the same file
  };

  const runAll = async () => {
    if (running || rows.length === 0) return;

    setBulkAbort(false);
    setRunning(true);
    setCompletedCount(0);
    setExpandedRows(new Set());

    const snapshot = rows.map((r) => ({
      ...r,
      status: "pending" as const,
      httpStatus: undefined,
      durationMs: undefined,
      errorMsg: undefined,
      responseBody: undefined,
    }));
    setRows(snapshot);

    for (let i = 0; i < snapshot.length; i++) {
      if (getBulkAbort()) break;
      updateRowAtIndex(i, { status: "running" });

      try {
        const result = await commands.request.send({
          params: { endpoint: snapshot[i].endpoint, body: snapshot[i].body, timeoutMs },
        });
        updateRowAtIndex(i, {
          status: "done",
          httpStatus: result.status,
          durationMs: result.durationMs,
          responseBody: result.body.slice(0, 3_000),
        });
        // Log to monitoring
        logRequest({
          endpoint: snapshot[i].endpoint,
          requestBody: snapshot[i].body,
          result,
          source: "bulk",
          sourceName: "Bulk Import",
        });
      } catch (err: unknown) {
        const bulkErr = getErrorMessage(err);
        updateRowAtIndex(i, { status: "error", errorMsg: bulkErr });
        logFailedRequest({
          endpoint: snapshot[i].endpoint,
          requestBody: snapshot[i].body,
          error: bulkErr,
          source: "bulk",
          sourceName: "Bulk Import",
        });
      }

      setCompletedCount(i + 1);
    }

    setRunning(false);
  };

  const cancel = () => setBulkAbort(true);

  const clear = () => {
    setBulkAbort(true);
    clearStore();
    setExpandedRows(new Set());
  };

  // ── Derived stats ───────────────────────────────────────────────────────
  const passed = rows.filter(
    (r) =>
      r.status === "done" && r.httpStatus !== undefined && r.httpStatus >= 200 && r.httpStatus < 300
  ).length;
  const failed = rows.filter(
    (r) =>
      r.status === "error" ||
      (r.status === "done" &&
        r.httpStatus !== undefined &&
        (r.httpStatus < 200 || r.httpStatus >= 300))
  ).length;
  const allDone = rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "error");
  const canReorder = !running && rows.every((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      {/* ── Drop / file-list zone ─────────────────────────────────────── */}
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

      {/* ── Parse error ──────────────────────────────────────────────────── */}
      {parseError && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3">
          <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-destructive text-sm">{parseError}</p>
        </div>
      )}

      {/* ── Run controls ─────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            {allDone && (
              <p
                className={cn(
                  "text-xs font-medium",
                  failed > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {t("requests.bulk_done_summary", { passed, failed })}
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
                  {t("requests.bulk_running", { done: completedCount, total: rows.length })}
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

      {/* ── Rows table ───────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
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
              const globalIdx = (currentPage - 1) * pageSize + pageIdx;
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

                    <span className="text-right font-mono">
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
                            <pre className="bg-muted/50 text-muted-foreground max-h-52 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                              {row.responseBody}
                              {row.responseBody.length >= 3_000 && (
                                <span className="text-amber-500">
                                  {"\n"}… (truncated at 3 000 chars)
                                </span>
                              )}
                            </pre>
                          ) : (
                            <p className="text-muted-foreground text-xs italic">
                              Empty body (204 No Content)
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Pagination bar ─────────────────────────────────────────── */}
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
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rows.length)}{" "}
                of {rows.length}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function RequestsPage() {
  const { t } = useTranslation();

  // Single subscription — all slices in one call so hook count never drifts.
  const { lastAnalysisId, lastTokenPair, timeoutMs, lastResponse, isLoading, error } =
    useRequestStore();
  const storedCredentials = useStoredCredentials();
  const tokenStatus = useTokenStatus();
  const sendRequest = useSendRequest();

  const storedClientId = storedCredentials.data?.clientId ?? "";

  // ── Mode (Single request vs Bulk import) ─────────────────────────────────
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // ── Endpoint selection ────────────────────────────────────────────────────
  const [endpointId, setEndpointId] = useState<EndpointId>("Token");
  const endpoint = ENDPOINTS.find((e) => e.id === endpointId) ?? ENDPOINTS[0];

  // ── Field values (per-endpoint) ───────────────────────────────────────────
  const [typed, setTyped] = useState<Record<string, Record<string, string>>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // ── JSON mode ─────────────────────────────────────────────────────────────
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState<Record<string, string>>({});

  // ── Custom headers ────────────────────────────────────────────────────────
  const [headers, setHeaders] = useState([
    { id: "auth", name: "Authorization", value: "", locked: true },
    { id: "ct", name: "Content-Type", value: "application/json", locked: false },
  ]);
  const headerSeq = useRef(0);

  // ── Response / failure state ──────────────────────────────────────────────
  const [failure, setFailure] = useState<"network" | "timeout" | null>(null);

  // Build the fill context from store and stored credentials.
  const fillCtx: FillContext = useMemo(
    () => ({
      tokenPair: lastTokenPair,
      analysisId: lastAnalysisId ?? "",
      storedClientId,
    }),
    [lastTokenPair, lastAnalysisId, storedClientId]
  );

  // Derive the current field values (typed overrides fill).
  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of endpoint.fields) {
      out[field.name] = typed[endpoint.id]?.[field.name] ?? field.fill?.(fillCtx) ?? "";
    }
    return out;
  }, [endpoint, typed, fillCtx]);

  const formBody = useMemo(
    () => JSON.stringify(endpoint.toBody(values), null, 2),
    [endpoint, values]
  );

  const draft = jsonDraft[endpoint.id];
  const body = jsonMode && draft !== undefined ? draft : formBody;
  const bodyIsValid = !jsonMode || prettyJson(body) !== null;

  const missingFields = endpoint.fields.filter((f) => f.required && !values[f.name]?.trim());
  const needsToken = endpoint.requiresAuth && !tokenStatus.data;
  const isDirty = Object.keys(typed[endpoint.id] ?? {}).length > 0 || draft !== undefined;

  // The Authorization header value is derived from the Rust token cache —
  // we show a placeholder since the actual bearer is managed by Rust.
  const visibleHeaders = headers.filter((h) => !h.locked || endpoint.requiresAuth);

  const dropDraft = () =>
    setJsonDraft((prev) => {
      if (prev[endpoint.id] === undefined) return prev;
      const next = { ...prev };
      delete next[endpoint.id];
      return next;
    });

  const setField = (name: string, value: string) => {
    setTyped((prev) => ({
      ...prev,
      [endpoint.id]: { ...prev[endpoint.id], [name]: value },
    }));
    dropDraft();
  };

  const resetFields = () => {
    setTyped((prev) => {
      const next = { ...prev };
      delete next[endpoint.id];
      return next;
    });
    dropDraft();
  };

  const toggleJsonMode = (next: boolean) => {
    if (!next && draft !== undefined) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const mapped = endpoint.fromBody(parsed as Record<string, unknown>);
          setTyped((prev) => ({
            ...prev,
            [endpoint.id]: { ...prev[endpoint.id], ...mapped },
          }));
          dropDraft();
        }
      } catch {
        /* malformed — leave draft */
      }
    }
    setJsonMode(next);
  };

  const handleEndpointChange = (id: string) => {
    if (!ENDPOINTS.some((e) => e.id === id)) return;
    setEndpointId(id as EndpointId);
    setFailure(null);
  };

  const updateHeader = (id: string, patch: Partial<(typeof headers)[0]>) =>
    setHeaders((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const canSend = !needsToken && bodyIsValid && (jsonMode || missingFields.length === 0);

  const handleSend = () => {
    if (!canSend) return;
    setFailure(null);

    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // Let Rust surface the error.
    }

    sendRequest.mutate(
      { endpoint: endpointId, body: parsedBody, timeoutMs },
      {
        onError: (err: unknown) => {
          // Check for network/timeout error codes surfaced by TauriError.
          const msg = (err as { message?: string })?.message ?? "";
          if (msg.includes("timed out")) {
            setFailure("timeout");
          } else if ((err as { code?: string })?.code === "NETWORK_ERROR") {
            setFailure("network");
          }
        },
      }
    );
  };

  // Preview: the raw HTTP request as it would look on the wire.
  const preview = useMemo(() => {
    const authLine = endpoint.requiresAuth ? `Authorization: Bearer <token managed by Rust>\n` : "";
    const extraHeaders = headers
      .filter((h) => !h.locked && h.name.trim())
      .map((h) => `${h.name}: ${h.value}`)
      .join("\n");
    return [
      `POST ${endpoint.path} HTTP/1.1`,
      `Host: <api base url from Connection>`,
      `Content-Type: application/json`,
      authLine.trim(),
      extraHeaders,
      "",
      body,
    ]
      .filter(Boolean)
      .join("\n");
  }, [endpoint, headers, body]);

  // ── Render: field ─────────────────────────────────────────────────────────
  const renderField = (field: FieldSpec) => {
    const value = values[field.name] ?? "";
    const controlId = `${endpoint.id}-${field.name}`;

    return (
      <div key={field.name} className="space-y-1.5">
        <Label htmlFor={controlId} className="flex items-center gap-1.5 text-xs">
          <code className="font-mono">{field.name}</code>
          {field.required ? (
            <span className="text-destructive" aria-hidden>
              *
            </span>
          ) : (
            <Badge variant="outline" className="px-1 text-[10px] font-normal">
              optional
            </Badge>
          )}
        </Label>

        {field.kind === "textarea" ? (
          <Textarea
            id={controlId}
            value={value}
            onChange={(e) => setField(field.name, e.target.value)}
            className="min-h-24 resize-y font-mono text-xs"
            placeholder={field.placeholder}
            spellCheck={false}
          />
        ) : field.kind === "secret" ? (
          <div className="flex items-center gap-2">
            <Input
              id={controlId}
              type={revealed[field.name] ? "text" : "password"}
              value={value}
              onChange={(e) => setField(field.name, e.target.value)}
              placeholder={field.placeholder ?? "••••••••"}
              autoComplete="off"
              spellCheck={false}
              className="h-9 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setRevealed((prev) => ({ ...prev, [field.name]: !prev[field.name] }))}
              aria-label={revealed[field.name] ? "Hide value" : "Show value"}
            >
              {revealed[field.name] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <Input
            id={controlId}
            value={value}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            className="h-9 font-mono text-xs"
          />
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="space-y-4">
      <TabsList>
        <TabsTrigger value="single">{t("requests.single_tab")}</TabsTrigger>
        <TabsTrigger value="bulk">{t("requests.bulk_tab")}</TabsTrigger>
      </TabsList>

      {/* ── Bulk Import tab ──────────────────────────────────────────────── */}
      <TabsContent value="bulk">
        <BulkImportPanel />
      </TabsContent>

      {/* ── Single Request tab ───────────────────────────────────────────── */}
      <TabsContent value="single" className="space-y-6">
        {/* ── Request section ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionHeading
            icon={<ArrowUpRight className="text-muted-foreground h-4 w-4" />}
            title={t("requests.title")}
          />

          <div className="overflow-hidden rounded-lg border">
            {/* Top bar: method badge + endpoint picker + send */}
            <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-b p-2.5">
              <HttpMethodBadge method="POST" />

              <Select value={endpointId} onValueChange={handleEndpointChange}>
                <SelectTrigger className="h-9 min-w-0 flex-1 font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("requests.group_auth")}</SelectLabel>
                    {ENDPOINTS.filter((e) => e.group === "auth").map((e) => (
                      <SelectItem key={e.id} value={e.id} className="font-mono">
                        {e.path}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t("requests.group_api")}</SelectLabel>
                    {ENDPOINTS.filter((e) => e.group === "api").map((e) => (
                      <SelectItem key={e.id} value={e.id} className="font-mono">
                        {e.path}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Button
                type="button"
                className="h-9 gap-2"
                onClick={handleSend}
                disabled={!canSend || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {isLoading ? t("requests.sending_button") : t("requests.send_button")}
              </Button>
            </div>

            {/* Subtext: base URL from Connection */}
            <p className="bg-muted/10 text-muted-foreground border-b px-3 py-2 text-xs">
              Base URL from <span className="font-mono">Connection → API base URL</span>
            </p>

            {/* Warnings */}
            {needsToken && (
              <p className="bg-muted/10 text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                {t("requests.needs_token")}
              </p>
            )}

            {endpoint.id === "Revoke" && (
              <p className="flex items-start gap-1.5 border-b bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Revoking a token is permanent. The backend answers 204 whether or not the token
                existed — the endpoint leaks no information about which tokens are live.
              </p>
            )}

            {endpoint.id === "Refresh" && (
              <p className="flex items-start gap-1.5 border-b bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Each refresh token is single-use. Sending the same one twice triggers replay
                detection, which revokes every token on this credential.
              </p>
            )}

            {/* Body / Headers / Preview tabs */}
            <div className="p-3">
              <Tabs defaultValue="params">
                <TabsList>
                  <TabsTrigger value="params">{t("requests.body_section")}</TabsTrigger>
                  <TabsTrigger value="headers" className="gap-1.5">
                    {t("requests.headers_section")}
                    <Badge variant="secondary" className="px-1 text-[10px]">
                      {visibleHeaders.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>

                {/* ── Body tab ──────────────────────────────────────────── */}
                <TabsContent value="params" className="mt-3 space-y-2.5">
                  {/* Fields ⇄ JSON toggle */}
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2">
                      <ListChecks
                        className={cn(
                          "h-3.5 w-3.5 transition-colors",
                          jsonMode ? "text-muted-foreground" : "text-primary"
                        )}
                      />
                      <Label
                        htmlFor={`${endpoint.id}-json-mode`}
                        className={cn(
                          "cursor-pointer text-xs",
                          jsonMode ? "text-muted-foreground font-normal" : ""
                        )}
                      >
                        {t("requests.field_mode")}
                      </Label>
                      <Switch
                        id={`${endpoint.id}-json-mode`}
                        checked={jsonMode}
                        onCheckedChange={toggleJsonMode}
                        aria-label="Toggle JSON editor"
                      />
                      <Label
                        htmlFor={`${endpoint.id}-json-mode`}
                        className={cn(
                          "cursor-pointer text-xs",
                          jsonMode ? "" : "text-muted-foreground font-normal"
                        )}
                      >
                        {t("requests.json_mode")}
                      </Label>
                      <Braces
                        className={cn(
                          "h-3.5 w-3.5 transition-colors",
                          jsonMode ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {jsonMode && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          disabled={!bodyIsValid}
                          onClick={() =>
                            setJsonDraft((prev) => ({
                              ...prev,
                              [endpoint.id]: prettyJson(body) ?? body,
                            }))
                          }
                        >
                          <Braces className="h-3.5 w-3.5" />
                          Format
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={!isDirty}
                        onClick={resetFields}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("requests.reset_body")}
                      </Button>
                    </div>
                  </div>

                  {/* Editor */}
                  {jsonMode ? (
                    <Textarea
                      value={body}
                      onChange={(e) =>
                        setJsonDraft((prev) => ({ ...prev, [endpoint.id]: e.target.value }))
                      }
                      className={cn(
                        "min-h-40 resize-y font-mono text-xs",
                        !bodyIsValid && "border-destructive"
                      )}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="JSON body editor"
                      aria-invalid={!bodyIsValid}
                    />
                  ) : (
                    <div className="space-y-4 pt-1.5">{endpoint.fields.map(renderField)}</div>
                  )}

                  {/* Status line */}
                  <p
                    className={cn(
                      "text-xs leading-relaxed",
                      bodyIsValid ? "text-muted-foreground" : "text-destructive"
                    )}
                  >
                    {!bodyIsValid
                      ? "Body is not valid JSON."
                      : jsonMode
                        ? "JSON mode — the body is sent exactly as written."
                        : missingFields.length > 0
                          ? t("requests.missing_fields", {
                              fields: missingFields.map((f) => f.name).join(", "),
                            })
                          : "Ready to send."}
                  </p>
                </TabsContent>

                {/* ── Headers tab ───────────────────────────────────────── */}
                <TabsContent value="headers" className="mt-3 space-y-2">
                  {visibleHeaders.map((header) => (
                    <div key={header.id} className="flex items-center gap-2">
                      <Input
                        value={header.name}
                        onChange={(e) => updateHeader(header.id, { name: e.target.value })}
                        disabled={header.locked}
                        placeholder="Header name"
                        className="h-9 flex-1 font-mono text-xs"
                      />
                      <Input
                        value={
                          header.locked
                            ? tokenStatus.data
                              ? `Bearer …${tokenStatus.data.accessHint}`
                              : ""
                            : header.value
                        }
                        onChange={(e) => updateHeader(header.id, { value: e.target.value })}
                        disabled={header.locked}
                        placeholder={header.locked ? "Managed by Rust token cache" : "Header value"}
                        className="h-9 flex-1 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        disabled={header.locked}
                        onClick={() => setHeaders((prev) => prev.filter((h) => h.id !== header.id))}
                        aria-label="Remove header"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() =>
                        setHeaders((prev) => [
                          ...prev,
                          {
                            id: `h${(headerSeq.current += 1)}`,
                            name: "X-Request-ID",
                            value: "",
                            locked: false,
                          },
                        ])
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("requests.add_header")}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Custom headers are forwarded by the Rust HTTP client. The bearer token is
                      always injected automatically for endpoints that require auth.
                    </p>
                  </div>
                </TabsContent>

                {/* ── Preview tab ───────────────────────────────────────── */}
                <TabsContent value="preview" className="mt-3 space-y-2">
                  <div className="bg-muted/30 relative rounded-md border">
                    <CopyButton
                      text={preview}
                      className="absolute top-2 right-2"
                      aria-label="Copy request preview"
                    />
                    <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
                      {preview}
                    </pre>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Approximate wire representation. The actual bearer token is injected by Rust
                    immediately before the call and never surfaces here.
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </section>

        {/* ── Response section ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionHeading
            icon={<ArrowDownLeft className="text-muted-foreground h-4 w-4" />}
            title={t("requests.response_section")}
          />

          {/* Placeholder / spinner */}
          {isLoading || (!lastResponse && !failure && !error) ? (
            <ResponsePlaceholder isSending={isLoading} t={t} />
          ) : null}

          {/* Network / timeout failure */}
          {failure && !isLoading ? (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {failure === "timeout" ? "Request timed out" : "Network error"}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {failure === "timeout"
                    ? `The request was aborted after ${timeoutMs} ms. Increase the timeout or check whether the API is reachable.`
                    : "The Rust HTTP client could not connect. Check the API base URL on the Connection page."}
                </p>
              </div>
            </div>
          ) : null}

          {/* IPC / validation error (not a network error) */}
          {error && !failure && !isLoading ? (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-sm">{error}</p>
            </div>
          ) : null}

          {/* Response card */}
          {lastResponse && !isLoading ? (
            <div className="overflow-hidden rounded-lg border">
              {/* Meta strip */}
              <div className="bg-muted/30 space-y-2 border-b px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-xs font-bold",
                      statusTone(lastResponse.status)
                    )}
                  >
                    {lastResponse.status} {statusReason(lastResponse.status)}
                  </span>
                  <HttpMethodBadge method="POST" />
                  <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                    {lastResponse.url}
                  </code>
                  {lastResponse.body ? (
                    <CopyButton text={lastResponse.body} aria-label="Copy response body" />
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <MetaChip icon={<Clock className="h-3 w-3" />} label="Duration">
                    {lastResponse.durationMs} ms
                  </MetaChip>
                  <MetaChip icon={<ArrowDownToLine className="h-3 w-3" />} label="Size">
                    {formatBytes(lastResponse.sizeBytes)}
                  </MetaChip>
                  {lastResponse.isJson && (
                    <MetaChip icon={<FileJson className="h-3 w-3" />} label="Content type">
                      <code className="font-mono">application/json</code>
                    </MetaChip>
                  )}
                  {lastResponse.tokenHint && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                      Token active (…{lastResponse.tokenHint.accessHint})
                    </span>
                  )}
                  {/* X-Request-ID surfaced for support queries */}
                  {(() => {
                    const reqId = lastResponse.headers.find(
                      ([name]) => name.toLowerCase() === "x-request-id"
                    )?.[1];
                    return reqId ? (
                      <MetaChip icon={<Fingerprint className="h-3 w-3" />} label="Request ID">
                        <code className="max-w-48 min-w-0 truncate font-mono">{reqId}</code>
                        <CopyButton text={reqId} aria-label="Copy request ID" />
                      </MetaChip>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Body / Headers tabs */}
              <div className="p-3">
                <Tabs defaultValue="resBody">
                  <TabsList>
                    <TabsTrigger value="resBody">{t("requests.response_tab_body")}</TabsTrigger>
                    <TabsTrigger value="resHeaders" className="gap-1.5">
                      {t("requests.response_tab_headers")}
                      <Badge variant="secondary" className="px-1 text-[10px]">
                        {lastResponse.headers.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="resBody" className="mt-3">
                    {lastResponse.body ? (
                      <div className="bg-muted/30 relative rounded-md border">
                        <pre className="max-h-[36rem] overflow-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                          {lastResponse.body}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                        Empty body (204 No Content)
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="resHeaders" className="mt-3 space-y-2">
                    {lastResponse.headers.length === 0 ? (
                      <p className="text-muted-foreground text-xs">No headers returned.</p>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        {lastResponse.headers.map(([name, value]) => (
                          <div key={name} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
                            <code className="font-mono text-xs font-medium">{name}</code>
                            <code className="text-muted-foreground min-w-0 font-mono text-xs break-all">
                              {value}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Only headers the Rust HTTP client received from the server are shown here.
                    </p>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          ) : null}
        </section>
      </TabsContent>
    </Tabs>
  );
}
