/**
 * Minimal code-block component for the test tool.
 *
 * Renders a scrollable <pre> with an optional header bar that shows a filename
 * / title and a copy button. No syntax highlighting (no heavy runtime needed).
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CodeBlockProps {
  code: string;
  /** Optional label shown in the header strip (e.g. filename or HTTP verb). */
  title?: string;
  className?: string;
}

export function CodeBlock({ code, title, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      {title && (
        <div className="bg-muted/40 flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-muted-foreground font-mono text-xs">{title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </Button>
        </div>
      )}
      {!title && (
        <div className="absolute top-2 right-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </Button>
        </div>
      )}
      <pre className="bg-muted/20 overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  );
}
