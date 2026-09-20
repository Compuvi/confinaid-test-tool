/**
 * Custom Titlebar
 *
 * Platform-adaptive window chrome:
 *   - macOS: traffic-light buttons on the left  ● ● ●
 *   - Windows: Minimize / Maximize / Close on the right  — □ ✕
 *
 * Uses @tauri-apps/api/window directly (no Rust command wrappers needed).
 * Does NOT depend on motion/react — plain CSS transitions are used instead.
 */

import { useState, useEffect, useCallback } from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";
import { Window } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";

// ─── Platform detection ──────────────────────────────────────────────────────

/** Returns "macos" | "windows" | "linux" based on the user-agent. */
function detectPlatform(): "macos" | "windows" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "linux";
}

// ─── Main component ──────────────────────────────────────────────────────────

interface TitlebarProps {
  title?: string;
  showTitle?: boolean;
  className?: string;
}

export function Titlebar({
  title = "Confinaid Test Tool",
  showTitle = false,
  className,
}: TitlebarProps) {
  const [platform] = useState(detectPlatform);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = Window.getCurrent();

    const sync = () =>
      win
        .isMaximized()
        .then(setIsMaximized)
        .catch(() => {});

    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const handleMinimize = useCallback(() => {
    Window.getCurrent().minimize().catch(console.error);
  }, []);

  const handleMaximize = useCallback(async () => {
    const win = Window.getCurrent();
    await win.toggleMaximize().catch(console.error);
    const max = await win.isMaximized().catch(() => false);
    setIsMaximized(max);
  }, []);

  const handleClose = useCallback(() => {
    Window.getCurrent().close().catch(console.error);
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-titlebar-button]")) return;
      void handleMaximize();
    },
    [handleMaximize]
  );

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        "border-border/50 bg-background/50 flex h-9 shrink-0 items-center border-b backdrop-blur-sm select-none",
        platform === "macos" ? "flex-row" : "flex-row-reverse",
        className
      )}
    >
      {platform === "macos" ? (
        <MacOSControls
          onMinimize={handleMinimize}
          onMaximize={handleMaximize}
          onClose={handleClose}
        />
      ) : (
        <WindowsControls
          onMinimize={handleMinimize}
          onMaximize={handleMaximize}
          onClose={handleClose}
          isMaximized={isMaximized}
        />
      )}

      {/* Drag region is ONLY on the empty spacer — never on the button containers */}
      {showTitle ? (
        <div className="flex flex-1 items-center justify-center" data-tauri-drag-region>
          <span className="text-muted-foreground text-xs font-medium" data-tauri-drag-region>
            {title}
          </span>
        </div>
      ) : (
        <div className="flex-1" data-tauri-drag-region />
      )}
    </div>
  );
}

// ─── macOS traffic-light controls ───────────────────────────────────────────

function MacOSControls({
  onMinimize,
  onMaximize,
  onClose,
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className="flex items-center gap-2 px-4"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Close — red */}
      <button
        data-titlebar-button
        onClick={onClose}
        className="flex h-3 w-3 items-center justify-center rounded-full bg-[#FF5F57] transition-opacity hover:opacity-90 active:opacity-70"
      >
        {hovering && <X className="h-1.5 w-1.5 text-black/60" strokeWidth={3} />}
      </button>

      {/* Minimize — yellow */}
      <button
        data-titlebar-button
        onClick={onMinimize}
        className="flex h-3 w-3 items-center justify-center rounded-full bg-[#FEBC2E] transition-opacity hover:opacity-90 active:opacity-70"
      >
        {hovering && <Minus className="h-1.5 w-1.5 text-black/60" strokeWidth={3} />}
      </button>

      {/* Maximize — green */}
      <button
        data-titlebar-button
        onClick={onMaximize}
        className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28C840] transition-opacity hover:opacity-90 active:opacity-70"
      >
        {hovering && <Maximize2 className="h-1.5 w-1.5 text-black/60" strokeWidth={3} />}
      </button>
    </div>
  );
}

// ─── Windows controls ────────────────────────────────────────────────────────

function WindowsControls({
  onMinimize,
  onMaximize,
  onClose,
  isMaximized,
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  isMaximized: boolean;
}) {
  return (
    <div className="flex items-center">
      <button
        data-titlebar-button
        onClick={onMinimize}
        className="hover:bg-foreground/10 active:bg-foreground/20 flex h-9 w-11 items-center justify-center transition-colors"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <button
        data-titlebar-button
        onClick={onMaximize}
        className="hover:bg-foreground/10 active:bg-foreground/20 flex h-9 w-11 items-center justify-center transition-colors"
      >
        {isMaximized ? (
          <div className="relative h-3 w-3">
            <div className="absolute top-0 right-0 h-2.5 w-2.5 border border-current" />
            <div className="bg-background absolute bottom-0 left-0 h-2.5 w-2.5 border border-current" />
          </div>
        ) : (
          <Square className="h-3 w-3" />
        )}
      </button>

      <button
        data-titlebar-button
        onClick={onClose}
        className="flex h-9 w-11 items-center justify-center transition-colors hover:bg-red-500 hover:text-white active:bg-red-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default Titlebar;
