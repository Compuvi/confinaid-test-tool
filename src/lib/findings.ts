/**
 * Port of the frontend's `analysis/_lib/findings.ts`.
 * Pure TypeScript — no React, no dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceFinding {
  start: number;
  end: number;
  quote?: string | null;
  label_id?: string | null;
  label_path?: string | null;
  label_title?: string | null;
  keyword?: string | null;
  match_type?: string | null;
}

export interface ResolvedFinding {
  index: number;
  start: number;
  end: number;
  quote: string;
  finding: ComplianceFinding;
}

export interface Segment {
  text: string;
  finding?: ResolvedFinding;
}

export interface CategoryStyle {
  mark: string;
  markActive: string;
  dot: string;
  badge: string;
  rowActive: string;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const PALETTE: CategoryStyle[] = [
  {
    mark: "bg-red-400/25 dark:bg-red-500/30 border-b-2 border-red-500/80",
    markActive: "bg-red-400/45 dark:bg-red-500/50 border-b-2 border-red-500",
    dot: "bg-red-500",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    rowActive: "bg-red-500/10 ring-1 ring-red-500/40",
  },
  {
    mark: "bg-orange-400/25 dark:bg-orange-500/30 border-b-2 border-orange-500/80",
    markActive: "bg-orange-400/45 dark:bg-orange-500/50 border-b-2 border-orange-500",
    dot: "bg-orange-500",
    badge: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    rowActive: "bg-orange-500/10 ring-1 ring-orange-500/40",
  },
  {
    mark: "bg-amber-400/25 dark:bg-amber-500/30 border-b-2 border-amber-500/80",
    markActive: "bg-amber-400/45 dark:bg-amber-500/50 border-b-2 border-amber-500",
    dot: "bg-amber-500",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    rowActive: "bg-amber-500/10 ring-1 ring-amber-500/40",
  },
  {
    mark: "bg-rose-400/25 dark:bg-rose-500/30 border-b-2 border-rose-500/80",
    markActive: "bg-rose-400/45 dark:bg-rose-500/50 border-b-2 border-rose-500",
    dot: "bg-rose-500",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    rowActive: "bg-rose-500/10 ring-1 ring-rose-500/40",
  },
  {
    mark: "bg-fuchsia-400/25 dark:bg-fuchsia-500/30 border-b-2 border-fuchsia-500/80",
    markActive: "bg-fuchsia-400/45 dark:bg-fuchsia-500/50 border-b-2 border-fuchsia-500",
    dot: "bg-fuchsia-500",
    badge: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    rowActive: "bg-fuchsia-500/10 ring-1 ring-fuchsia-500/40",
  },
  {
    mark: "bg-violet-400/25 dark:bg-violet-500/30 border-b-2 border-violet-500/80",
    markActive: "bg-violet-400/45 dark:bg-violet-500/50 border-b-2 border-violet-500",
    dot: "bg-violet-500",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    rowActive: "bg-violet-500/10 ring-1 ring-violet-500/40",
  },
  {
    mark: "bg-blue-400/25 dark:bg-blue-500/30 border-b-2 border-blue-500/80",
    markActive: "bg-blue-400/45 dark:bg-blue-500/50 border-b-2 border-blue-500",
    dot: "bg-blue-500",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    rowActive: "bg-blue-500/10 ring-1 ring-blue-500/40",
  },
  {
    mark: "bg-cyan-400/25 dark:bg-cyan-500/30 border-b-2 border-cyan-500/80",
    markActive: "bg-cyan-400/45 dark:bg-cyan-500/50 border-b-2 border-cyan-500",
    dot: "bg-cyan-500",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    rowActive: "bg-cyan-500/10 ring-1 ring-cyan-500/40",
  },
];

const KEYWORD_STYLE: CategoryStyle = {
  mark: "bg-indigo-400/25 dark:bg-indigo-500/30 border-b-2 border-indigo-500/80",
  markActive: "bg-indigo-400/45 dark:bg-indigo-500/50 border-b-2 border-indigo-500",
  dot: "bg-indigo-500",
  badge: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  rowActive: "bg-indigo-500/10 ring-1 ring-indigo-500/40",
};

const UNLABELED_STYLE: CategoryStyle = {
  mark: "bg-slate-400/25 dark:bg-slate-500/30 border-b-2 border-slate-500/80",
  markActive: "bg-slate-400/45 dark:bg-slate-500/50 border-b-2 border-slate-500",
  dot: "bg-slate-500",
  badge: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  rowActive: "bg-slate-500/10 ring-1 ring-slate-500/40",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isKeywordFinding(finding: ComplianceFinding): boolean {
  return typeof finding.keyword === "string" && finding.keyword.trim().length > 0;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getFindingStyle(finding: ComplianceFinding): CategoryStyle {
  if (isKeywordFinding(finding)) return KEYWORD_STYLE;
  const segments = taxonomyLabels(finding);
  if (segments.length === 0) return UNLABELED_STYLE;
  return PALETTE[hashString(segments[0].toLowerCase()) % PALETTE.length];
}

function lineAt(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function getLineRange(
  text: string,
  start: number,
  end: number
): { startLine: number; endLine: number } {
  return {
    startLine: lineAt(text, start),
    endLine: lineAt(text, Math.max(start, end - 1)),
  };
}

export function resolveFinding(
  text: string,
  finding: ComplianceFinding
): { start: number; end: number } | null {
  const len = text.length;
  const { start, end, quote } = finding;
  const hasValidOffsets =
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= len && start < end;

  if (hasValidOffsets && (!quote || text.slice(start, end) === quote)) {
    return { start, end };
  }

  if (quote && quote.length > 0) {
    const hint = Math.max(0, (Number.isInteger(start) ? start : 0) - 100);
    let idx = text.indexOf(quote, hint);
    if (idx === -1) idx = text.indexOf(quote);
    if (idx !== -1) return { start: idx, end: idx + quote.length };

    const trimmed = quote.trim();
    if (trimmed && trimmed !== quote) {
      let tIdx = text.indexOf(trimmed, hint);
      if (tIdx === -1) tIdx = text.indexOf(trimmed);
      if (tIdx !== -1) return { start: tIdx, end: tIdx + trimmed.length };
    }
  }

  return null;
}

export function resolveFindings(text: string, findings: ComplianceFinding[]): ResolvedFinding[] {
  if (!findings.length || !text) return [];
  const resolved: ResolvedFinding[] = [];
  findings.forEach((finding, index) => {
    const range = resolveFinding(text, finding);
    if (!range) return;
    resolved.push({
      index,
      start: range.start,
      end: range.end,
      quote: text.slice(range.start, range.end),
      finding,
    });
  });
  resolved.sort((a, b) => a.start - b.start || a.end - b.end);
  return resolved;
}

export function buildSegments(text: string, resolved: ResolvedFinding[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of resolved) {
    if (r.start < cursor) continue;
    if (r.start > cursor) segments.push({ text: text.slice(cursor, r.start) });
    segments.push({ text: text.slice(r.start, r.end), finding: r });
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

const PATH_SEPARATOR = /\s*>\s*/;

export function taxonomyLabels(finding: ComplianceFinding): string[] {
  const path = (finding.label_path ?? "").trim();
  const segments = path
    ? path
        .split(PATH_SEPARATOR)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (segments.length === 0) {
    const title = (finding.label_title ?? "").trim();
    return title ? [title] : [];
  }

  const seen = new Set<string>();
  return segments.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

export function toComplianceFindings(value: unknown): ComplianceFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is ComplianceFinding =>
      !!f &&
      typeof f === "object" &&
      Number.isInteger((f as ComplianceFinding).start) &&
      Number.isInteger((f as ComplianceFinding).end)
  );
}
