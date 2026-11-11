import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, Plus, SquarePen, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFilteringProfiles } from "@/lib/api/hooks/use-filtering";
import { clampPage } from "@/lib/filtering/client";
import { formatDateTime } from "@/lib/filtering/format";

import { FeatureIcons, HeaderStat, ModelLabel, SectionCard } from "./chrome";
import { thresholdColor } from "./chrome-utils";
import { PaginationBar, QueryError, SearchInput } from "./shared";
import { useAiModelOptions } from "./use-catalog-options";

const PAGE_SIZE = 25;

/**
 * The company's profiles as the web app lists them: one card, a search box and
 * a table (name with its Primary badge and description, risk score, model,
 * region, last update and the six layers as icons). A row opens the profile.
 * The page remounts it per credential scope, which resets page and search.
 */
export function ProfileList({
  onSelect,
  onNew,
}: {
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { t, i18n } = useTranslation();
  const models = useAiModelOptions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const list = useFilteringProfiles({ page, pageSize: PAGE_SIZE, search, ordering: "title" });

  // A delete elsewhere can shrink the list below the current page.
  const count = list.data?.count;
  if (count !== undefined && !list.isPlaceholderData) {
    const clamped = clampPage(page, count, PAGE_SIZE);
    if (clamped !== page) setPage(clamped);
  }

  const onSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  return (
    <SectionCard
      icon={Filter}
      title={t("filtering.profiles.title")}
      description={t("filtering.profiles.list_desc")}
      stats={<HeaderStat label={t("filtering.profiles.total")} value={count ?? "—"} />}
      actions={
        <Button className="gap-1.5" onClick={onNew}>
          <Plus className="size-4" />
          {t("filtering.profiles.new")}
        </Button>
      }
    >
      <SearchInput
        onSearch={onSearch}
        placeholder={t("filtering.profiles.search")}
        className="max-w-sm"
      />

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("filtering.profiles.col.name")}</TableHead>
                <TableHead className="w-28">{t("filtering.profiles.col.threshold")}</TableHead>
                <TableHead>{t("filtering.profiles.col.model")}</TableHead>
                <TableHead>{t("filtering.profiles.col.region")}</TableHead>
                <TableHead className="w-44">{t("filtering.profiles.col.updated")}</TableHead>
                <TableHead>{t("filtering.profiles.col.features")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending ? (
                [0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : list.data.results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
                      <Filter className="size-8 opacity-40" />
                      {search ? t("filtering.profiles.no_match") : t("filtering.profiles.none")}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                list.data.results.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => onSelect(p.id)}>
                    <TableCell className="max-w-[320px]">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.title}</span>
                        {p.is_primary && (
                          <Badge
                            variant="secondary"
                            className="h-5 shrink-0 gap-0.5 px-1.5 text-[10px]"
                          >
                            <Star className="size-2.5" />
                            {t("filtering.profiles.primary")}
                          </Badge>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-muted-foreground line-clamp-1 text-xs">
                          {p.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: thresholdColor(p.general_threshold) }}
                      >
                        {p.general_threshold}%
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.ai_model_id ? (
                        <ModelLabel
                          label={
                            models.options.find((o) => o.value === p.ai_model_id)?.label ??
                            t("filtering.profiles.unknown_model", { id: p.ai_model_id.slice(0, 8) })
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {t("filtering.general.default_model")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.region?.name ?? (
                        <span className="text-muted-foreground">
                          {t("filtering.profiles.no_region")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(p.updated_at, i18n.language)}
                    </TableCell>
                    <TableCell>
                      <FeatureIcons profile={p} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("filtering.common.edit")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(p.id);
                        }}
                      >
                        <SquarePen className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
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
    </SectionCard>
  );
}
