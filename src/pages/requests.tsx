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

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileJson,
  Fingerprint,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  WifiOff,
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
import { useRequestStore } from "@/stores/request-store";
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
    <div className="space-y-6">
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
                    Custom headers are forwarded by the Rust HTTP client. The bearer token is always
                    injected automatically for endpoints that require auth.
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
    </div>
  );
}
