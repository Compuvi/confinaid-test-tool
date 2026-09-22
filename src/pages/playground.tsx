/**
 * Playground page — one-on-one port of the frontend's Analysis playground.
 *
 * Adaptations:
 *   - WebSocket → simple HTTP POST via Rust IPC (no streaming)
 *   - No motion/react → plain CSS transitions
 *   - No profile selector (not applicable)
 *   - No token meter / tokenizer (out of scope)
 *   - No history tab (Phase 6)
 *   - i18n via react-i18next (same 5 languages as the rest of the app)
 *   - analysis_id auto-stored in request-store for use on the Requests page
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Braces,
  ChevronRight,
  Coins,
  Copy,
  Check,
  KeyRound,
  Layers,
  Loader2,
  Palette,
  RotateCcw,
  ScanSearch,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wand2,
  Zap,
} from "lucide-react";
import { useStreamingText } from "@/hooks/use-streaming-text";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/copy-button";
import { commands } from "@/lib/api/tauri-client";
import { getErrorMessage } from "@/lib/api/errors";
import { useRequestStore } from "@/stores/request-store";
import { logRequest, logFailedRequest } from "@/lib/api/request-logger";
import { cn } from "@/lib/utils";
import {
  buildSegments,
  getFindingStyle,
  getLineRange,
  isKeywordFinding,
  resolveFindings,
  taxonomyLabels,
  toComplianceFindings,
  type ComplianceFinding,
  type ResolvedFinding,
} from "@/lib/findings";

// ─── API response types ────────────────────────────────────────────────────────

interface AnalyzeResponse {
  analysis_id: string;
  status: RiskStatus;
  risk_score: number;
  processing_time?: number;
  entities_detected?: string[];
  findings?: ComplianceFinding[];
  can_bypass?: boolean;
}

type RiskStatus = "unknown" | "analyzing" | "safe" | "risky" | "hitl";

const MAX_CHARS = 5000;

// ─── Tokenizer utilities (client-side, no web worker) ─────────────────────────
// The desktop app uses a real BPE tokenizer in a web worker. The test tool uses
// a ~4-chars-per-token approximation — fast, dependency-free, and accurate enough
// for the cost estimate and the colour overlay.

const TOKENIZER_LABEL = "Confinaid Tokenizer";
const INPUT_RATE_PER_1M_USD = 0.5; // $0.50 per 1,000,000 input tokens

const TOKEN_COLORS = [
  "bg-sky-500/25 dark:bg-sky-400/30",
  "bg-emerald-500/25 dark:bg-emerald-400/30",
  "bg-violet-500/25 dark:bg-violet-400/30",
  "bg-amber-500/25 dark:bg-amber-400/30",
  "bg-rose-500/25 dark:bg-rose-400/30",
  "bg-cyan-500/25 dark:bg-cyan-400/30",
];

function countCharacters(t: string) {
  return t.length;
}
function countWords(t: string) {
  const s = t.trim();
  return s ? s.split(/\s+/).length : 0;
}
function approximateTokens(t: string) {
  return t ? Math.ceil(t.length / 4) : 0;
}
function estimateInputCost(tokens: number) {
  return (tokens / 1_000_000) * INPUT_RATE_PER_1M_USD;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
function formatUsd(amount: number): string {
  if (amount === 0) return USD.format(0);
  if (amount < 0.000001) return "<$0.000001";
  if (amount < 0.01) return USD_PRECISE.format(amount);
  return USD.format(amount);
}

/**
 * Split text into approximate token spans (~4 chars each) with cycling colours.
 * Mirrors `toTokenSpans` from the desktop — without a real BPE rank table the
 * boundaries are uniform, but the visual effect is identical.
 */
function toApproxTokenSpans(text: string): { text: string; color: string }[] {
  const CHARS_PER_TOKEN = 4;
  const out: { text: string; color: string }[] = [];
  let i = 0;
  let tokenIdx = 0;
  while (i < text.length) {
    const end = Math.min(i + CHARS_PER_TOKEN, text.length);
    out.push({ text: text.slice(i, end), color: TOKEN_COLORS[tokenIdx % TOKEN_COLORS.length] });
    i = end;
    tokenIdx++;
  }
  return out;
}

// ─── TokenOverlay ─────────────────────────────────────────────────────────────

function TokenOverlay({ text }: { text: string }) {
  const spans = useMemo(() => toApproxTokenSpans(text), [text]);
  return (
    // z-[1] keeps it below the textarea (z-auto > z-[1] in stacking order when textarea
    // has no explicit z-index but comes later in DOM). The overlay renders duplicate text
    // as `text-transparent` so only the coloured span backgrounds are visible; the real
    // textarea text shows on top in its normal colour.
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-[1] overflow-hidden select-none",
        "break-words whitespace-pre-wrap text-transparent",
        EDITOR_FONT,
        "p-3"
      )}
    >
      {spans.map((span, i) => (
        <span key={i} className={cn("rounded-[2px]", span.color)}>
          {span.text}
        </span>
      ))}
      {"\n"}
    </div>
  );
}

// ─── TokenMeter ───────────────────────────────────────────────────────────────

function StatChip({
  value,
  label,
  highlight,
}: {
  value: string | number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span
        className={cn(
          "text-xs font-semibold tabular-nums",
          highlight ? "text-primary dark:text-[#00DEF7]" : "text-foreground"
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-muted-foreground text-[10px] font-medium">{label}</span>
    </span>
  );
}

function MeterRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="opacity-70">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function TokenMeter({
  text,
  isHighlighting,
  onToggleHighlight,
}: {
  text: string;
  isHighlighting: boolean;
  onToggleHighlight: () => void;
}) {
  const chars = countCharacters(text);
  const words = countWords(text);
  const tokens = approximateTokens(text);
  const cost = estimateInputCost(tokens);
  const isEmpty = chars === 0;

  return (
    <div className="hidden min-w-0 shrink items-center gap-2 sm:flex">
      {/* Colour-tokens toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-pressed={isHighlighting}
              disabled={isEmpty}
              onClick={onToggleHighlight}
              className={cn(
                "h-8 w-8 transition-colors",
                isHighlighting &&
                  "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 dark:text-[#00DEF7]"
              )}
            >
              <Palette className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{isHighlighting ? "Hide token colours" : "Colour each token"}</p>
        </TooltipContent>
      </Tooltip>

      {/* Stats pill */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "border-border flex h-8 min-w-0 shrink cursor-default items-center gap-2.5 rounded-lg border select-none",
              "bg-muted/50 px-3 transition-opacity duration-300",
              isEmpty && "opacity-60"
            )}
          >
            <StatChip value={`~${tokens.toLocaleString()}`} label="tokens" highlight />
            <span className="bg-border h-4 w-px" />
            <span className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
              <Coins className="text-muted-foreground h-3.5 w-3.5" />
              {formatUsd(cost)}
            </span>
          </div>
        </TooltipTrigger>

        <TooltipContent side="top" align="end" className="max-w-[280px]">
          <div className="space-y-1.5">
            <p className="text-[11px] leading-snug font-semibold">Input Usage</p>
            <dl className="space-y-0.5 text-[10px]">
              <MeterRow label="chars" value={chars.toLocaleString()} />
              <MeterRow label="words" value={words.toLocaleString()} />
              <MeterRow label="tokens" value={`~${tokens.toLocaleString()}`} />
              <div className="!my-1 h-px bg-current opacity-15" />
              <MeterRow label="Tokenizer" value={TOKENIZER_LABEL} />
              <MeterRow
                label="Unit price"
                value={`$${INPUT_RATE_PER_1M_USD.toFixed(2)} / 1M tokens`}
              />
              <MeterRow label="Estimated cost" value={formatUsd(cost)} />
            </dl>
            <p className="text-[10px] leading-snug opacity-70">
              Token counts use a ~4 chars/token approximation. The cost is an estimate for the input
              text only; the billed amount may differ based on the analysis output.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Risk status config (mirrors frontend) ────────────────────────────────────

/** Safe accessor — never throws even if `status` is undefined/unexpected. */
function getStatusCfg(status: RiskStatus | undefined | null) {
  return STATUS_CONFIG[status as RiskStatus] ?? STATUS_CONFIG.unknown;
}

// Labels and descriptions are now resolved via t() at render time; only the
// visual/style tokens live here so the object stays outside the component.
const STATUS_CONFIG = {
  safe: {
    icon: ShieldCheck,
    labelKey: "playground.risk_safe",
    descKey: "playground.risk_safe_desc",
    iconGradient: "from-green-500 to-emerald-600",
    labelClass: "text-green-700 dark:text-green-400",
    badgeClass: "bg-green-500/15 text-green-600 dark:text-green-400",
    progressGradient: "from-green-500 to-emerald-400",
    borderClass: "border-emerald-200/50 dark:border-emerald-800/50",
    bgClass: "bg-emerald-50/30 dark:bg-emerald-950/20",
    dotClass: "bg-emerald-500",
    badgeTextClass:
      "text-emerald-600 dark:text-emerald-400 border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-950/30",
  },
  risky: {
    icon: ShieldX,
    labelKey: "playground.risk_risky",
    descKey: "playground.risk_risky_desc",
    iconGradient: "from-red-500 to-rose-600",
    labelClass: "text-red-700 dark:text-red-400",
    badgeClass: "bg-red-500/15 text-red-600 dark:text-red-400",
    progressGradient: "from-red-500 to-orange-400",
    borderClass: "border-red-200/50 dark:border-red-800/50",
    bgClass: "bg-red-50/30 dark:bg-red-950/20",
    dotClass: "bg-red-500",
    badgeTextClass:
      "text-red-600 dark:text-red-400 border-red-300/50 bg-red-50/50 dark:bg-red-950/30",
  },
  hitl: {
    icon: ShieldAlert,
    labelKey: "playground.risk_hitl",
    descKey: "playground.risk_hitl_desc",
    iconGradient: "from-slate-500 to-slate-600",
    labelClass: "text-slate-700 dark:text-slate-300",
    badgeClass: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
    progressGradient: "from-slate-500 to-slate-400",
    borderClass: "border-slate-200/50 dark:border-slate-700/50",
    bgClass: "bg-slate-50/30 dark:bg-slate-900/20",
    dotClass: "bg-slate-500",
    badgeTextClass:
      "text-slate-600 dark:text-slate-300 border-slate-300/50 bg-slate-50/50 dark:bg-slate-900/30",
  },
  analyzing: {
    icon: Loader2,
    labelKey: "playground.risk_analyzing",
    descKey: "playground.risk_analyzing_desc",
    iconGradient: "from-blue-500 to-blue-600",
    labelClass: "text-blue-700 dark:text-blue-400",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    progressGradient: "from-blue-500 to-cyan-400",
    borderClass: "border-blue-200/50 dark:border-blue-800/50",
    bgClass: "bg-blue-50/30 dark:bg-blue-950/20",
    dotClass: "bg-blue-500 animate-pulse",
    badgeTextClass:
      "text-blue-600 dark:text-blue-400 border-blue-300/50 bg-blue-50/50 dark:bg-blue-950/30",
  },
  unknown: {
    icon: Shield,
    labelKey: "playground.risk_unknown",
    descKey: "playground.risk_unknown_desc",
    iconGradient: "from-[#0061FF] to-[#00284D]",
    labelClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    progressGradient: "from-[#0061FF] to-[#00DEF7]",
    borderClass: "border-border",
    bgClass: "bg-muted/20",
    dotClass: "bg-muted-foreground",
    badgeTextClass: "text-muted-foreground border-border",
  },
} as const;

// ─── RiskStatusCard ───────────────────────────────────────────────────────────

function RiskStatusCard({
  status,
  result,
  t,
}: {
  status: RiskStatus;
  result: AnalyzeResponse | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const cfg = getStatusCfg(status);
  const Icon = cfg.icon;
  const riskScore = result?.risk_score != null ? Math.round(result.risk_score * 100) : null;
  const showScore = riskScore !== null && status !== "analyzing";
  const displayValue = riskScore ?? 0;

  return (
    <div className={cn("space-y-3 rounded-lg border p-4", cfg.borderClass, cfg.bgClass)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm",
            cfg.iconGradient
          )}
        >
          <Icon className={cn("h-5 w-5 text-white", status === "analyzing" && "animate-spin")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-semibold", cfg.labelClass)}>{t(cfg.labelKey)}</span>
            {showScore && (
              <span
                className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cfg.badgeClass)}
              >
                {t("playground.risk_score", { score: displayValue })}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{t(cfg.descKey)}</p>
        </div>
        {result?.processing_time && status !== "analyzing" && (
          <span className="text-muted-foreground/50 shrink-0 font-mono text-[11px] tabular-nums">
            {result.processing_time.toFixed(2)}s
          </span>
        )}
      </div>

      {showScore && (
        <div className="space-y-1.5">
          <div className="bg-muted/50 h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                cfg.progressGradient
              )}
              style={{ width: `${displayValue}%` }}
            />
          </div>
          {result?.entities_detected && result.entities_detected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.entities_detected.map((entity, i) => (
                <span
                  key={`${entity}-${i}`}
                  className="bg-muted/60 text-muted-foreground border-border/40 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                >
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FindingsList ─────────────────────────────────────────────────────────────

function FindingsList({
  text,
  findings,
  activeIndex,
  onHover,
  onSelect,
  t,
}: {
  text: string;
  findings: ResolvedFinding[];
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-2">
      {findings.map((resolved, position) => {
        const style = getFindingStyle(resolved.finding);
        const isActive = activeIndex === resolved.index;
        const isKeyword = isKeywordFinding(resolved.finding);
        const labels = taxonomyLabels(resolved.finding);
        const { startLine, endLine } = getLineRange(text, resolved.start, resolved.end);
        const lineLabel =
          startLine === endLine
            ? t("playground.line_singular", { line: startLine })
            : t("playground.line_range", { start: startLine, end: endLine });

        return (
          <button
            key={resolved.index}
            type="button"
            onClick={() => onSelect(resolved.index)}
            onMouseEnter={() => onHover(resolved.index)}
            onMouseLeave={() => onHover(null)}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              isActive
                ? cn("border-transparent", style.rowActive)
                : "border-border/50 bg-muted/10 hover:bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} />
              {isKeyword ? (
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                    {t("playground.keyword_violation")}
                  </span>
                  <span className="text-muted-foreground/50 text-[11px]">·</span>
                  <span className="text-muted-foreground shrink-0 text-[11px] font-medium">
                    {lineLabel}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground text-[11px] font-medium">{lineLabel}</span>
              )}
              <span className="text-muted-foreground/40 ml-auto font-mono text-[10px] tabular-nums">
                {position + 1}/{findings.length}
              </span>
            </div>

            {isKeyword ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                    style.badge
                  )}
                >
                  <KeyRound className="h-3 w-3 shrink-0" />
                  {resolved.finding.keyword}
                </span>
                {resolved.finding.match_type && (
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                      style.badge
                    )}
                  >
                    {resolved.finding.match_type}
                  </span>
                )}
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {labels.length > 0 ? (
                  labels.map((label, idx) => (
                    <span key={label} className="flex items-center gap-1">
                      {idx > 0 && (
                        <ChevronRight className="text-muted-foreground/30 h-3 w-3 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                          style.badge
                        )}
                      >
                        {label}
                      </span>
                    </span>
                  ))
                ) : resolved.finding.label_id ? (
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                      style.badge
                    )}
                  >
                    {resolved.finding.label_id}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                      style.badge
                    )}
                  >
                    {t("playground.unlabeled")}
                  </span>
                )}
              </div>
            )}

            {resolved.quote && (
              <p className="text-muted-foreground/80 mt-1.5 line-clamp-2 font-mono text-[11px]">
                &ldquo;{resolved.quote}&rdquo;
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── MessageBlock ─────────────────────────────────────────────────────────────

function MessageBlock({
  icon: Icon,
  iconColor,
  label,
  badge,
  children,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="group animate-in fade-in-0 slide-in-from-bottom-4 relative duration-300">
      <div className="mb-2 flex items-center gap-2">
        <div className={cn("flex h-5 w-5 items-center justify-center rounded-md", iconColor)}>
          <Icon className="h-3 w-3 text-white" />
        </div>
        <span className="text-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
          {label}
        </span>
        {badge}
        {actions && (
          <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>
      <div className="ml-7">{children}</div>
    </div>
  );
}

// ─── Highlight overlay ────────────────────────────────────────────────────────

/** Classic overlay trick: div behind textarea with same font/padding, textarea text is transparent. */
const EDITOR_FONT = "text-sm leading-[1.625rem] font-sans break-words whitespace-pre-wrap";

function HighlightOverlay({
  text,
  findings,
  activeIndex,
}: {
  text: string;
  findings: ResolvedFinding[];
  activeIndex: number | null;
}) {
  const segments = useMemo(() => buildSegments(text, findings), [text, findings]);

  return (
    /**
     * Classic mirror trick:
     *   - Overlay (this div): same font/padding as the textarea, text-foreground so
     *     plain characters are visible, colored <mark> spans for findings.
     *   - Textarea (below): text-transparent so we see through to the overlay,
     *     caret-color kept so the cursor is still visible.
     * Both layers must share identical font, size, padding, line-height, and
     * word-wrap so they stay pixel-aligned.
     */
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-[2] overflow-hidden p-3",
        EDITOR_FONT,
        "text-foreground" // ← plain text is visible; marks add coloured bg on top
      )}
    >
      {segments.map((seg, i) => {
        if (!seg.finding) return <span key={i}>{seg.text}</span>;
        const style = getFindingStyle(seg.finding.finding);
        const isActive = activeIndex === seg.finding.index;
        // Use <span> not <mark> — <mark> carries a browser UA yellow background
        // that can bleed through in dark mode even with Tailwind overrides.
        return (
          <span key={i} className={cn("rounded-[3px]", isActive ? style.markActive : style.mark)}>
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}

// ─── CopyAction ───────────────────────────────────────────────────────────────

function CopyAction({ text: copyText }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access denied */
    }
  }, [copyText]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md p-1 transition-colors"
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── GraphragBlock ────────────────────────────────────────────────────────────

/**
 * Renders the GraphRAG explanation beneath the compliance engine result.
 * Uses a typewriter effect to animate the text as it would stream in — even
 * though the test tool fetches it over a single HTTP GET, the animation gives
 * the same feel as the desktop app's WebSocket-streamed version.
 */
function GraphragBlock({
  content,
  displayedText,
  isRendering,
  isLoading,
  done,
  error,
  onSkip,
}: {
  content: string;
  displayedText: string;
  isRendering: boolean;
  isLoading: boolean;
  done: boolean;
  error: string | null;
  onSkip: () => void;
}) {
  const hasContent = content.length > 0;
  const showCursor = isRendering;
  const isActive = isLoading || isRendering;

  return (
    <div className="group animate-in fade-in-0 slide-in-from-bottom-4 relative duration-300">
      {/* Block header */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-[#0061FF] to-[#00284D]">
          <Bot className="h-3 w-3 text-white" />
        </div>
        <span className="text-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
          Analysis Explanation
        </span>
        {isActive && (
          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400">
            Generating…
          </span>
        )}
        {done && hasContent && !isActive && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
            Complete
          </span>
        )}
        {/* Hover actions */}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {hasContent && !isActive && <CopyAction text={content} />}
          {isRendering && (
            <button
              type="button"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md px-2 py-0.5 text-[10px] transition-colors"
              title="Skip to end"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="ml-7">
        <div className="bg-muted/10 rounded-lg border p-4">
          {/* Loading — thinking dots */}
          {isLoading && !hasContent && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="bg-foreground/25 h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
              <span className="text-muted-foreground/50 text-[13px] italic">
                Generating explanation…
              </span>
            </div>
          )}

          {/* Error */}
          {error && !hasContent && (
            <p className="text-muted-foreground/60 text-[13px] italic">
              Could not load explanation: {error}
            </p>
          )}

          {/* Typewriter text */}
          {hasContent && (
            <div className="relative">
              <TypewriterText text={displayedText} showCursor={showCursor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TypewriterText ───────────────────────────────────────────────────────────

/**
 * Renders plain text with a blinking cursor, matching the desktop app's style.
 * Paragraphs are separated by double newlines; bold (**text**) and
 * headings (## text) are handled with inline CSS so we don't need
 * react-markdown as a dependency.
 */
function TypewriterText({ text, showCursor }: { text: string; showCursor: boolean }) {
  const lines = text.split("\n");

  return (
    <div className="text-foreground/90 text-[13px] leading-relaxed">
      {lines.map((line, i) => {
        // Heading: ## or ###
        if (/^#{1,3} /.test(line)) {
          const content = line.replace(/^#{1,3} /, "");
          return (
            <p key={i} className="text-foreground mt-3 mb-1 font-semibold">
              {renderInline(content)}
            </p>
          );
        }
        // Bullet list item
        if (/^[-*] /.test(line)) {
          return (
            <div key={i} className="my-0.5 flex gap-2">
              <span className="text-muted-foreground/50 mt-[1px] shrink-0">•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        // Numbered list
        if (/^\d+\. /.test(line)) {
          const num = line.match(/^(\d+)\. /)?.[1] ?? "1";
          const rest = line.replace(/^\d+\. /, "");
          return (
            <div key={i} className="my-0.5 flex gap-2">
              <span className="text-muted-foreground/50 mt-[1px] shrink-0 font-mono text-[11px] tabular-nums">
                {num}.
              </span>
              <span>{renderInline(rest)}</span>
            </div>
          );
        }
        // Empty line → paragraph break
        if (!line.trim()) {
          return <div key={i} className="h-2.5" />;
        }
        // Normal line
        return (
          <p key={i} className="my-0.5">
            {renderInline(line)}
          </p>
        );
      })}
      {/* Blinking cursor */}
      {showCursor && (
        <span
          className="ml-0.5 inline-block h-[14px] w-0.5 animate-pulse rounded-full bg-blue-500 align-middle"
          aria-hidden
        />
      )}
    </div>
  );
}

/** Render inline markdown: **bold**, *italic*, `code`. */
function renderInline(text: string): React.ReactNode {
  // Split on bold (**...**), italic (*...*), code (`...`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-foreground font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={i} className="text-muted-foreground italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="bg-muted border-border/40 rounded border px-1 py-0.5 font-mono text-[12px] text-blue-700 dark:text-blue-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ─── RawOutputPanel ───────────────────────────────────────────────────────────

interface RawOutputPanelProps {
  analyzeBody: string | null;
  graphragBody: string | null;
  rewriteBody: string | null;
  isAnalyzing: boolean;
  isGraphragLoading: boolean;
  isRewriting: boolean;
}

function RawBlock({
  label,
  path,
  method = "POST",
  body,
  loading,
}: {
  label: string;
  path: string;
  method?: string;
  body: string | null;
  loading: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* denied */
    }
  }, [body]);

  return (
    <div className="border-border/60 overflow-hidden rounded-lg border">
      {/* Block header */}
      <div className="border-border/40 bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
              method === "GET"
                ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {method}
          </span>
          <code className="text-foreground/70 font-mono text-[11px]">{path}</code>
          <span className="text-muted-foreground/40 text-[11px]">— {label}</span>
        </div>
        {body && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {/* Body */}
      <div className="bg-muted/10 p-3">
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="text-muted-foreground/50 h-3.5 w-3.5 animate-spin" />
            <span className="text-muted-foreground/50 font-mono text-[11px] italic">
              Waiting for response…
            </span>
          </div>
        ) : body ? (
          <pre className="text-foreground/80 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
            {body}
          </pre>
        ) : (
          <p className="text-muted-foreground/40 font-mono text-[11px] italic">
            Not called yet in this session.
          </p>
        )}
      </div>
    </div>
  );
}

function RawOutputPanel({
  analyzeBody,
  graphragBody,
  rewriteBody,
  isAnalyzing,
  isGraphragLoading,
  isRewriting,
}: RawOutputPanelProps) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground/50 text-[10px] font-semibold tracking-widest uppercase">
        Raw API responses
      </p>
      <RawBlock label="response" path="/v1/analyze" body={analyzeBody} loading={isAnalyzing} />
      <RawBlock
        label="response"
        path="/v1/graphrag"
        method="GET"
        body={graphragBody}
        loading={isGraphragLoading}
      />
      <RawBlock label="response" path="/v1/rewrite" body={rewriteBody} loading={isRewriting} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PlaygroundPage() {
  const { t } = useTranslation();

  const [text, setText] = useState("");
  const [riskStatus, setRiskStatus] = useState<RiskStatus>("unknown");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null);
  const [rewriteResult, setRewriteResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFindingIndex, setActiveFindingIndex] = useState<number | null>(null);

  // ── Auto-rewrite toggle ──────────────────────────────────────────────────
  const [autoRewrite, setAutoRewrite] = useState(false);

  // ── Token colour overlay ─────────────────────────────────────────────────
  const [isHighlighting, setIsHighlighting] = useState(false);

  // ── Raw / rich toggle ────────────────────────────────────────────────────
  const [rawMode, setRawMode] = useState(false);

  // Raw API response bodies (stored so the raw view can show them anytime)
  const [rawAnalyzeBody, setRawAnalyzeBody] = useState<string | null>(null);
  const [rawGraphragBody, setRawGraphragBody] = useState<string | null>(null);
  const [rawRewriteBody, setRawRewriteBody] = useState<string | null>(null);

  // ── GraphRAG explanation ─────────────────────────────────────────────────
  const [graphragContent, setGraphragContent] = useState("");
  const [isGraphragLoading, setIsGraphragLoading] = useState(false);
  const [graphragDone, setGraphragDone] = useState(false);
  const [graphragError, setGraphragError] = useState<string | null>(null);

  const {
    displayedText: graphragDisplay,
    isRendering: graphragRendering,
    skipToEnd: graphragSkip,
  } = useStreamingText({ content: graphragContent, isStreaming: false });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedFindings = useMemo(
    () => resolveFindings(text, toComplianceFindings(analyzeResult?.findings)),
    [text, analyzeResult?.findings]
  );

  const charPct = Math.min((text.length / MAX_CHARS) * 100, 100);
  const hasResult = analyzeResult !== null;
  const hasRewrite = rewriteResult !== null;
  const hasFindings = resolvedFindings.length > 0;
  const canRewrite = hasResult && (riskStatus === "risky" || riskStatus === "hitl");

  // Auto-rewrite: fire once canRewrite becomes true and graphrag has settled.
  useEffect(() => {
    if (autoRewrite && canRewrite && !isRewriting && !hasRewrite) {
      void handleRewrite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRewrite, canRewrite, isRewriting, hasRewrite]);

  // Fire graphrag after analyze — runs in the background, typewriter renders as it arrives.
  const handleGraphrag = useCallback(async (analysisId: string) => {
    if (!analysisId) return;
    setGraphragContent("");
    setGraphragDone(false);
    setGraphragError(null);
    setIsGraphragLoading(true);

    try {
      const result = await commands.request.send({
        params: {
          endpoint: "Graphrag",
          body: { analysis_id: analysisId },
          timeoutMs: 60_000,
        },
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(`GraphRAG API error ${result.status}: ${result.body}`);
      }

      let explanation = "";

      if (result.isJson && result.body.trim()) {
        const raw = JSON.parse(result.body) as Record<string, unknown>;
        console.debug("[Playground] graphrag raw response:", raw);
        // Try the most likely field names in priority order.
        explanation =
          // Primary field returned by /v1/graphrag
          (raw.analysis_text as string | undefined) ??
          // Common alternatives
          (raw.summary as string | undefined) ??
          (raw.explanation as string | undefined) ??
          (raw.content as string | undefined) ??
          (raw.text as string | undefined) ??
          (raw.result as string | undefined) ??
          (raw.output as string | undefined) ??
          (raw.description as string | undefined) ??
          // Last resort: first string value that is NOT a UUID-like analysis_id / request_id.
          Object.entries(raw)
            .filter(([k]) => k !== "analysis_id" && k !== "request_id" && k !== "client_id")
            .map(([, v]) => v)
            .find((v): v is string => typeof v === "string") ??
          // Absolute fallback: pretty-print JSON so the structure is visible.
          JSON.stringify(raw, null, 2);
      } else if (!result.isJson && result.body.trim()) {
        explanation = result.body.trim();
      }

      setGraphragContent(explanation);
      // Store raw body for the raw-mode panel
      setRawGraphragBody(
        result.isJson ? result.body : JSON.stringify({ raw: result.body }, null, 2)
      );
      logRequest({
        endpoint: "Graphrag",
        requestBody: { analysis_id: analysisId },
        result,
        source: "playground",
        sourceName: "Playground",
      });
    } catch (err) {
      const msg = getErrorMessage(err);
      setGraphragError(msg);
      logFailedRequest({
        endpoint: "Graphrag",
        requestBody: { analysis_id: analysisId },
        error: msg,
        source: "playground",
        sourceName: "Playground",
      });
    } finally {
      setIsGraphragLoading(false);
      setGraphragDone(true);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!text.trim() || isAnalyzing) return;
    setError(null);
    setActiveFindingIndex(null);
    setRiskStatus("analyzing");
    setIsAnalyzing(true);
    setRewriteResult(null);
    // Reset graphrag for the new session
    setGraphragContent("");
    setGraphragDone(false);
    setGraphragError(null);

    try {
      const result = await commands.request.send({
        params: { endpoint: "Analyze", body: { content: text }, timeoutMs: 60_000 },
      });

      if (!result.isJson || result.status < 200 || result.status >= 300) {
        throw new Error(`API error ${result.status}: ${result.body}`);
      }

      const raw = JSON.parse(result.body) as Record<string, unknown>;
      // Log the raw response so we can see exact field names while developing.
      console.debug("[Playground] analyze raw response:", raw);

      // The REST API may use different field names than the WebSocket layer.
      // Try common variants before falling back to score-based derivation.
      const rawStatus =
        (raw.status as string | undefined) ??
        (raw.verdict as string | undefined) ??
        (raw.risk_status as string | undefined) ??
        (raw.decision as string | undefined);

      const VALID_STATUSES = new Set<string>(["safe", "risky", "hitl"]);
      const derivedStatus: RiskStatus = VALID_STATUSES.has(rawStatus ?? "")
        ? (rawStatus as RiskStatus)
        : (() => {
            // Fall back: derive from risk_score if status is missing/unrecognised.
            const score = typeof raw.risk_score === "number" ? raw.risk_score : 0;
            if (score >= 0.7) return "risky";
            if (score >= 0.3) return "hitl";
            return "safe";
          })();

      const parsed: AnalyzeResponse = {
        analysis_id:
          (raw.analysis_id as string | undefined) ??
          (raw.analysis_record_id as string | undefined) ??
          "",
        status: derivedStatus,
        risk_score: (raw.risk_score as number | undefined) ?? 0,
        processing_time: raw.processing_time as number | undefined,
        entities_detected: raw.entities_detected as string[] | undefined,
        findings: raw.findings as ComplianceFinding[] | undefined,
        can_bypass: raw.can_bypass as boolean | undefined,
      };

      setAnalyzeResult(parsed);
      setRiskStatus(derivedStatus);

      // Persist analysis_id for the Requests page
      if (parsed.analysis_id) {
        useRequestStore.setState((s) => ({
          lastAnalysisId: parsed.analysis_id,
          lastTokenPair: s.lastTokenPair,
        }));

        // Store raw body for the raw-mode panel
        setRawAnalyzeBody(
          result.isJson ? result.body : JSON.stringify({ raw: result.body }, null, 2)
        );

        // Fire graphrag in the background — don't await, let it stream in
        void handleGraphrag(parsed.analysis_id);
      }

      // Log to local request log (Monitoring page)
      logRequest({
        endpoint: "Analyze",
        requestBody: { content: text },
        result,
        source: "playground",
        sourceName: "Playground",
      });
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      setRiskStatus("unknown");
      logFailedRequest({
        endpoint: "Analyze",
        requestBody: { content: text },
        error: message,
        source: "playground",
        sourceName: "Playground",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [text, isAnalyzing, handleGraphrag]);

  const handleRewrite = useCallback(async () => {
    if (!text.trim() || !canRewrite || isRewriting) return;
    setIsRewriting(true);

    const body: Record<string, unknown> = { content: text };
    const aid = analyzeResult?.analysis_id;
    if (aid) body.analysis_id = aid;

    try {
      const result = await commands.request.send({
        params: { endpoint: "Rewrite", body, timeoutMs: 60_000 },
      });

      // Only reject on non-2xx — plain-text responses are handled below.
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`API error ${result.status}: ${result.body}`);
      }

      console.debug("[Playground] rewrite raw body:", result.body, "isJson:", result.isJson);

      let rewritten = "";

      if (result.isJson && result.body.trim()) {
        const rawRw = JSON.parse(result.body) as Record<string, unknown>;
        // Try every field name the Partner API might use, in priority order.
        const candidate =
          (rawRw.rewritten_content as string | undefined) ??
          (rawRw.rewritten_text as string | undefined) ??
          (rawRw.content as string | undefined) ??
          (rawRw.rewrite as string | undefined) ??
          (rawRw.text as string | undefined) ??
          (rawRw.result as string | undefined) ??
          (rawRw.output as string | undefined) ??
          (rawRw.data as string | undefined) ??
          // Last resort: grab the first string value in the object.
          Object.values(rawRw).find((v): v is string => typeof v === "string");

        rewritten = candidate ?? "";
      } else if (!result.isJson && result.body.trim()) {
        // The API returned plain text — use it directly.
        rewritten = result.body.trim();
      }

      if (!rewritten) {
        // 204 No Content or unrecognised structure — inform the user.
        throw new Error(
          `Rewrite response (HTTP ${result.status}) didn't contain text. ` +
            `Body: ${result.body.slice(0, 200) || "(empty)"}. ` +
            `Check the browser console for the full response.`
        );
      }

      setRewriteResult(rewritten);
      setRawRewriteBody(
        result.isJson ? result.body : JSON.stringify({ raw: result.body }, null, 2)
      );

      // Log to local request log (Monitoring page)
      logRequest({
        endpoint: "Rewrite",
        requestBody: body,
        result,
        source: "playground",
        sourceName: "Playground",
      });
    } catch (err) {
      const rwErr = getErrorMessage(err);
      setError(rwErr);
      logFailedRequest({
        endpoint: "Rewrite",
        requestBody: body,
        error: rwErr,
        source: "playground",
        sourceName: "Playground",
      });
    } finally {
      setIsRewriting(false);
    }
  }, [text, canRewrite, isRewriting, analyzeResult]);

  const resetSession = useCallback(() => {
    setRiskStatus("unknown");
    setAnalyzeResult(null);
    setRewriteResult(null);
    setError(null);
    setActiveFindingIndex(null);
    setGraphragContent("");
    setGraphragDone(false);
    setGraphragError(null);
    setRawAnalyzeBody(null);
    setRawGraphragBody(null);
    setRawRewriteBody(null);
    setIsHighlighting(false);
  }, []);

  const handleClear = useCallback(() => {
    setText("");
    resetSession();
    textareaRef.current?.focus();
  }, [resetSession]);

  const handleTextChange = useCallback(
    (value: string) => {
      setText(value);
      resetSession();
    },
    [resetSession]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !isAnalyzing) {
        e.preventDefault();
        void handleAnalyze();
      }
    },
    [text, isAnalyzing, handleAnalyze]
  );

  const isLoading = isAnalyzing || isRewriting;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col" style={{ height: "calc(100vh - 7rem)" }}>
        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-1.5">
            {text.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-8 gap-1.5 text-xs"
                onClick={handleClear}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("playground.new_session")}
              </Button>
            )}
          </div>

          {/* Raw / Rich toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRawMode((v) => !v)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                rawMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50 bg-transparent"
              )}
              title={rawMode ? "Switch to rich view" : "Switch to raw JSON view"}
            >
              {rawMode ? (
                <>
                  <Layers className="h-3.5 w-3.5" />
                  Rich view
                </>
              ) : (
                <>
                  <Braces className="h-3.5 w-3.5" />
                  Raw JSON
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Main two-panel workspace ──────────────────────────────────────── */}
        <div className="bg-card min-h-0 flex-1 overflow-hidden rounded-xl border">
          <div className="flex h-full">
            {/* ── LEFT: Input ───────────────────────────────────────────────── */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-hidden border-r">
              {/* Panel header */}
              <div className="bg-muted/20 flex h-10 shrink-0 items-center justify-between border-b px-4">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
                  {t("playground.input_panel")}
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="bg-muted/60 h-1 w-12 overflow-hidden rounded-full">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        charPct > 90 ? "bg-red-500" : "bg-primary"
                      )}
                      style={{ width: `${charPct}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground/40 font-mono text-[10px] tabular-nums">
                    {t("playground.char_count", { count: text.length, max: MAX_CHARS })}
                  </span>
                </div>
              </div>

              {/* Editor / Raw request */}
              <div className="relative min-h-0 flex-1">
                {rawMode ? (
                  /* Raw mode — show the exact JSON body that was / will be sent */
                  <div className="absolute inset-0 overflow-auto p-3">
                    <p className="text-muted-foreground/50 mb-2 font-mono text-[10px] tracking-widest uppercase">
                      POST /v1/analyze — request body
                    </p>
                    <pre className="text-foreground/80 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {JSON.stringify({ content: text || "(empty)" }, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <>
                    {/* Token colour overlay — sits beneath the finding highlight overlay */}
                    {isHighlighting && text && !resolvedFindings.length && (
                      <TokenOverlay text={text} />
                    )}
                    {/* Highlight overlay */}
                    {resolvedFindings.length > 0 && (
                      <HighlightOverlay
                        text={text}
                        findings={resolvedFindings}
                        activeIndex={activeFindingIndex}
                      />
                    )}
                    <textarea
                      ref={textareaRef}
                      value={text}
                      onChange={(e) => handleTextChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t("playground.input_placeholder")}
                      disabled={isLoading}
                      maxLength={MAX_CHARS}
                      spellCheck={false}
                      className={cn(
                        // z-[3]: above both TokenOverlay (z-1) and HighlightOverlay (z-2).
                        // bg-transparent lets coloured overlay backgrounds show through.
                        // text-transparent (findings only) lets the HighlightOverlay text
                        // be read through the invisible textarea characters.
                        "absolute inset-0 z-[3] h-full w-full resize-none p-3",
                        "border-0 bg-transparent outline-none focus:ring-0",
                        "placeholder:text-muted-foreground/30 disabled:opacity-40",
                        EDITOR_FONT,
                        resolvedFindings.length > 0 &&
                          "caret-foreground selection:bg-primary/30 text-transparent selection:text-transparent"
                      )}
                    />
                  </>
                )}
              </div>

              {/* Bottom bar */}
              <div className="bg-muted/10 flex h-12 shrink-0 items-center justify-between gap-2 border-t px-4">
                {/* Left: keyboard shortcut hint */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <kbd className="bg-muted/50 text-muted-foreground/50 hidden h-5 items-center gap-0.5 rounded-md border px-1.5 font-mono text-[10px] sm:inline-flex">
                    Ctrl
                  </kbd>
                  <span className="text-muted-foreground/30 hidden text-[10px] sm:inline">+</span>
                  <kbd className="bg-muted/50 text-muted-foreground/50 hidden h-5 items-center rounded-md border px-1.5 font-mono text-[10px] sm:inline-flex">
                    ↵
                  </kbd>
                </div>

                {/* Centre: token meter + colour toggle */}
                {!rawMode && (
                  <TokenMeter
                    text={text}
                    isHighlighting={isHighlighting}
                    onToggleHighlight={() => setIsHighlighting((v) => !v)}
                  />
                )}

                <Button
                  onClick={() => void handleAnalyze()}
                  disabled={!text.trim() || isLoading}
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5 text-xs",
                    text.trim() && !isLoading
                      ? "shadow-primary/25 bg-gradient-to-r from-[#0061FF] to-[#00284D] text-white shadow-sm hover:from-[#0050DD] hover:to-[#001838]"
                      : ""
                  )}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {isAnalyzing ? t("playground.analyzing_button") : t("playground.analyze_button")}
                  {!isAnalyzing && <Send className="ml-0.5 h-3 w-3" />}
                </Button>
              </div>
            </div>

            {/* ── RIGHT: Output ─────────────────────────────────────────────── */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-hidden">
              {/* Panel header */}
              <div className="bg-muted/20 flex h-10 shrink-0 items-center justify-between border-b px-4">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
                  {t("playground.output_panel")}
                </span>
                {riskStatus !== "unknown" &&
                  riskStatus != null &&
                  (() => {
                    const cfg = getStatusCfg(riskStatus);
                    return (
                      <Badge
                        variant="outline"
                        className={cn("h-5 gap-1.5 px-2 font-mono text-[10px]", cfg.badgeTextClass)}
                      >
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                            cfg.dotClass
                          )}
                        />
                        {t(cfg.labelKey)}
                      </Badge>
                    );
                  })()}
              </div>

              {/* Results scroll area */}
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 p-4">
                  {/* ── Raw JSON view ─────────────────────────────────────── */}
                  {rawMode && (
                    <RawOutputPanel
                      analyzeBody={rawAnalyzeBody}
                      graphragBody={rawGraphragBody}
                      rewriteBody={rawRewriteBody}
                      isAnalyzing={isAnalyzing}
                      isGraphragLoading={isGraphragLoading}
                      isRewriting={isRewriting}
                    />
                  )}

                  {/* ── Rich UI ───────────────────────────────────────────── */}
                  {!rawMode && (
                    <div className="space-y-5">
                      {/* Empty state */}
                      {riskStatus === "unknown" && !error && (
                        <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                          <div className="relative mb-6">
                            <div className="border-border/40 bg-muted/30 flex h-14 w-14 items-center justify-center rounded-2xl border">
                              <Shield className="text-primary/40 h-6 w-6" />
                            </div>
                          </div>
                          <h3 className="text-foreground/60 text-sm font-medium">
                            {t("playground.empty_title")}
                          </h3>
                          <p className="text-muted-foreground/40 mt-1.5 max-w-[240px] text-[11px] leading-relaxed">
                            {t("playground.empty_description")}
                          </p>
                          <p className="text-muted-foreground/30 mt-2 max-w-[260px] text-[10px] leading-relaxed italic">
                            {t("playground.auto_token_note")}
                          </p>
                        </div>
                      )}

                      {/* Error */}
                      {error && (
                        <div className="rounded-lg border border-red-200/50 bg-red-50/30 p-4 dark:border-red-800/50 dark:bg-red-950/20">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600">
                              <AlertTriangle className="h-5 w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                                {t("playground.error_title")}
                              </span>
                              <p className="text-muted-foreground mt-0.5 text-xs">{error}</p>
                            </div>
                            <Button
                              onClick={() => void handleAnalyze()}
                              variant="outline"
                              size="sm"
                              className="shrink-0 text-xs"
                            >
                              {t("playground.retry")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Risk status card */}
                      {(hasResult || isAnalyzing) && (
                        <MessageBlock
                          icon={Shield}
                          iconColor="bg-gradient-to-br from-[#0061FF] to-[#00284D]"
                          label={t("playground.compliance_engine")}
                        >
                          <RiskStatusCard status={riskStatus} result={analyzeResult} t={t} />
                        </MessageBlock>
                      )}

                      {/* Bypass permission — shown when the backend grants override rights */}
                      {analyzeResult?.can_bypass &&
                        (riskStatus === "risky" || riskStatus === "hitl") && (
                          <MessageBlock
                            icon={ShieldCheck}
                            iconColor="bg-gradient-to-br from-amber-500 to-orange-600"
                            label={t("playground.bypass_section")}
                          >
                            <div className="space-y-1.5 rounded-lg border border-amber-200/40 bg-amber-50/20 p-3 dark:border-amber-800/40 dark:bg-amber-950/10">
                              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                                {t("playground.bypass_title")}
                              </p>
                              <p className="text-muted-foreground text-xs leading-relaxed">
                                {t("playground.bypass_description")}
                              </p>
                              <p className="text-muted-foreground/50 text-[11px] italic">
                                {t("playground.bypass_audit")}
                              </p>
                            </div>
                          </MessageBlock>
                        )}

                      {/* Findings */}
                      {hasFindings && (
                        <MessageBlock
                          icon={ScanSearch}
                          iconColor="bg-gradient-to-br from-amber-500 to-orange-600"
                          label={t("playground.detected_issues")}
                          badge={
                            <Badge className="border-0 bg-amber-500/15 px-1.5 py-0 text-[9px] text-amber-600 dark:text-amber-400">
                              {t("playground.findings_count", { count: resolvedFindings.length })}
                            </Badge>
                          }
                        >
                          <FindingsList
                            text={text}
                            findings={resolvedFindings}
                            activeIndex={activeFindingIndex}
                            onHover={setActiveFindingIndex}
                            onSelect={setActiveFindingIndex}
                            t={t}
                          />
                        </MessageBlock>
                      )}

                      {/* GraphRAG Explanation */}
                      {(hasResult || isGraphragLoading) && (
                        <GraphragBlock
                          content={graphragContent}
                          displayedText={graphragDisplay}
                          isRendering={graphragRendering}
                          isLoading={isGraphragLoading}
                          done={graphragDone}
                          error={graphragError}
                          onSkip={graphragSkip}
                        />
                      )}

                      {/* Rewrite result */}
                      {(hasRewrite || isRewriting) && (
                        <MessageBlock
                          icon={Wand2}
                          iconColor="bg-gradient-to-br from-emerald-500 to-teal-600"
                          label={t("playground.rewrite_suggestion")}
                          badge={
                            !isRewriting && hasRewrite ? (
                              <Badge className="border-0 bg-emerald-500/15 px-1.5 py-0 text-[9px] text-emerald-600 dark:text-emerald-400">
                                {t("playground.rewrite_complete")}
                              </Badge>
                            ) : undefined
                          }
                          actions={
                            hasRewrite && rewriteResult ? (
                              <CopyButton text={rewriteResult} aria-label="Copy rewrite result" />
                            ) : undefined
                          }
                        >
                          <div className="rounded-lg border border-emerald-200/30 bg-emerald-50/20 p-4 dark:border-emerald-800/30 dark:bg-emerald-950/10">
                            {hasRewrite ? (
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                                {rewriteResult}
                              </p>
                            ) : (
                              <div className="flex items-center gap-3 py-1">
                                <div className="flex items-center gap-1">
                                  {[0, 1, 2].map((i) => (
                                    <div
                                      key={i}
                                      className="bg-foreground/25 h-1.5 w-1.5 animate-pulse rounded-full"
                                      style={{ animationDelay: `${i * 200}ms` }}
                                    />
                                  ))}
                                </div>
                                <span className="text-muted-foreground/50 text-[13px] italic">
                                  {t("playground.rewriting_button")}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Apply rewrite button */}
                          {hasRewrite && rewriteResult && (
                            <div className="mt-2 flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setText(rewriteResult);
                                  setRewriteResult(null);
                                  setAnalyzeResult(null);
                                  setRiskStatus("unknown");
                                }}
                              >
                                {t("playground.apply_to_editor")}
                              </Button>
                            </div>
                          )}
                        </MessageBlock>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Rewrite footer */}
              <div className="bg-muted/10 flex h-12 shrink-0 items-center justify-between gap-3 border-t px-4">
                {/* Left: auto-rewrite toggle + hint text */}
                <div className="flex min-w-0 items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch
                          id="auto-rewrite"
                          checked={autoRewrite}
                          onCheckedChange={setAutoRewrite}
                          className="scale-90"
                        />
                        <Label
                          htmlFor="auto-rewrite"
                          className="text-muted-foreground cursor-pointer text-xs select-none"
                        >
                          {t("playground.auto_rewrite")}
                        </Label>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">{t("playground.auto_rewrite_desc")}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Hint text */}
                  <span className="text-muted-foreground/70 truncate text-[11px]">
                    {isRewriting
                      ? t("playground.rewrite_hint_rewriting")
                      : autoRewrite && !canRewrite && !hasResult
                        ? t("playground.auto_rewrite_hint")
                        : canRewrite
                          ? t("playground.rewrite_hint_available")
                          : hasResult
                            ? t("playground.rewrite_hint_no_risk")
                            : t("playground.rewrite_hint_check_first")}
                  </span>
                </div>

                {/* Right: Rewrite button */}
                <Button
                  size="sm"
                  variant={canRewrite ? "default" : "outline"}
                  className={cn(
                    "h-8 shrink-0 gap-1.5 text-xs",
                    canRewrite
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-500/20 hover:from-emerald-700 hover:to-teal-700"
                      : ""
                  )}
                  disabled={!canRewrite || isRewriting || isAnalyzing}
                  onClick={() => void handleRewrite()}
                >
                  {isRewriting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  {isRewriting ? t("playground.rewriting_button") : t("playground.rewrite_button")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
