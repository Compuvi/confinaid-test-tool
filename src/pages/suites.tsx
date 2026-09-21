/**
 * Suites page — create, edit and run saved test suites.
 *
 * Layout: two-pane (left = suite list, right = suite detail / runner).
 *
 * All execution is purely frontend: the existing `commands.request.send`
 * Tauri command is called per case and assertions are evaluated in TypeScript
 * by the `suite-runner` library. No new Rust commands were needed.
 */

import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FlaskConical,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { commands } from "@/lib/api/tauri-client";
import { getErrorMessage } from "@/lib/api/errors";
import { logRequest, logFailedRequest } from "@/lib/api/request-logger";
import { evaluateAssertions } from "@/lib/suite-runner";
import { DEFAULT_BODIES } from "@/stores/request-store";
import { useSuiteStore } from "@/stores/suite-store";
import { cn } from "@/lib/utils";

import type { EndpointId } from "@/types/request";
import type {
  Assertion,
  AssertionResult,
  BodyOp,
  CaseResult,
  HeaderOp,
  LatencyOp,
  StatusOp,
  Suite,
  SuiteRunResult,
  TestCase,
} from "@/types/suite";

// ──────────────────────────────────────────────────────── Draft types ─────

type DraftAssertion = {
  /** Stable key for React list rendering. */
  _id: string;
  type: "status" | "body" | "header" | "latency";
  /** String representation shared across all op fields (converted on save). */
  op: string;
  value: string;
  /** body-assertion path, e.g. "risk_score" */
  path: string;
  /** header-assertion name */
  headerName: string;
};

type DraftCase = {
  name: string;
  endpoint: EndpointId;
  bodyText: string;
  timeoutMs: string;
  assertions: DraftAssertion[];
};

// ──────────────────────────────────────────────────────── Converters ──────

function newDraftAssertion(): DraftAssertion {
  return {
    _id: crypto.randomUUID(),
    type: "status",
    op: "eq",
    value: "200",
    path: "",
    headerName: "",
  };
}

function assertionToDraft(a: Assertion): DraftAssertion {
  const _id = crypto.randomUUID();
  switch (a.type) {
    case "status":
      return { _id, type: "status", op: a.op, value: String(a.value), path: "", headerName: "" };
    case "body":
      return { _id, type: "body", op: a.op, value: a.value ?? "", path: a.path, headerName: "" };
    case "header":
      return { _id, type: "header", op: a.op, value: a.value ?? "", path: "", headerName: a.name };
    case "latency":
      return { _id, type: "latency", op: "lte", value: String(a.value), path: "", headerName: "" };
  }
}

/** Returns null when the draft is incomplete/invalid. */
function draftToAssertion(d: DraftAssertion): Assertion | null {
  switch (d.type) {
    case "status": {
      const v = parseInt(d.value, 10);
      if (isNaN(v)) return null;
      return { type: "status", op: d.op as StatusOp, value: v };
    }
    case "body": {
      const needsValue = d.op !== "exists" && d.op !== "not_exists";
      return {
        type: "body",
        path: d.path,
        op: d.op as BodyOp,
        ...(needsValue ? { value: d.value } : {}),
      };
    }
    case "header": {
      const needsValue = d.op !== "exists";
      return {
        type: "header",
        name: d.headerName,
        op: d.op as HeaderOp,
        ...(needsValue ? { value: d.value } : {}),
      };
    }
    case "latency": {
      const v = parseInt(d.value, 10);
      if (isNaN(v) || v <= 0) return null;
      return { type: "latency", op: "lte" as LatencyOp, value: v };
    }
  }
}

function caseToDraft(c: TestCase): DraftCase {
  return {
    name: c.name,
    endpoint: c.endpoint,
    bodyText: JSON.stringify(c.body, null, 2),
    timeoutMs: c.timeoutMs !== undefined ? String(c.timeoutMs) : "",
    assertions: c.assertions.map(assertionToDraft),
  };
}

function defaultDraftCase(endpoint: EndpointId = "Token"): DraftCase {
  return {
    name: "",
    endpoint,
    bodyText: DEFAULT_BODIES[endpoint],
    timeoutMs: "",
    assertions: [],
  };
}

// ──────────────────────────────────────────────────────── Known paths ────

/**
 * Known top-level JSON response fields per endpoint — sourced from real API responses.
 * Used to populate the path datalist so users can pick instead of guessing.
 *
 * Token / Refresh response: { access_token, expires_in, refresh_token, scope, token_type }
 * Revoke response:          empty body — assert on status code only
 * Analyze response:         { analysis_id, findings, is_risky, language, request_id, risk_score }
 * Rewrite response:         { analysis_id, request_id, rewritten_text }
 */
const BODY_PATH_SUGGESTIONS: Record<EndpointId, string[]> = {
  Token: ["access_token", "expires_in", "refresh_token", "scope", "token_type"],
  Refresh: ["access_token", "expires_in", "refresh_token", "scope", "token_type"],
  Revoke: [], // 204 No Content — use a Status-code assertion instead
  Analyze: ["analysis_id", "findings", "is_risky", "language", "request_id", "risk_score"],
  Rewrite: ["analysis_id", "request_id", "rewritten_text"],
};

/** Known response header names worth asserting on. */
const HEADER_NAME_SUGGESTIONS = [
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-request-id",
];

// ──────────────────────────────────────────────────────── AssertionRow ────

type AssertionRowProps = {
  draft: DraftAssertion;
  /** The endpoint chosen for this test case — used to show relevant path suggestions. */
  endpoint: EndpointId;
  onChange: (next: DraftAssertion) => void;
  onRemove: () => void;
};

function AssertionRow({ draft, endpoint, onChange, onRemove }: AssertionRowProps) {
  const { t } = useTranslation();
  // Unique IDs for datalist elements so multiple rows don't clash.
  const pathListId = `path-list-${draft._id}`;
  const headerListId = `header-list-${draft._id}`;

  const upd = (partial: Partial<DraftAssertion>) => onChange({ ...draft, ...partial });

  // When the user switches type, reset op/value to sensible defaults.
  const handleTypeChange = (type: DraftAssertion["type"]) => {
    const defaults: Record<DraftAssertion["type"], Partial<DraftAssertion>> = {
      status: { op: "eq", value: "200", path: "", headerName: "" },
      body: { op: "eq", value: "", path: "", headerName: "" },
      header: { op: "exists", value: "", path: "", headerName: "" },
      latency: { op: "lte", value: "500", path: "", headerName: "" },
    };
    onChange({ ...draft, type, ...defaults[type] });
  };

  const statusOps: StatusOp[] = ["eq", "ne", "gte", "lte"];
  const bodyOps: BodyOp[] = ["eq", "ne", "contains", "not_contains", "exists", "not_exists"];
  const headerOps: HeaderOp[] = ["eq", "contains", "exists"];

  const needsValue =
    (draft.type === "body" && draft.op !== "exists" && draft.op !== "not_exists") ||
    (draft.type === "header" && draft.op !== "exists") ||
    draft.type === "status" ||
    draft.type === "latency";

  const opLabel = (op: string): string => {
    const key = `suites.op_${op}` as const;
    return t(key as Parameters<typeof t>[0]);
  };

  return (
    <div className="bg-muted/30 flex flex-wrap items-start gap-2 rounded-md border p-2">
      {/* Type */}
      <div className="min-w-[110px]">
        <Select
          value={draft.type}
          onValueChange={(v) => handleTypeChange(v as DraftAssertion["type"])}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="status">{t("suites.type_status")}</SelectItem>
            <SelectItem value="body">{t("suites.type_body")}</SelectItem>
            <SelectItem value="header">{t("suites.type_header")}</SelectItem>
            <SelectItem value="latency">{t("suites.type_latency")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Body path — datalist gives suggestions, free text still allowed */}
      {draft.type === "body" && (
        <>
          <datalist id={pathListId}>
            {BODY_PATH_SUGGESTIONS[endpoint].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <Input
            className="h-8 min-w-[100px] flex-1 font-mono text-xs"
            placeholder={t("suites.path_label")}
            value={draft.path}
            list={pathListId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => upd({ path: e.target.value })}
          />
        </>
      )}

      {/* Header name — datalist gives common header suggestions */}
      {draft.type === "header" && (
        <>
          <datalist id={headerListId}>
            {HEADER_NAME_SUGGESTIONS.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <Input
            className="h-8 min-w-[100px] flex-1 text-xs"
            placeholder={t("suites.header_name_label")}
            value={draft.headerName}
            list={headerListId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => upd({ headerName: e.target.value })}
          />
        </>
      )}

      {/* Operator */}
      {draft.type !== "latency" && (
        <div className="min-w-[100px]">
          <Select value={draft.op} onValueChange={(v) => upd({ op: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {draft.type === "status" &&
                statusOps.map((op) => (
                  <SelectItem key={op} value={op}>
                    {opLabel(op)}
                  </SelectItem>
                ))}
              {draft.type === "body" &&
                bodyOps.map((op) => (
                  <SelectItem key={op} value={op}>
                    {opLabel(op)}
                  </SelectItem>
                ))}
              {draft.type === "header" &&
                headerOps.map((op) => (
                  <SelectItem key={op} value={op}>
                    {opLabel(op)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Latency fixed label */}
      {draft.type === "latency" && (
        <span className="text-muted-foreground flex h-8 items-center px-2 text-xs">
          {t("suites.op_lte")}
        </span>
      )}

      {/* Value */}
      {needsValue && (
        <Input
          className="h-8 min-w-[80px] flex-1 font-mono text-xs"
          placeholder={draft.type === "latency" ? "ms" : t("suites.value_label")}
          value={draft.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => upd({ value: e.target.value })}
          type={draft.type === "status" || draft.type === "latency" ? "number" : "text"}
          min={draft.type === "status" ? 100 : 1}
        />
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────── CaseForm ────────

type CaseFormProps = {
  initial: DraftCase;
  onSave: (draft: DraftCase) => void;
  onCancel: () => void;
  title: string;
};

function CaseForm({ initial, onSave, onCancel, title }: CaseFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftCase>(initial);
  const [jsonError, setJsonError] = useState(false);

  const upd = (partial: Partial<DraftCase>) => setDraft((prev) => ({ ...prev, ...partial }));

  const handleEndpointChange = (endpoint: EndpointId) => {
    // Only replace the body when it still matches the old default
    // (i.e. the user hasn't edited it yet).
    const wasDefault = draft.bodyText.trim() === DEFAULT_BODIES[draft.endpoint].trim();
    upd({
      endpoint,
      bodyText: wasDefault ? DEFAULT_BODIES[endpoint] : draft.bodyText,
    });
  };

  const handleBodyChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    upd({ bodyText: text });
    try {
      JSON.parse(text);
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  };

  const addAssertion = () => upd({ assertions: [...draft.assertions, newDraftAssertion()] });

  const updateAssertion = (idx: number, next: DraftAssertion) =>
    upd({
      assertions: draft.assertions.map((a, i) => (i === idx ? next : a)),
    });

  const removeAssertion = (idx: number) =>
    upd({ assertions: draft.assertions.filter((_, i) => i !== idx) });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (jsonError || !draft.name.trim()) return;
    onSave(draft);
  };

  const ENDPOINTS: EndpointId[] = ["Token", "Refresh", "Revoke", "Analyze", "Rewrite"];

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label className="text-xs">{t("suites.case_name_label")}</Label>
            <Input
              placeholder={t("suites.case_name_placeholder")}
              value={draft.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => upd({ name: e.target.value })}
              autoFocus
            />
          </div>

          {/* Endpoint + Timeout */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">{t("suites.endpoint_label")}</Label>
              <Select value={draft.endpoint} onValueChange={handleEndpointChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENDPOINTS.map((ep) => (
                    <SelectItem key={ep} value={ep}>
                      {ep}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-36 space-y-1">
              <Label className="text-xs">{t("suites.timeout_label")}</Label>
              <Input
                type="number"
                placeholder="30000"
                min={500}
                value={draft.timeoutMs}
                onChange={(e: ChangeEvent<HTMLInputElement>) => upd({ timeoutMs: e.target.value })}
              />
            </div>
          </div>

          {/* Body */}
          <div className="space-y-1">
            <Label className="text-xs">{t("suites.body_label")}</Label>
            <Textarea
              className={cn(
                "min-h-[120px] font-mono text-xs",
                jsonError && "border-destructive ring-destructive ring-1"
              )}
              value={draft.bodyText}
              onChange={handleBodyChange}
              spellCheck={false}
            />
            {jsonError && (
              <p className="text-destructive flex items-center gap-1 text-xs">
                <AlertCircle className="size-3" />
                {t("suites.invalid_json")}
              </p>
            )}
          </div>

          {/* Assertions */}
          <div className="space-y-2">
            <Label className="text-xs">{t("suites.assertions_label")}</Label>

            {draft.assertions.length === 0 && (
              <p className="text-muted-foreground text-xs">{t("suites.no_assertions_hint")}</p>
            )}

            {draft.assertions.map((a, idx) => (
              <AssertionRow
                key={a._id}
                draft={a}
                endpoint={draft.endpoint}
                onChange={(next) => updateAssertion(idx, next)}
                onRemove={() => removeAssertion(idx)}
              />
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={addAssertion}
            >
              <Plus className="size-3" />
              {t("suites.add_assertion")}
            </Button>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {t("suites.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!draft.name.trim() || jsonError}>
              {t("suites.save_case")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────── CaseCard ────────

type LiveStatus = "pending" | "running" | "passed" | "failed" | "error";

type CaseCardProps = {
  testCase: TestCase;
  suiteId: string;
  caseResult?: CaseResult;
  liveStatus?: LiveStatus;
  /** True while the suite is actively running — hides all mutating controls. */
  running?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

function CaseCard({
  testCase,
  caseResult,
  liveStatus,
  running,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: CaseCardProps) {
  const { t } = useTranslation();
  const [showAssertions, setShowAssertions] = useState(false);

  const n = testCase.assertions.length;

  // Status badge for run results
  const resultBadge = (() => {
    if (!liveStatus || liveStatus === "pending") return null;
    if (liveStatus === "running") {
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          {t("suites.running")}
        </Badge>
      );
    }
    if (liveStatus === "passed") {
      return (
        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
          <CheckCircle2 className="size-3" />
          {t("suites.case_passed")}
          {caseResult && (
            <span className="opacity-75">
              · {t("suites.duration_ms", { ms: caseResult.durationMs })}
            </span>
          )}
        </Badge>
      );
    }
    if (liveStatus === "failed" || liveStatus === "error") {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="size-3" />
          {liveStatus === "error" ? t("suites.case_error") : t("suites.case_failed")}
          {caseResult?.status ? <span className="opacity-75">· {caseResult.status}</span> : null}
        </Badge>
      );
    }
    return null;
  })();

  return (
    <div className="bg-card rounded-lg border shadow-sm">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{testCase.name}</span>
            <Badge variant="outline" className="font-mono text-xs">
              POST /{testCase.endpoint.toLowerCase()}
            </Badge>
            {resultBadge}
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {n === 0 ? (
              <span>{t("suites.no_assertions_hint")}</span>
            ) : (
              <button
                type="button"
                className="hover:text-foreground flex items-center gap-1"
                onClick={() => setShowAssertions((v) => !v)}
              >
                {showAssertions ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {showAssertions
                  ? t("suites.hide_assertions")
                  : t("suites.show_assertions", { count: n })}
              </button>
            )}

            {caseResult?.error && (
              <span className="text-destructive">
                {t("suites.case_error")}: {caseResult.error}
              </span>
            )}
          </div>
        </div>

        {/* Actions — hidden while the suite is actively running */}
        {!running && (
          <div className="flex shrink-0 gap-1">
            {/* Reorder */}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-7 w-7"
              disabled={isFirst}
              onClick={onMoveUp}
              title="Move up"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground h-7 w-7"
              disabled={isLast}
              onClick={onMoveDown}
              title="Move down"
            >
              <ArrowDown className="size-3.5" />
            </Button>

            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive h-7 w-7"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded assertion results */}
      {showAssertions && (
        <div className="space-y-2 border-t px-3 pt-2 pb-3">
          {/* Per-assertion rows */}
          <div className="space-y-1">
            {testCase.assertions.map((assertion, idx) => {
              const ar: AssertionResult | undefined = caseResult?.assertionResults[idx];
              return (
                <div key={idx} className="flex items-start gap-2 font-mono text-xs">
                  {ar ? (
                    ar.passed ? (
                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="text-destructive mt-0.5 size-3 shrink-0" />
                    )
                  ) : (
                    <Circle className="text-muted-foreground/50 mt-0.5 size-3 shrink-0" />
                  )}
                  <span className="text-muted-foreground">{ar?.label ?? assertion.type}</span>
                  {ar && !ar.passed && (
                    <span className="text-destructive ml-1">
                      ({t("suites.assertion_actual", { actual: ar.actual })})
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Response body — shown when the case failed so the user can see
              exactly what the API returned (e.g. a 400 validation error). */}
          {caseResult && !caseResult.passed && caseResult.responseBody && (
            <div className="space-y-1 pt-1">
              <p className="text-muted-foreground text-xs font-medium">
                {t("suites.response_body_label")}
              </p>
              <pre className="bg-muted/60 text-foreground max-h-48 overflow-x-auto rounded-md p-2 font-mono text-xs break-all whitespace-pre-wrap">
                {caseResult.responseBody}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────── SuiteForm ───────

type SuiteFormMode = "create" | "edit";

type SuiteFormProps = {
  mode: SuiteFormMode;
  initial?: { name: string; description: string };
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
};

function SuiteForm({ mode, initial, onSave, onCancel }: SuiteFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
  };

  return (
    <Card className={mode === "create" ? "border-dashed" : "border-primary/30"}>
      <CardContent className="pt-4 pb-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("suites.suite_name_label")}</Label>
            <Input
              placeholder={t("suites.suite_name_placeholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("suites.suite_desc_label")}</Label>
            <Input
              placeholder={t("suites.suite_desc_placeholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {t("suites.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              {t("suites.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────── RunSummary ──────

function RunSummary({ result }: { result: SuiteRunResult }) {
  const { t } = useTranslation();
  const durationSec = ((result.finishedAt - result.startedAt) / 1000).toFixed(1);
  const allPassed = result.failed === 0;

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {allPassed ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <XCircle className="text-destructive size-4" />
          )}
          {t("suites.run_results_title")}
        </h3>
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Clock className="size-3" />
          {durationSec}s
        </div>
      </div>

      <div className="flex gap-4 text-sm">
        <span className="font-medium text-emerald-600">
          {t("suites.passed_label")}: {result.passed}
        </span>
        {result.failed > 0 && (
          <span className="text-destructive font-medium">
            {t("suites.failed_label")}: {result.failed}
          </span>
        )}
        <span className="text-muted-foreground">
          {t("suites.total_label")}: {result.total}
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────── SuiteDetail ────

type EditingCase = { type: "new" } | { type: "edit"; caseId: string };

type RunProgressEntry = {
  caseId: string;
  status: LiveStatus;
  result?: CaseResult;
};

type SuiteDetailProps = {
  suite: Suite;
};

function SuiteDetail({ suite }: SuiteDetailProps) {
  const { t } = useTranslation();
  const {
    updateSuite,
    deleteSuite,
    addCase,
    updateCase,
    deleteCase,
    setRunResult,
    clearRunResult,
    reorderCase,
    addRunHistory,
  } = useSuiteStore();

  const [editingSuite, setEditingSuite] = useState(false);
  const [deletingConfirm, setDeletingConfirm] = useState(false);
  const [editingCase, setEditingCase] = useState<EditingCase | null>(null);

  // ── Runner state ──
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<RunProgressEntry[]>([]);
  const runResult = useSuiteStore((s) => s.runResults[suite.id]);

  // Keep a ref so the async loop can read the latest progress without
  // needing it in the dependency array.
  const progressRef = useRef<RunProgressEntry[]>([]);

  // ── Case form handlers ──
  const handleSaveNewCase = (draft: DraftCase) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(draft.bodyText) as Record<string, unknown>;
    } catch {
      /* skip */
    }
    const timeoutMs = draft.timeoutMs ? parseInt(draft.timeoutMs, 10) : undefined;
    const tc: TestCase = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      endpoint: draft.endpoint,
      body,
      assertions: draft.assertions.map(draftToAssertion).filter((a): a is Assertion => a !== null),
      timeoutMs: timeoutMs && !isNaN(timeoutMs) ? timeoutMs : undefined,
    };
    addCase(suite.id, tc);
    setEditingCase(null);
  };

  const handleSaveEditCase = (caseId: string, draft: DraftCase) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(draft.bodyText) as Record<string, unknown>;
    } catch {
      /* skip */
    }
    const timeoutMs = draft.timeoutMs ? parseInt(draft.timeoutMs, 10) : undefined;
    updateCase(suite.id, caseId, {
      name: draft.name.trim(),
      endpoint: draft.endpoint,
      body,
      assertions: draft.assertions.map(draftToAssertion).filter((a): a is Assertion => a !== null),
      timeoutMs: timeoutMs && !isNaN(timeoutMs) ? timeoutMs : undefined,
    });
    setEditingCase(null);
  };

  // ── Suite runner ──
  const runSuite = useCallback(async () => {
    if (running || suite.cases.length === 0) return;

    const startedAt = Date.now();
    setRunning(true);

    const initial: RunProgressEntry[] = suite.cases.map((c) => ({
      caseId: c.id,
      status: "pending",
    }));
    progressRef.current = initial;
    setRunProgress([...initial]);

    const allResults: CaseResult[] = [];

    for (let i = 0; i < suite.cases.length; i++) {
      const tc = suite.cases[i];

      // Mark this case as running
      const withRunning = progressRef.current.map((p, j) =>
        j === i ? { ...p, status: "running" as LiveStatus } : p
      );
      progressRef.current = withRunning;
      setRunProgress([...withRunning]);

      let caseResult: CaseResult;

      try {
        const response = await commands.request.send({
          params: {
            endpoint: tc.endpoint,
            body: tc.body,
            ...(tc.timeoutMs ? { timeoutMs: tc.timeoutMs } : {}),
          },
        });

        const assertionResults = evaluateAssertions(tc.assertions, response);
        const passed =
          assertionResults.length === 0
            ? response.status >= 200 && response.status < 300
            : assertionResults.every((r) => r.passed);

        caseResult = {
          caseId: tc.id,
          caseName: tc.name,
          passed,
          status: response.status,
          durationMs: response.durationMs,
          assertionResults,
          // Always capture the body so the user can inspect it on failure.
          responseBody: response.body,
        };

        // Log to local request log (Monitoring page)
        logRequest({
          endpoint: tc.endpoint,
          requestBody: tc.body,
          result: response,
          source: "suite",
          sourceName: suite.name,
        });
      } catch (err: unknown) {
        const errMsg = getErrorMessage(err);
        caseResult = {
          caseId: tc.id,
          caseName: tc.name,
          passed: false,
          status: 0,
          durationMs: 0,
          assertionResults: [],
          error: errMsg,
        };
        logFailedRequest({
          endpoint: tc.endpoint,
          requestBody: tc.body,
          error: errMsg,
          source: "suite",
          sourceName: suite.name,
        });
      }

      allResults.push(caseResult);

      const status: LiveStatus =
        !caseResult.passed && caseResult.error ? "error" : caseResult.passed ? "passed" : "failed";

      const withResult = progressRef.current.map((p, j) =>
        j === i ? { ...p, status, result: caseResult } : p
      );
      progressRef.current = withResult;
      setRunProgress([...withResult]);
    }

    const runResult: SuiteRunResult = {
      suiteId: suite.id,
      suiteName: suite.name,
      startedAt,
      finishedAt: Date.now(),
      passed: allResults.filter((r) => r.passed).length,
      failed: allResults.filter((r) => !r.passed).length,
      total: allResults.length,
      caseResults: allResults,
    };

    setRunResult(suite.id, runResult);
    addRunHistory(runResult);
    setRunning(false);
  }, [running, suite, setRunResult, addRunHistory]);

  // ── Resolve per-case live status and result ──
  const getLiveStatus = (caseId: string): LiveStatus | undefined => {
    if (!running && runProgress.length === 0) return undefined;
    return runProgress.find((p) => p.caseId === caseId)?.status ?? "pending";
  };

  const getLiveResult = (caseId: string): CaseResult | undefined => {
    if (runProgress.length === 0 && runResult) {
      return runResult.caseResults.find((r) => r.caseId === caseId);
    }
    return runProgress.find((p) => p.caseId === caseId)?.result;
  };

  // ── Render ──

  if (editingSuite) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <SuiteForm
          mode="edit"
          initial={{ name: suite.name, description: suite.description }}
          onSave={(name, description) => {
            updateSuite(suite.id, { name, description });
            setEditingSuite(false);
          }}
          onCancel={() => setEditingSuite(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Suite header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{suite.name}</h2>
          {suite.description && (
            <p className="text-muted-foreground text-sm">{suite.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Edit / Delete */}
          {!running && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setEditingSuite(true)}
              >
                <Pencil className="size-3.5" />
                {t("suites.edit_suite")}
              </Button>

              {deletingConfirm ? (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">
                    {t("suites.delete_confirm", { name: suite.name })}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7"
                    onClick={() => deleteSuite(suite.id)}
                  >
                    {t("suites.delete")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => setDeletingConfirm(false)}
                  >
                    {t("suites.cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-8 gap-1"
                  onClick={() => setDeletingConfirm(true)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </>
          )}

          {/* Clear results button — only when there are results and not running */}
          {!running && (runResult || runProgress.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-8 gap-1"
              onClick={() => {
                clearRunResult(suite.id);
                setRunProgress([]);
                progressRef.current = [];
              }}
            >
              <RotateCcw className="size-3.5" />
              {t("suites.clear_results")}
            </Button>
          )}

          {/* Run button */}
          <Button
            size="sm"
            className="h-8 gap-1"
            disabled={running || suite.cases.length === 0}
            onClick={() => void runSuite()}
          >
            {running ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("suites.running")}
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                {runResult ? t("suites.run_again") : t("suites.run_suite")}
              </>
            )}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Run summary (shows after a run, cleared when a new run starts) */}
      {!running && runResult && runProgress.length === 0 && <RunSummary result={runResult} />}
      {!running && runProgress.length > 0 && runResult && <RunSummary result={runResult} />}

      {/* Cases list */}
      <div className="space-y-2">
        {suite.cases.length === 0 && editingCase === null && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <FlaskConical className="text-muted-foreground size-6" />
            <p className="text-sm font-medium">{t("suites.no_cases_title")}</p>
            <p className="text-muted-foreground text-xs">{t("suites.no_cases_desc")}</p>
          </div>
        )}

        {suite.cases.map((tc, idx) => {
          const isEditing = editingCase?.type === "edit" && editingCase.caseId === tc.id;

          if (isEditing) {
            return (
              <CaseForm
                key={tc.id}
                title={t("suites.edit_case")}
                initial={caseToDraft(tc)}
                onSave={(draft) => handleSaveEditCase(tc.id, draft)}
                onCancel={() => setEditingCase(null)}
              />
            );
          }

          return (
            <CaseCard
              key={tc.id}
              testCase={tc}
              suiteId={suite.id}
              running={running}
              isFirst={idx === 0}
              isLast={idx === suite.cases.length - 1}
              liveStatus={getLiveStatus(tc.id)}
              caseResult={getLiveResult(tc.id)}
              onEdit={() => setEditingCase({ type: "edit", caseId: tc.id })}
              onDelete={() => deleteCase(suite.id, tc.id)}
              onMoveUp={() => reorderCase(suite.id, tc.id, "up")}
              onMoveDown={() => reorderCase(suite.id, tc.id, "down")}
            />
          );
        })}

        {/* New case form */}
        {editingCase?.type === "new" && (
          <CaseForm
            title={t("suites.new_case")}
            initial={defaultDraftCase()}
            onSave={handleSaveNewCase}
            onCancel={() => setEditingCase(null)}
          />
        )}
      </div>

      {/* Add case button */}
      {editingCase === null && !running && (
        <Button
          variant="outline"
          className="gap-2 border-dashed"
          onClick={() => setEditingCase({ type: "new" })}
        >
          <Plus className="size-4" />
          {t("suites.add_case")}
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────── SuiteList panel ─

function SuiteListPanel({
  suites,
  selectedId,
  onSelect,
  onNew,
  creatingNew,
  onNewSave,
  onNewCancel,
}: {
  suites: Suite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  creatingNew: boolean;
  onNewSave: (name: string, desc: string) => void;
  onNewCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">{t("suites.title")}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={onNew}
          disabled={creatingNew}
        >
          <Plus className="size-3" />
          {t("suites.new_suite")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {/* New suite inline form */}
          {creatingNew && (
            <div className="p-1">
              <SuiteForm mode="create" onSave={onNewSave} onCancel={onNewCancel} />
            </div>
          )}

          {suites.length === 0 && !creatingNew && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground text-xs">{t("suites.no_suites_title")}</p>
            </div>
          )}

          {suites.map((suite) => {
            const n = suite.cases.length;
            const isSelected = suite.id === selectedId;
            return (
              <button
                key={suite.id}
                type="button"
                onClick={() => onSelect(suite.id)}
                className={cn(
                  "hover:bg-muted w-full rounded-md px-3 py-2 text-left transition-colors",
                  isSelected && "bg-muted"
                )}
              >
                <p className="truncate text-sm font-medium">{suite.name}</p>
                <p className="text-muted-foreground text-xs">
                  {t("suites.cases_count_other", { count: n })}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────── Page ────────────

export function SuitesPage() {
  const { t } = useTranslation();
  const { suites, selectedSuiteId, createSuite, selectSuite } = useSuiteStore();
  const [creatingNew, setCreatingNew] = useState(false);

  const selectedSuite = suites.find((s) => s.id === selectedSuiteId) ?? null;

  const handleNewSave = (name: string, description: string) => {
    createSuite(name, description);
    setCreatingNew(false);
  };

  return (
    /* Shell strips px-6 pt-1 pb-6 for /suites (FULL_BLEED_ROUTES), so this div
       naturally fills the entire <main> viewport edge-to-edge. */
    <div className="flex h-full">
      {/* Left: suite list */}
      <div className="w-72 shrink-0">
        <SuiteListPanel
          suites={suites}
          selectedId={selectedSuiteId}
          onSelect={selectSuite}
          onNew={() => setCreatingNew(true)}
          creatingNew={creatingNew}
          onNewSave={handleNewSave}
          onNewCancel={() => setCreatingNew(false)}
        />
      </div>

      {/* Right: suite detail */}
      <div className="min-w-0 flex-1">
        <div className="h-full overflow-y-auto">
          {selectedSuite ? (
            <SuiteDetail key={selectedSuite.id} suite={selectedSuite} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="bg-muted rounded-full p-4">
                <FlaskConical className="text-muted-foreground size-8" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">{t("suites.select_suite_title")}</p>
                <p className="text-muted-foreground max-w-xs text-sm">
                  {t("suites.no_suites_desc")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
