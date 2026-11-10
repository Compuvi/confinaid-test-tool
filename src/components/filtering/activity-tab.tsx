import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, KeyRound, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProfileCollection } from "@/lib/api/hooks/use-filtering";
import { formatDateTime } from "@/lib/filtering/format";
import {
  LOG_ACTIONS,
  LOG_ENTITIES,
  type FilteringLog,
  type FilteringLogChange,
  type FilteringProfile,
} from "@/types/filtering";

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
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("filtering.tabs.activity")}</h3>
        <p className="text-muted-foreground text-xs">{t("filtering.activity.description")}</p>
      </div>
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
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          {t("filtering.activity.empty")}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("filtering.activity.when")}</TableHead>
                <TableHead>{t("filtering.activity.what")}</TableHead>
                <TableHead>{t("filtering.activity.changes")}</TableHead>
                <TableHead className="w-44">{t("filtering.activity.actor")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((log) => (
                <TableRow key={log.id} className="align-top">
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDateTime(log.created_at, i18n.language)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary">
                        {t(`filtering.log_action.${log.action}`, { defaultValue: log.action })}
                      </Badge>
                      <Badge variant="outline">
                        {t(`filtering.log_entity.${log.entity}`, { defaultValue: log.entity })}
                      </Badge>
                    </div>
                    {log.target_repr && (
                      <p className="mt-1 max-w-[220px] truncate text-xs" title={log.target_repr}>
                        {log.target_repr}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <Changes changes={log.changes ?? []} />
                  </TableCell>
                  <TableCell>
                    <Actor log={log} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
    </div>
  );
}

function Changes({ changes }: { changes: FilteringLogChange[] }) {
  if (changes.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
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
