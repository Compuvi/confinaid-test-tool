import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilteringProfiles } from "@/lib/api/hooks/use-filtering";
import { clampPage } from "@/lib/filtering/client";
import { cn } from "@/lib/utils";

import { PaginationBar, QueryError, SearchInput } from "./shared";

const PAGE_SIZE = 25;

/**
 * Left pane: searchable, paginated list of the company's profiles. The page
 * remounts it per credential scope, which resets page and search.
 */
export function ProfileList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
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
    <div className="flex w-72 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">{t("filtering.profiles.title")}</span>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onNew}>
          <Plus className="size-3" />
          {t("filtering.profiles.new")}
        </Button>
      </div>
      <div className="border-b p-2">
        <SearchInput onSearch={onSearch} placeholder={t("filtering.profiles.search")} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-0.5 p-2">
          {list.isError ? (
            <div className="p-1">
              <QueryError error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : list.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list.data.results.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-xs">
              {search ? t("filtering.profiles.no_match") : t("filtering.profiles.none")}
            </p>
          ) : (
            list.data.results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn(
                  "hover:bg-muted flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
                  selectedId === p.id && "bg-muted"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    {p.is_primary && (
                      <Badge
                        variant="secondary"
                        className="h-4 shrink-0 gap-0.5 px-1.5 text-[10px]"
                      >
                        <Star className="size-2.5" />
                        {t("filtering.profiles.primary")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {p.region?.name ?? t("filtering.profiles.no_region")} ·{" "}
                    {t("filtering.profiles.threshold_short", { value: p.general_threshold })}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      {list.data && list.data.count > 0 && (
        <div className="border-t px-3 py-2">
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            count={list.data.count}
            onPageChange={setPage}
            busy={list.isFetching}
          />
        </div>
      )}
    </div>
  );
}
