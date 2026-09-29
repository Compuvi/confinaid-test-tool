/**
 * JSON syntax highlighting for the test tool.
 *
 * Two components:
 *   JsonViewer  — read-only colourised <pre> block (response bodies, previews)
 *   JsonEditor  — editable textarea with a highlighted overlay behind it
 *
 * Zero runtime dependencies: a tiny hand-rolled tokeniser covers the full
 * JSON grammar (strings / numbers / booleans / null / punctuation).
 */

import { useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

// ─── Tokeniser ────────────────────────────────────────────────────────────────

type TokenKind =
  | "key" // object key string  → sky blue
  | "string" // string value       → amber / orange
  | "number" // number             → emerald
  | "boolean" // true / false       → blue
  | "null" // null               → slate
  | "punctuation" // { } [ ] : ,       → muted foreground
  | "whitespace"; // spaces / newlines  → unstyled

interface Token {
  kind: TokenKind;
  value: string;
}

export function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // ── Whitespace ────────────────────────────────────────────────────
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      let ws = "";
      while (
        i < len &&
        (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")
      ) {
        ws += text[i++];
      }
      tokens.push({ kind: "whitespace", value: ws });
      continue;
    }

    // ── String ────────────────────────────────────────────────────────
    if (ch === '"') {
      let str = '"';
      i++;
      while (i < len) {
        if (text[i] === "\\") {
          str += text[i] + (text[i + 1] ?? "");
          i += 2;
        } else if (text[i] === '"') {
          str += '"';
          i++;
          break;
        } else {
          str += text[i++];
        }
      }
      // Look ahead past whitespace for a colon → this is a key
      let j = i;
      while (j < len && (text[j] === " " || text[j] === "\t")) j++;
      const isKey = text[j] === ":";
      tokens.push({ kind: isKey ? "key" : "string", value: str });
      continue;
    }

    // ── Number ────────────────────────────────────────────────────────
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let num = "";
      while (i < len && /[-+\d.eE]/.test(text[i])) num += text[i++];
      tokens.push({ kind: "number", value: num });
      continue;
    }

    // ── Boolean / null ────────────────────────────────────────────────
    if (text.startsWith("true", i)) {
      tokens.push({ kind: "boolean", value: "true" });
      i += 4;
      continue;
    }
    if (text.startsWith("false", i)) {
      tokens.push({ kind: "boolean", value: "false" });
      i += 5;
      continue;
    }
    if (text.startsWith("null", i)) {
      tokens.push({ kind: "null", value: "null" });
      i += 4;
      continue;
    }

    // ── Punctuation ───────────────────────────────────────────────────
    tokens.push({ kind: "punctuation", value: ch });
    i++;
  }

  return tokens;
}

// ─── Colour map ───────────────────────────────────────────────────────────────

const KIND_CLASS: Record<TokenKind, string> = {
  key: "text-sky-500 dark:text-sky-300",
  string: "text-orange-600 dark:text-amber-300",
  number: "text-emerald-700 dark:text-emerald-300",
  boolean: "text-blue-600 dark:text-blue-400",
  null: "text-slate-400 dark:text-slate-400",
  punctuation: "text-foreground/60",
  whitespace: "",
};

// ─── Highlighted fragment ─────────────────────────────────────────────────────

function Highlighted({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text]);
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "whitespace" ? (
          t.value
        ) : (
          <span key={i} className={KIND_CLASS[t.kind]}>
            {t.value}
          </span>
        )
      )}
    </>
  );
}

// ─── JsonViewer ───────────────────────────────────────────────────────────────

/**
 * Read-only syntax-highlighted JSON block.
 * Drop-in replacement for <pre> tags that display JSON.
 */
export function JsonViewer({ code, className }: { code: string; className?: string }) {
  return (
    <pre
      className={cn("font-mono text-xs leading-relaxed break-all whitespace-pre-wrap", className)}
    >
      <Highlighted text={code} />
    </pre>
  );
}

// ─── JsonEditor ───────────────────────────────────────────────────────────────

/**
 * Editable JSON textarea with a syntax-highlighted overlay.
 *
 * Technique: the <pre> grows with the content (drives the container height);
 * the <textarea> is overlaid absolutely with transparent text so only the
 * caret and selection are visible.  Both share identical font metrics and
 * padding so every character lines up perfectly.
 */
export interface JsonEditorProps {
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  spellCheck?: boolean;
  autoComplete?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  id?: string;
  /** Minimum height in Tailwind or CSS (default "min-h-40"). */
  minHeightClass?: string;
  className?: string;
  placeholder?: string;
}

/** Shared padding / font so the <pre> and <textarea> stay in perfect sync. */
const SHARED = "px-3 py-2 font-mono text-xs leading-relaxed";

export function JsonEditor({
  value,
  onChange,
  disabled,
  spellCheck = false,
  autoComplete = "off",
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  id,
  minHeightClass = "min-h-40",
  className,
  placeholder,
}: JsonEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className={cn(
        // Border / focus ring — mirrors shadcn Textarea
        "border-input focus-within:border-ring focus-within:ring-ring/50 relative overflow-auto rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
        ariaInvalid === true || ariaInvalid === "true" ? "border-destructive" : "",
        disabled && "cursor-not-allowed opacity-50",
        minHeightClass,
        className
      )}
    >
      {/* ── Highlighted background (drives container height) ── */}
      <pre
        aria-hidden="true"
        className={cn(
          "pointer-events-none w-full break-words whitespace-pre-wrap select-none",
          SHARED
        )}
      >
        <Highlighted text={value || " "} />
        {/* trailing newline ensures the last line always has height */}
        {"\n"}
      </pre>

      {/* ── Transparent textarea sits on top ── */}
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        spellCheck={spellCheck}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        placeholder={placeholder}
        // absolute overlay — exact same size as the pre above
        className={cn(
          "absolute inset-0 h-full w-full resize-none bg-transparent text-transparent outline-none",
          SHARED,
          // Keep caret and text-selection visible
          "selection:bg-sky-500/25 selection:text-transparent"
        )}
        // Caret colour must be explicit because text-transparent hides it
        style={{ caretColor: "hsl(var(--foreground))" }}
      />
    </div>
  );
}
