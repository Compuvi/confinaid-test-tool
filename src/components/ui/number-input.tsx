import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type" | "onChange"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  className,
  disabled,
  ...props
}: NumberInputProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) onChange(clamp(parsed));
  };

  const increment = () => onChange(clamp(value + step));
  const decrement = () => onChange(clamp(value - step));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      increment();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      decrement();
    }
  };

  return (
    <div
      className={cn(
        "border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        "flex h-9 w-full min-w-0 items-center rounded-md border bg-transparent shadow-xs transition-[color,box-shadow]",
        disabled && "pointer-events-none cursor-not-allowed opacity-50",
        className
      )}
    >
      <input
        type="number"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-3 py-1 text-sm outline-none disabled:cursor-not-allowed"
        {...props}
      />

      {/* Custom stepper buttons */}
      <div className="border-input flex h-full flex-col border-l">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || value >= max}
          onClick={increment}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex flex-1 items-center justify-center rounded-tr-md px-1.5 transition-colors disabled:pointer-events-none disabled:opacity-30"
          aria-label="Increase"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <div className="border-input border-t" />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || value <= min}
          onClick={decrement}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex flex-1 items-center justify-center rounded-br-md px-1.5 transition-colors disabled:pointer-events-none disabled:opacity-30"
          aria-label="Decrease"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export { NumberInput };
