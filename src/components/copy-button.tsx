import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  className?: string;
  "aria-label"?: string;
}

export function CopyButton({ text, className, "aria-label": ariaLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard API unavailable in this context — silent fail.
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 shrink-0", className)}
      onClick={handleCopy}
      aria-label={ariaLabel ?? "Copy"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
