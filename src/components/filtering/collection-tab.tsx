/**
 * Generic list + create/edit dialog for one profile collection (keywords,
 * codenames, keyword groups, label settings, bypass rules).
 *
 * Handles pagination, search, filters, the inline is_active toggle, the
 * create/edit dialog with inline field errors, and (where the API allows it)
 * a confirmed delete. Each tab supplies its columns, draft conversion and
 * form body.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCollectionMutations, useProfileCollection } from "@/lib/api/hooks/use-filtering";
import { clampPage } from "@/lib/filtering/client";
import { fieldErrorsOf, splitFieldErrors, type SplitFieldErrors } from "@/lib/filtering/errors";
import type { FilteringProfile, Page, ProfileCollection } from "@/types/filtering";

import {
  ConfirmDialog,
  FormAlert,
  PaginationBar,
  QueryError,
  SearchInput,
  SelectField,
  type Option,
} from "./shared";
import { useErrorToast } from "./use-error-toast";

const PAGE_SIZE = 25;

export type FilterDef = { key: string; label: string; options: Option[] };

export type Column<T> = { header: string; cell: (item: T) => ReactNode; className?: string };

export type FormRenderProps<D> = {
  draft: D;
  setDraft: (update: (d: D) => D) => void;
  errors: SplitFieldErrors;
  /** E.g. to re-index nested condition errors when a condition is removed. */
  setErrors: (update: (e: SplitFieldErrors) => SplitFieldErrors) => void;
  isNew: boolean;
};

type Props<T extends { id: string; is_active: boolean }, D, W extends object> = {
  profile: FilteringProfile;
  collection: Exclude<ProfileCollection, "logs">;
  title: string;
  description?: string;
  searchable?: boolean;
  filters?: FilterDef[];
  columns: Column<T>[];
  emptyDraft: () => D;
  toDraft: (item: T) => D;
  buildCreate: (d: D) => W;
  buildPatch: (original: D, draft: D) => Partial<W>;
  /** Extra client-side checks; returns field -> messages. */
  validate?: (d: D, isNew: boolean) => Record<string, string[]>;
  renderForm: (p: FormRenderProps<D>) => ReactNode;
  /** Fields the form renders inline (`conditions[]` for nested conditions). */
  inlineFields: readonly string[];
  itemName: (item: T) => string;
  canDelete: boolean;
  dialogClassName?: string;
  toolbarExtra?: ReactNode;
};

export function CollectionTab<T extends { id: string; is_active: boolean }, D, W extends object>(
  props: Props<T, D, W>
) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { profile, collection } = props;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const params = {
    page,
    pageSize: PAGE_SIZE,
    ...(props.searchable ? { search } : {}),
    is_active: isActive,
    ...filterValues,
  };
  const list = useProfileCollection<T>(profile.id, collection, params);
  const { create, update, remove } = useCollectionMutations<T, W>(profile.id, collection);

  const onSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<{ item: T | null; original: D; draft: D } | null>(null);
  const [errors, setErrors] = useState<SplitFieldErrors>(splitFieldErrors(null));
  const [toDelete, setToDelete] = useState<T | null>(null);

  const openCreate = () => {
    const d = props.emptyDraft();
    setErrors(splitFieldErrors(null));
    setEditing({ item: null, original: d, draft: d });
  };
  const openEdit = (item: T) => {
    const d = props.toDraft(item);
    setErrors(splitFieldErrors(null));
    setEditing({ item, original: d, draft: d });
  };
  const setDraft = (fn: (d: D) => D) => setEditing((e) => (e ? { ...e, draft: fn(e.draft) } : e));

  const submit = async () => {
    if (!editing) return;
    const isNew = editing.item === null;
    const local = props.validate?.(editing.draft, isNew) ?? {};
    if (Object.keys(local).length > 0) {
      setErrors(splitFieldErrors(local));
      return;
    }
    try {
      if (isNew) {
        await create.mutateAsync(props.buildCreate(editing.draft));
        toast.success(t("filtering.common.created"));
      } else {
        const body = props.buildPatch(editing.original, editing.draft);
        if (Object.keys(body).length === 0) {
          toast.info(t("filtering.common.no_changes"));
          setEditing(null);
          return;
        }
        await update.mutateAsync({ id: editing.item!.id, body });
        toast.success(t("filtering.common.saved"));
      }
      setEditing(null);
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, props.inlineFields);
    }
  };

  const toggleActive = async (item: T, value: boolean) => {
    try {
      await update.mutateAsync({
        id: item.id,
        body: { is_active: value } as unknown as Partial<W>,
      });
    } catch (err) {
      showError(err);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success(t("filtering.common.deleted", { name: props.itemName(toDelete) }));
      setToDelete(null);
      const remaining = (list.data?.count ?? 1) - 1;
      setPage((p) => clampPage(p, remaining, PAGE_SIZE));
    } catch (err) {
      showError(err);
    }
  };

  const data: Page<T> | undefined = list.data;
  const pending = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{props.title}</h3>
          {props.description && (
            <p className="text-muted-foreground text-xs">{props.description}</p>
          )}
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          {t("filtering.common.add")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {props.searchable && (
          <SearchInput
            onSearch={onSearch}
            placeholder={t("filtering.common.search")}
            className="w-56"
          />
        )}
        <SelectField
          className="h-8 w-40"
          value={isActive}
          onChange={(v) => {
            setIsActive(v);
            setPage(1);
          }}
          allowNone
          noneLabel={t("filtering.common.all_states")}
          options={[
            { value: "true", label: t("filtering.common.active") },
            { value: "false", label: t("filtering.common.inactive") },
          ]}
        />
        {props.filters?.map((f) => (
          <SelectField
            key={f.key}
            className="h-8 w-44"
            value={filterValues[f.key] ?? ""}
            onChange={(v) => {
              setFilterValues((prev) => ({ ...prev, [f.key]: v }));
              setPage(1);
            }}
            allowNone
            noneLabel={f.label}
            options={f.options}
          />
        ))}
        {props.toolbarExtra}
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : data && data.results.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          {t("filtering.common.empty")}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {props.columns.map((c) => (
                  <TableHead key={c.header} className={c.className}>
                    {c.header}
                  </TableHead>
                ))}
                <TableHead className="w-24">{t("filtering.common.active")}</TableHead>
                <TableHead className="w-24 text-right">{t("filtering.common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.results.map((item) => (
                <TableRow key={item.id}>
                  {props.columns.map((c) => (
                    <TableCell key={c.header} className={c.className}>
                      {c.cell(item)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(v) => void toggleActive(item, v)}
                      aria-label={t("filtering.common.toggle_active")}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(item)}
                        aria-label={t("filtering.common.edit")}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {props.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          onClick={() => setToDelete(item)}
                          aria-label={t("filtering.common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.count > 0 && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          count={data.count}
          onPageChange={setPage}
          busy={list.isFetching}
        />
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !pending && setEditing(null)}>
        <DialogContent className={props.dialogClassName ?? "sm:max-w-xl"}>
          <DialogHeader>
            <DialogTitle>
              {editing?.item ? t("filtering.common.edit_title") : t("filtering.common.add_title")}
            </DialogTitle>
            <DialogDescription>{props.title}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              id={`filtering-${collection}-form`}
              className="max-h-[65vh] space-y-4 overflow-y-auto pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormAlert messages={errors.general} />
              {props.renderForm({
                draft: editing.draft,
                setDraft,
                errors,
                setErrors,
                isNew: editing.item === null,
              })}
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form={`filtering-${collection}-form`}
              disabled={pending}
              className="gap-1.5"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing?.item ? t("common.save") : t("filtering.common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {props.canDelete && (
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
          title={t("filtering.common.delete_title")}
          description={t("filtering.common.delete_body", {
            name: toDelete ? props.itemName(toDelete) : "",
          })}
          confirmLabel={t("filtering.common.delete")}
          pending={remove.isPending}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
