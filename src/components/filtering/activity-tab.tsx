import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  History,
  KeyRound,
  Minus,
  Pencil,
  Plus,
  ToggleLeft,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileCollection } from "@/lib/api/hooks/use-filtering";
import { formatDateTime } from "@/lib/filtering/format";
import {
  LOG_ACTIONS,
  LOG_ENTITIES,
  type FilteringLog,
  type FilteringLogChange,
  type FilteringProfile,
} from "@/types/filtering";

import { SectionCard } from "./chrome";
import { PaginationBar, QueryError, SelectField } from "./shared";

const PAGE_SIZE = 25;

/** `YYYY-MM-DD` from a date input -> ISO date-time at the start/end of that local day. */
function dayBound(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function ActivityTab({ profile }: { profile: FilteringProfile }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");

  const list = useProfileCollection<FilteringLog>(profile.id, "logs", {
    page,
    pageSize: PAGE_SIZE,
    action,
    entity,
    created_after: dayBound(after, false),
    created_before: dayBound(before, true),
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <SectionCard
      icon={History}
      title={t("filtering.activity.title")}
      description={t("filtering.activity.description")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          className="h-8 w-44"
          value={action}
          onChange={reset(setAction)}
          allowNone
          noneLabel={t("filtering.activity.all_actions")}
          options={LOG_ACTIONS.map((a) => ({ value: a, label: t(`filtering.log_action.${a}`) }))}
        />
        <SelectField
          className="h-8 w-44"
          value={entity}
          onChange={reset(setEntity)}
          allowNone
          noneLabel={t("filtering.activity.all_entities")}
          options={LOG_ENTITIES.map((e) => ({ value: e, label: t(`filtering.log_entity.${e}`) }))}
        />
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {t("filtering.activity.from")}
          <Input
            type="date"
            className="h-8 w-36 text-xs"
            value={after}
            onChange={(e) => reset(setAfter)(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {t("filtering.activity.to")}
          <Input
            type="date"
            className="h-8 w-36 text-xs"
            value={before}
            onChange={(e) => reset(setBefore)(e.target.value)}
          />
        </label>
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : list.data.results.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-sm">
          <History className="size-8 opacity-40" />
          {t("filtering.activity.empty")}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.data.results.map((log) => {
            const { icon: ActionIcon, tone } = actionStyle(log.action);
            const when = new Date(log.created_at);
            return (
              <li key={log.id} className="flex gap-4 px-4 py-3">
                <div className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
                  <p>
                    {Number.isNaN(when.getTime())
                      ? "—"
                      : when.toLocaleTimeString(i18n.language, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </p>
                  <p className="text-[10px]">
                    {Number.isNaN(when.getTime()) ? "" : when.toLocaleDateString(i18n.language)}
                  </p>
                </div>
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tone}`}
                >
                  <ActionIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Badge variant="secondary">
                      {t(`filtering.log_action.${log.action}`, { defaultValue: log.action })}
                    </Badge>
                    <Badge variant="outline">
                      {t(`filtering.log_entity.${log.entity}`, { defaultValue: log.entity })}
                    </Badge>
                    {log.target_repr && (
                      <span className="truncate font-medium" title={log.target_repr}>
                        {log.target_repr}
                      </span>
                    )}
                  </div>
                  <Changes changes={log.changes ?? []} />
                </div>
                <div
                  className="w-44 shrink-0"
                  title={formatDateTime(log.created_at, i18n.language)}
                >
                  <Actor log={log} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.data && list.data.count > 0 && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          count={list.data.count}
          onPageChange={setPage}
          busy={list.isFetching}
        />
      )}
    </SectionCard>
  );
}

/** The round icon and colour of a change, by action. */
function actionStyle(action: string): { icon: LucideIcon; tone: string } {
  if (action === "created" || action === "added" || action === "restored")
    return { icon: Plus, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
  if (action === "deleted" || action === "removed")
    return { icon: Minus, tone: "bg-red-500/10 text-red-600 dark:text-red-400" };
  if (action === "enabled" || action === "disabled" || action === "bypassed")
    return { icon: ToggleLeft, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" };
  return { icon: Pencil, tone: "bg-primary/10 text-primary" };
}

function Changes({ changes }: { changes: FilteringLogChange[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {changes.map((c, i) => (
        <li key={i} className="break-words">
          <span className="font-mono">{c.field}</span>:{" "}
          <span className="text-muted-foreground line-through">{show(c.old)}</span>{" "}
          <span aria-hidden>→</span> <span>{show(c.new)}</span>
        </li>
      ))}
    </ul>
  );
}

function Actor({ log }: { log: FilteringLog }) {
  const { t } = useTranslation();
  const Icon =
    log.actor_type === "api_credential" ? KeyRound : log.actor_type === "user" ? UserRound : Bot;
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <p>{t(`filtering.actor_type.${log.actor_type}`, { defaultValue: log.actor_type })}</p>
        {log.actor_name && (
          <p className="text-muted-foreground truncate font-mono" title={log.actor_name}>
            {log.actor_name}
          </p>
        )}
      </div>
    </div>
  );
}
