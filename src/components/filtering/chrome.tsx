/**
 * Visual building blocks of the filtering editor, ported from the Confinaid
 * web app (`companies/filtering`) so the test tool's Filtering page looks and
 * reads like the dashboard it stands in for: icon-tiled section cards, the
 * underline tab bar, the danger zone around the "enabled" switches and the
 * risk-score track.
 */

import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Brain,
  FileSearch,
  KeySquare,
  Loader2,
  MessageSquareCode,
  ShieldAlert,
  Tags,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FilteringProfile } from "@/types/filtering";

import {
  MIN_THRESHOLD,
  RECOMMENDED_THRESHOLD,
  THRESHOLD_GRADIENT,
  maxThresholdFor,
} from "./chrome-utils";

// ─── Tabs ─────────────────────────────────────────────────────────────────────

/** The web app's underline tab bar (`PageTabs`), applied to Radix `Tabs`. */
export const UNDERLINE_TABS_LIST =
  "h-auto w-full justify-start gap-4 overflow-x-auto rounded-none border-b bg-transparent p-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const UNDERLINE_TABS_TRIGGER =
  "h-auto flex-none gap-2 rounded-none border-0 border-b-2 border-transparent px-1 py-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground hover:border-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-primary";

// ─── Cards ────────────────────────────────────────────────────────────────────

export type Accent = "primary" | "amber";

const ACCENT_TILE: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary ring-primary/20",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400",
};

/** Rounded icon square in a card header. */
export function IconTile({
  icon: Icon,
  accent = "primary",
}: {
  icon: LucideIcon;
  accent?: Accent;
}) {
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
        ACCENT_TILE[accent]
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}

/** One `label: value` pair in a card header. */
export function HeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-3">
      <span className="text-lg leading-tight font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-[11px]">{label}</span>
    </div>
  );
}

/**
 * The web app's section card: icon tile, title and description on the left,
 * stats and actions on the right, a bordered header over the content.
 */
export function SectionCard({
  icon,
  accent = "primary",
  title,
  description,
  stats,
  actions,
  children,
  className,
  contentClassName,
}: {
  icon: LucideIcon;
  accent?: Accent;
  title: ReactNode;
  description?: ReactNode;
  stats?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex flex-wrap items-center gap-3 border-b py-4 [.border-b]:pb-4">
        <IconTile icon={icon} accent={accent} />
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {stats && <div className="flex items-center divide-x">{stats}</div>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className={cn("space-y-4 py-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

/**
 * The word typed out before a protection layer is switched off. Kept in
 * English on purpose, as in the web app: it is a token to reproduce.
 */
export const DISABLE_CONFIRMATION_WORD = "confirm";

/** The red frame every "enabled" switch of a profile lives in. */
export function DangerZone({ children, note }: { children: ReactNode; note?: string }) {
  const { t } = useTranslation();
  return (
    <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="text-destructive text-sm font-semibold">{t("filtering.danger.title")}</p>
          <p className="text-muted-foreground text-xs">{t("filtering.danger.description")}</p>
          {note && <p className="text-muted-foreground text-xs">{note}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-2.5">{children}</div>
    </div>
  );
}

/**
 * One switch that takes a protection layer away. Switching it off asks for
 * the confirmation word first; switching it on does not.
 */
export function FlagSwitch({
  id,
  label,
  description,
  warning,
  confirmNote,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  warning: string;
  confirmNote?: string;
  checked: boolean;
  onChange: (enabled: boolean) => Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const run = (enabled: boolean) => {
    setBusy(true);
    onChange(enabled)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const confirmed = typed.trim().toLowerCase() === DISABLE_CONFIRMATION_WORD;

  return (
    <div className="bg-background/60 rounded-md border px-3 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={id} className="text-sm">
            {label}
          </Label>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
          <Switch
            id={id}
            checked={checked}
            disabled={disabled || busy}
            onCheckedChange={(v) => {
              if (v) run(true);
              else {
                setTyped("");
                setConfirmOpen(true);
              }
            }}
          />
        </div>
      </div>
      {!checked && <p className="text-destructive mt-2 text-xs">{warning}</p>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("filtering.danger.confirm_title", { name: label })}</DialogTitle>
            <DialogDescription>{warning}</DialogDescription>
          </DialogHeader>
          {confirmNote && <p className="text-muted-foreground text-sm">{confirmNote}</p>}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-confirm`} className="text-xs">
              {t("filtering.danger.type_word", { word: DISABLE_CONFIRMATION_WORD })}
            </Label>
            <Input
              id={`${id}-confirm`}
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              placeholder={DISABLE_CONFIRMATION_WORD}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed}
              onClick={() => {
                setConfirmOpen(false);
                run(false);
              }}
            >
              {t("filtering.danger.disable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Threshold track ──────────────────────────────────────────────────────────

/**
 * The risk-score track: a fixed green-to-red gradient. With HITL on, the span
 * from the floor to the thumb is grey (the band that goes to human review);
 * without HITL the reduced ceiling is marked with a stop line.
 */
export function ThresholdTrack({
  value,
  hitlEnabled,
  onValueChange,
  onValueCommit,
  disabled,
  compact = false,
  showTicks = false,
  className,
  ariaLabel,
}: {
  value: number;
  hitlEnabled: boolean;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  disabled?: boolean;
  compact?: boolean;
  showTicks?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const max = maxThresholdFor(hitlEnabled);
  const clamp = (v: number) => Math.min(max, Math.max(MIN_THRESHOLD, Math.round(v)));
  const height = compact ? "h-1.5" : "h-2";

  return (
    <div className={cn("relative py-2", className)}>
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 left-0 w-full -translate-y-1/2 rounded-full",
          height
        )}
        style={{ background: THRESHOLD_GRADIENT }}
      />
      {hitlEnabled && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 bg-slate-400 dark:bg-slate-500",
            height
          )}
          style={{
            left: `${MIN_THRESHOLD}%`,
            width: `${Math.max(0, clamp(value) - MIN_THRESHOLD)}%`,
          }}
        />
      )}
      {max < 100 && (
        <div
          className="bg-foreground/50 pointer-events-none absolute top-1/2 z-20 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${max}%` }}
        />
      )}
      {showTicks && (
        <>
          <div
            className="pointer-events-none absolute top-1/2 z-20 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/70"
            style={{ left: `${MIN_THRESHOLD}%` }}
          />
          {max !== RECOMMENDED_THRESHOLD && (
            <div
              className="bg-primary/70 pointer-events-none absolute top-1/2 z-20 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full dark:bg-white/60"
              style={{ left: `${RECOMMENDED_THRESHOLD}%` }}
            />
          )}
        </>
      )}
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        aria-label={ariaLabel}
        onValueChange={([v]) => onValueChange(clamp(v ?? value))}
        onValueCommit={([v]) => onValueCommit(clamp(v ?? value))}
        className={cn(
          "relative w-full [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent",
          compact
            ? "[&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-track]]:h-1.5"
            : "[&_[data-slot=slider-track]]:h-2"
        )}
      />
    </div>
  );
}

// ─── Feature icons ────────────────────────────────────────────────────────────

const FEATURES: Array<{
  flag: keyof FilteringProfile;
  icon: ComponentType<{ className?: string }>;
}> = [
  { flag: "label_filtering_enabled", icon: Tags },
  { flag: "keyword_filtering_enabled", icon: KeySquare },
  { flag: "codename_filtering_enabled", icon: MessageSquareCode },
  { flag: "hitl_enabled", icon: UserCheck },
  { flag: "rewrite_enabled", icon: Bot },
  { flag: "deep_scan_enabled", icon: FileSearch },
];

/** The profile's six layers as icons: coloured when on, faded when off. */
export function FeatureIcons({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      {FEATURES.map(({ flag, icon: Icon }) => {
        const on = Boolean(profile[flag]);
        return (
          <Tooltip key={flag}>
            <TooltipTrigger asChild>
              <span
                className={cn("inline-flex", on ? "text-primary" : "text-muted-foreground/40")}
                aria-label={`${t(`filtering.fields.${flag}`)}: ${on ? t("filtering.common.active") : t("filtering.common.inactive")}`}
              >
                <Icon className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t(`filtering.fields.${flag}`)}:{" "}
              {on ? t("filtering.common.active") : t("filtering.common.inactive")}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Model label with a bot icon, for the list's Model column. */
export function ModelLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Brain className="text-muted-foreground size-3.5" />
      {label}
    </span>
  );
}
