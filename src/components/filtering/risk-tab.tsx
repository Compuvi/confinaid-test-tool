import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HITL_OFF_MAX_THRESHOLD } from "@/lib/filtering/payload";
import type { FilteringProfile } from "@/types/filtering";

import { DangerZone, FlagSwitch, SectionCard, ThresholdTrack } from "./chrome";
import {
  MIN_THRESHOLD,
  RECOMMENDED_THRESHOLD,
  maxThresholdFor,
  thresholdColor,
  useProfileFieldSave,
} from "./chrome-utils";
import { SelectField } from "./shared";
import { useAiModelOptions } from "./use-catalog-options";

const CONTEXT_MAX = 10000;
/** How long the threshold must stay put before it is saved. */
const COMMIT_DELAY_MS = 500;

/**
 * The web app's Risk tab: the risk-score threshold on the gradient track, the
 * AI model, the profile context and the HITL / Rewrite switches. Each control
 * saves on its own, as there.
 */
export function RiskTab({ profile }: { profile: FilteringProfile }) {
  const { t } = useTranslation();
  const models = useAiModelOptions();
  const { save, pending } = useProfileFieldSave(profile);
  const max = maxThresholdFor(profile.hitl_enabled);

  // Slider position, kept apart from the stored value while dragging.
  const [threshold, setThreshold] = useState(profile.general_threshold);
  const [typed, setTyped] = useState<string | null>(null);
  const [stored, setStored] = useState(profile.general_threshold);
  if (profile.general_threshold !== stored) {
    setStored(profile.general_threshold);
    setThreshold(profile.general_threshold);
  }

  // The slider commits on every arrow-key step. Saving each one sent overlapping
  // PATCHes that could land out of order (five steps from 80 stored 81 while the
  // track showed 85), so only the value it settles on is saved.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(commitTimer.current), []);
  const commitThreshold = (value: number) => {
    const v = Math.min(max, Math.max(MIN_THRESHOLD, Math.round(value)));
    setThreshold(v);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      if (v === profile.general_threshold) return;
      save({ general_threshold: v }).catch(() => setThreshold(profile.general_threshold));
    }, COMMIT_DELAY_MS);
  };

  const [context, setContext] = useState(profile.context ?? "");
  const [contextBase, setContextBase] = useState(profile.context ?? "");
  if ((profile.context ?? "") !== contextBase) {
    if (context === contextBase) setContext(profile.context ?? "");
    setContextBase(profile.context ?? "");
  }
  const contextDirty = context !== (profile.context ?? "");

  const color = thresholdColor(threshold);

  return (
    <SectionCard
      icon={Settings2}
      title={t("filtering.risk.title")}
      description={t("filtering.risk.description")}
      contentClassName="space-y-6"
    >
      {/* Threshold */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">{t("filtering.fields.general_threshold")}</Label>
            <p className="text-muted-foreground text-xs">{t("filtering.risk.threshold_hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color }}>
              {threshold}%
            </span>
            <Input
              aria-label={t("filtering.fields.general_threshold")}
              className="h-8 w-20 text-right"
              inputMode="numeric"
              value={typed ?? String(threshold)}
              onChange={(e) => {
                setTyped(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && n >= MIN_THRESHOLD && n <= max)
                  setThreshold(Math.round(n));
              }}
              onBlur={() => {
                if (typed === null) return;
                const n = Number(typed);
                setTyped(null);
                if (typed.trim() === "" || !Number.isFinite(n))
                  setThreshold(profile.general_threshold);
                else commitThreshold(n);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTyped(null);
                  setThreshold(profile.general_threshold);
                }
              }}
            />
            <span className="text-muted-foreground text-sm">%</span>
          </div>
        </div>
        <ThresholdTrack
          value={threshold}
          hitlEnabled={profile.hitl_enabled}
          onValueChange={setThreshold}
          onValueCommit={commitThreshold}
          disabled={pending}
          showTicks
          ariaLabel={t("filtering.fields.general_threshold")}
        />
        <div className="text-muted-foreground flex justify-between text-[11px]">
          <span>
            {MIN_THRESHOLD}% · {t("filtering.risk.min_safe")}
          </span>
          <span>
            {RECOMMENDED_THRESHOLD}% ·{" "}
            {profile.hitl_enabled
              ? t("filtering.risk.recommended")
              : t("filtering.risk.max_no_hitl")}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <LegendDot className="bg-emerald-500" label={t("filtering.risk.legend_clean")} />
          <LegendDot className="bg-red-500" label={t("filtering.risk.legend_risky")} />
          {profile.hitl_enabled && (
            <LegendDot className="bg-slate-400" label={t("filtering.risk.legend_hitl")} />
          )}
        </div>
      </section>

      {/* Model */}
      <section className="space-y-1.5 border-t pt-5">
        <Label className="text-sm font-medium">{t("filtering.fields.ai_model")}</Label>
        <p className="text-muted-foreground text-xs">{t("filtering.risk.model_hint")}</p>
        <SelectField
          className="w-[320px] max-w-full"
          value={profile.ai_model_id ?? ""}
          options={
            profile.ai_model_id &&
            !models.isLoading &&
            !models.options.some((o) => o.value === profile.ai_model_id)
              ? [
                  ...models.options,
                  {
                    value: profile.ai_model_id,
                    label: t("filtering.profiles.unknown_model", {
                      id: profile.ai_model_id.slice(0, 8),
                    }),
                  },
                ]
              : models.options
          }
          placeholder={models.isLoading ? t("common.loading") : t("filtering.general.pick_model")}
          onChange={(v) => {
            // Not nullable on the wire: a model can be changed, not cleared.
            if (!v || v === profile.ai_model_id) return;
            void save({ ai_model_id: v }).catch(() => {});
          }}
        />
      </section>

      {/* Context */}
      <section className="space-y-1.5 border-t pt-5">
        <Label htmlFor="risk-context" className="text-sm font-medium">
          {t("filtering.fields.context")}
        </Label>
        <p className="text-muted-foreground text-xs">{t("filtering.general.context_hint")}</p>
        <Textarea
          id="risk-context"
          rows={4}
          maxLength={CONTEXT_MAX}
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {context.length} / {CONTEXT_MAX}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!contextDirty || pending}
              onClick={() => setContext(profile.context ?? "")}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!contextDirty || pending}
              onClick={() => void save({ context }).catch(() => {})}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {t("common.save")}
            </Button>
          </div>
        </div>
      </section>

      <DangerZone>
        <FlagSwitch
          id="risk-hitl"
          label={t("filtering.fields.hitl_enabled")}
          description={t("filtering.general.hitl_enabled_hint")}
          warning={t("filtering.danger.hitl_off")}
          confirmNote={
            profile.general_threshold > HITL_OFF_MAX_THRESHOLD
              ? t("filtering.danger.hitl_threshold_drop", { max: HITL_OFF_MAX_THRESHOLD })
              : undefined
          }
          checked={profile.hitl_enabled}
          onChange={(enabled) =>
            save(
              // One request, so the profile is never stored with HITL off and
              // a threshold the server would refuse.
              !enabled && profile.general_threshold > HITL_OFF_MAX_THRESHOLD
                ? { hitl_enabled: false, general_threshold: HITL_OFF_MAX_THRESHOLD }
                : { hitl_enabled: enabled }
            )
          }
        />
        <FlagSwitch
          id="risk-rewrite"
          label={t("filtering.fields.rewrite_enabled")}
          description={t("filtering.general.rewrite_enabled_hint")}
          warning={t("filtering.danger.rewrite_off")}
          checked={profile.rewrite_enabled}
          onChange={(enabled) => save({ rewrite_enabled: enabled })}
        />
      </DangerZone>
    </SectionCard>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}
