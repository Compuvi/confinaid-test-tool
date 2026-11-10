/**
 * Building blocks shared by the Filtering page tabs: error and scope hints,
 * pagination, labelled fields, a searchable multi-select list and a confirm
 * dialog. App-specific, so they live here rather than in `components/ui/`.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFreshToken } from "@/lib/api/hooks/use-filtering";
import { useTokenStatus } from "@/lib/api/hooks/use-request";
import { pageRange, totalPages } from "@/lib/filtering/client";
import { describeError, isFilteringApiError, isScopeError } from "@/lib/filtering/errors";
import { cn } from "@/lib/utils";

import type { Truncation } from "./use-catalog-options";

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Explains the 403 `forbidden` case: missing filtering scopes (or licence). */
export function ScopeHint({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: token } = useTokenStatus();
  const fresh = useFreshToken();
  const scopes = token?.scope?.trim();
  return (
    <div
      className={cn(
        "border-warning/40 bg-warning/10 flex gap-3 rounded-md border p-4 text-sm",
        className
      )}
      role="alert"
    >
      <ShieldAlert className="text-warning mt-0.5 size-5 shrink-0" />
      <div className="space-y-1.5">
        <p className="font-medium">{t("filtering.scope.title")}</p>
        <p className="text-muted-foreground">{t("filtering.scope.body")}</p>
        <p className="text-muted-foreground">{t("filtering.scope.token_note")}</p>
        {scopes && (
          <p className="text-muted-foreground text-xs">
            {t("filtering.scope.current_scopes")} <span className="font-mono">{scopes}</span>
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-1 gap-1.5"
          disabled={fresh.isPending}
          onClick={() =>
            fresh.mutate(undefined, {
              onSuccess: () => toast.success(t("filtering.scope.fresh_token_done")),
              onError: (err) => toast.error(err.message),
            })
          }
        >
          {fresh.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          {t("filtering.scope.fresh_token")}
        </Button>
      </div>
    </div>
  );
}

/** Inline error panel for a failed query, with the scope hint when relevant. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (isScopeError(error)) return <ScopeHint />;
  const lines = describeError(error);
  const requestId = isFilteringApiError(error) ? error.requestId : null;
  return (
    <div
      className="border-destructive/40 bg-destructive/5 flex gap-3 rounded-md border p-4 text-sm"
      role="alert"
    >
      <AlertCircle className="text-destructive mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{t("filtering.errors.load_failed")}</p>
        {lines.map((line, i) => (
          <p key={i} className="text-muted-foreground break-words">
            {line}
          </p>
        ))}
        {requestId && (
          <p className="text-muted-foreground font-mono text-xs">
            {t("filtering.errors.request_id", { id: requestId })}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onRetry}>
          <RotateCcw className="size-3.5" />
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/** Says a list was cut off by the page cap of `fetchAllPages`. */
export function TruncatedNotice({ truncated }: { truncated: Truncation }) {
  const { t } = useTranslation();
  if (!truncated) return null;
  return (
    <p className="text-warning flex items-center gap-1.5 text-xs" role="status">
      <AlertCircle className="size-3.5 shrink-0" />
      {t("filtering.common.truncated", truncated)}
    </p>
  );
}

/** Messages under a field. */
export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {messages.map((m, i) => (
        <p key={i} className="text-destructive text-xs">
          {m}
        </p>
      ))}
    </div>
  );
}

/** General (non-field) messages at the top of a form. */
export function FormAlert({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="border-destructive/40 bg-destructive/5 text-destructive space-y-0.5 rounded-md border px-3 py-2 text-xs">
      {messages.map((m, i) => (
        <p key={i}>{m}</p>
      ))}
    </div>
  );
}

// ─── Fields ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  htmlFor,
  hint,
  errors,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      <FieldError messages={errors} />
    </div>
  );
}

export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  errors,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  errors?: string[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
        <div className="space-y-0.5">
          <Label htmlFor={id} className="text-sm">
            {label}
          </Label>
          {description && <p className="text-muted-foreground text-xs">{description}</p>}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
      <FieldError messages={errors} />
    </div>
  );
}

export type Option = { value: string; label: string; hint?: string };

/** Sentinel for "no value" in Radix Select, which rejects empty strings. */
export const NONE = "__none__";

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  allowNone,
  noneLabel,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value === "" ? (allowNone ? NONE : undefined) : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel ?? "—"}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Searchable checklist for id arrays (languages, attachments, keywords,
 * labels). Unknown selected ids — e.g. an entry outside the loaded catalog
 * page — are kept and shown by id so saving never drops them silently.
 */
export function MultiSelectList({
  options,
  value,
  onChange,
  loading,
  emptyText,
  truncated = null,
  className,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
  emptyText?: string;
  /** Shown under the list when the options are incomplete. */
  truncated?: Truncation;
  className?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const known = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)
    );
  }, [options, query]);

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className={cn("rounded-md border", className)}>
      <div className="flex items-center gap-2 border-b px-2">
        <Search className="text-muted-foreground size-3.5 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filtering.common.filter_options")}
          className="placeholder:text-muted-foreground h-8 w-full bg-transparent text-sm outline-none"
        />
        <span className="text-muted-foreground shrink-0 text-xs">
          {t("filtering.common.selected_count", { count: value.length })}
        </span>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b p-2">
          {value.map((id) => (
            <Badge
              key={id}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggle(id)}
              title={t("filtering.common.click_to_remove")}
            >
              {known.get(id)?.label ?? <span className="font-mono">{id.slice(0, 8)}…</span>}
              <span aria-hidden>×</span>
            </Badge>
          ))}
        </div>
      )}
      <div className="max-h-44 overflow-y-auto p-1">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            {t("common.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground p-2 text-xs">
            {emptyText ?? t("filtering.common.no_options")}
          </p>
        ) : (
          filtered.map((o) => {
            const isOn = selected.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  isOn && "bg-muted/60"
                )}
                aria-pressed={isOn}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    isOn && "bg-primary border-primary text-primary-foreground"
                  )}
                >
                  {isOn && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && (
                  <span className="text-muted-foreground shrink-0 truncate text-xs">{o.hint}</span>
                )}
              </button>
            );
          })
        )}
      </div>
      {truncated && (
        <div className="border-t px-2 py-1.5">
          <TruncatedNotice truncated={truncated} />
        </div>
      )}
    </div>
  );
}

// ─── Lists ────────────────────────────────────────────────────────────────────

/** Search box that reports its value after the user pauses typing. */
export function SearchInput({
  onSearch,
  placeholder,
  className,
}: {
  onSearch: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(id);
  }, [value, onSearch]);
  return (
    <div className={cn("relative", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-sm"
      />
    </div>
  );
}

export function PaginationBar({
  page,
  pageSize,
  count,
  onPageChange,
  busy,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPageChange: (p: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const pages = totalPages(count, pageSize);
  const { from, to } = pageRange(page, pageSize, count);
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
      <span>
        {t("filtering.common.range", { from, to, count })}
        {busy && <Loader2 className="ml-2 inline size-3 animate-spin" />}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("filtering.common.prev_page")}
        >
          <ChevronLeft />
        </Button>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon-xs"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("filtering.common.next_page")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn(active ? "border-success/40 text-success" : "text-muted-foreground")}
    >
      {active ? t("filtering.common.active") : t("filtering.common.inactive")}
    </Badge>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  confirmDisabled,
  destructive = true,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className="gap-1.5"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
