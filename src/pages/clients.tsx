/**
 * Clients page — manage the end customers ("clients") of the active
 * credential's company through the Partner API (`/v1/clients*`). Calls go
 * through the `clients_request` Rust command, which validates every path and
 * attaches the bearer token.
 *
 * A client can carry its own filtering profile; an analysis sent with its
 * `client_id` (Playground, Requests) is filtered under that profile and
 * attributed to the client in the Confinaid dashboard.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Building2, Loader2, Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import {
  ConfirmDialog,
  PaginationBar,
  QueryError,
  SearchInput,
  SelectField,
} from "@/components/filtering/shared";
import { useErrorToast } from "@/components/filtering/use-error-toast";
import { useStoredCredentials } from "@/lib/api";
import {
  useClients,
  useClientsScope,
  useCreateClient,
  useDeleteClient,
  useFetchClient,
  useUpdateClient,
} from "@/lib/api/hooks/use-clients";
import {
  CLIENT_INLINE_FIELDS,
  buildClientCreate,
  buildClientPatch,
  clientToDraft,
  emptyClientDraft,
  validateClientDraft,
  type ClientDraft,
} from "@/lib/clients/payload";
import { clampPage } from "@/lib/filtering/client";
import { fieldErrorsOf, splitFieldErrors } from "@/lib/filtering/errors";
import { formatDateTime } from "@/lib/filtering/format";
import type { Client } from "@/types/clients";

const PAGE_SIZE = 25;

type Editing = { item: Client | null; original: ClientDraft; draft: ClientDraft };

export function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const credentials = useStoredCredentials();
  const cred = useClientsScope();

  if (credentials.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!cred) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="bg-muted rounded-full p-4">
          <PlugZap className="text-muted-foreground size-8" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="font-medium">{t("clients.no_credential.title")}</p>
          <p className="text-muted-foreground text-sm">{t("clients.no_credential.body")}</p>
        </div>
        <Button onClick={() => void navigate("/connection")}>
          {t("clients.no_credential.action")}
        </Button>
      </div>
    );
  }

  // Remount per credential: page, filters and open dialogs belong to one company.
  return <ClientsManager key={cred} />;
}

function ClientsManager() {
  const { t, i18n } = useTranslation();
  const showError = useErrorToast("clients");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isActive, setIsActive] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Client | null>(null);
  const [errors, setErrors] = useState(splitFieldErrors(null));

  const list = useClients({
    page,
    pageSize: PAGE_SIZE,
    search,
    isActive: isActive === "" ? undefined : isActive === "true",
    ordering: "name",
  });
  const fetchClient = useFetchClient();
  const create = useCreateClient();
  const update = useUpdateClient();
  const remove = useDeleteClient();

  // A delete can shrink the list below the current page.
  const count = list.data?.count;
  if (count !== undefined && !list.isPlaceholderData) {
    const clamped = clampPage(page, count, PAGE_SIZE);
    if (clamped !== page) setPage(clamped);
  }

  const onSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  const openCreate = () => {
    const d = emptyClientDraft();
    setErrors(splitFieldErrors(null));
    setEditing({ item: null, original: d, draft: d });
  };

  /**
   * Edit what the server holds now: the list row may be stale, and the PATCH
   * is a diff against `original`. A failure (typically 404, deleted
   * elsewhere) refreshes the list instead of opening the dialog.
   */
  const openEdit = async (item: Client) => {
    setOpening(item.id);
    try {
      const fresh = await fetchClient(item.id);
      const d = clientToDraft(fresh);
      setErrors(splitFieldErrors(null));
      setEditing({ item: fresh, original: d, draft: d });
    } catch (err) {
      showError(err);
      void list.refetch();
    } finally {
      setOpening(null);
    }
  };

  const setDraft = (fn: (d: ClientDraft) => ClientDraft) =>
    setEditing((e) => (e ? { ...e, draft: fn(e.draft) } : e));

  const submit = async () => {
    if (!editing) return;
    const local = validateClientDraft(editing.draft, {
      required: t("filtering.validation.required"),
      uuid: t("filtering.validation.uuid"),
      tooLong: (max) => t("clients.validation.too_long", { max }),
    });
    if (Object.keys(local).length > 0) {
      setErrors(splitFieldErrors(local));
      return;
    }
    try {
      if (editing.item === null) {
        const created = await create.mutateAsync(buildClientCreate(editing.draft));
        toast.success(t("clients.toasts.created", { name: created.name }));
      } else {
        const body = buildClientPatch(editing.original, editing.draft);
        if (Object.keys(body).length === 0) {
          toast.info(t("filtering.common.no_changes"));
          setEditing(null);
          return;
        }
        await update.mutateAsync({ id: editing.item.id, body });
        toast.success(t("filtering.common.saved"));
      }
      setEditing(null);
    } catch (err) {
      setErrors(splitFieldErrors(fieldErrorsOf(err)));
      showError(err, CLIENT_INLINE_FIELDS);
    }
  };

  const toggleActive = async (item: Client, value: boolean) => {
    try {
      await update.mutateAsync({ id: item.id, body: { is_active: value } });
    } catch (err) {
      showError(err);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success(t("filtering.common.deleted", { name: toDelete.name }));
      setToDelete(null);
    } catch (err) {
      showError(err);
    }
  };

  const data = list.data;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("clients.title")}</h2>
          <p className="text-muted-foreground max-w-2xl text-xs">{t("clients.intro")}</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          {t("clients.new")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput onSearch={onSearch} placeholder={t("clients.search")} className="w-64" />
        <SelectField
          className="h-8 w-44"
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
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} scopeVariant="clients" />
      ) : list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : data && data.results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
          <Building2 className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-sm">
            {search || isActive ? t("clients.no_match") : t("clients.none")}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("clients.columns.name")}</TableHead>
                <TableHead>{t("clients.columns.external_id")}</TableHead>
                <TableHead>{t("clients.columns.profile")}</TableHead>
                <TableHead>{t("clients.columns.id")}</TableHead>
                <TableHead>{t("clients.columns.updated")}</TableHead>
                <TableHead className="w-24">{t("filtering.common.active")}</TableHead>
                <TableHead className="w-24 text-right">{t("filtering.common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.results.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      {c.logo_url ? (
                        <img
                          src={c.logo_url}
                          alt=""
                          className="size-7 shrink-0 rounded object-contain"
                        />
                      ) : (
                        <div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded">
                          <Building2 className="text-muted-foreground size-3.5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {c.description && (
                          <p className="text-muted-foreground max-w-xs truncate text-xs">
                            {c.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.external_id || "—"}</TableCell>
                  <TableCell>
                    {c.filtering_profile_id ? (
                      <span className="text-sm">
                        {c.filtering_profile_title || c.filtering_profile_id}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground font-normal">
                        {t("clients.profile_fallback")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground font-mono text-xs">
                        {c.id.slice(0, 8)}…
                      </span>
                      <CopyButton text={c.id} aria-label={t("clients.copy_id")} />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(c.updated_at, i18n.language)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={(v) => void toggleActive(c, v)}
                      aria-label={t("filtering.common.toggle_active")}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void openEdit(c)}
                        disabled={opening !== null}
                        aria-label={t("filtering.common.edit")}
                      >
                        {opening === c.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Pencil className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:text-destructive"
                        onClick={() => setToDelete(c)}
                        aria-label={t("filtering.common.delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
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

      <ClientFormDialog
        open={editing !== null}
        editing={editing?.item ?? null}
        draft={editing?.draft ?? emptyClientDraft()}
        setDraft={setDraft}
        errors={errors}
        pending={create.isPending || update.isPending}
        onSubmit={() => void submit()}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("clients.delete.title")}
        description={t("clients.delete.body", { name: toDelete?.name ?? "" })}
        confirmLabel={t("filtering.common.delete")}
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
