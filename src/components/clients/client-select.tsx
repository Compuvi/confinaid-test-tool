/**
 * Compact client picker for the Playground: "No client" (the field is left
 * out of the request) or one of the company's active clients. Listing needs
 * `clients_read`; without it the picker is disabled and says why.
 */

import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";

import { SelectField } from "@/components/filtering/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAllActiveClients } from "@/lib/api/hooks/use-clients";
import { isScopeError } from "@/lib/filtering/errors";
import { cn } from "@/lib/utils";

export function ClientSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  /** Selected client id, "" for none. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const clients = useAllActiveClients();

  const options = (clients.data?.items ?? []).map((c) => ({
    value: c.id,
    label: c.external_id ? `${c.name} (${c.external_id})` : c.name,
  }));
  // A client deactivated or deleted since it was picked stays visible, so the
  // request preview never shows an id the picker hides.
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: value });
  }

  const unavailable = clients.isError;
  const hint = unavailable
    ? isScopeError(clients.error)
      ? t("clients.picker.no_scope")
      : t("clients.picker.load_failed")
    : clients.data?.truncated
      ? t("clients.picker.truncated", { shown: options.length, count: clients.data.count })
      : t("clients.picker.hint");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5", className)}>
          <Building2 className="text-muted-foreground size-3.5 shrink-0" />
          <SelectField
            className="h-8 w-56 text-xs"
            value={unavailable ? "" : value}
            onChange={onChange}
            allowNone
            noneLabel={t("clients.picker.none")}
            options={options}
            disabled={disabled || unavailable || clients.isPending}
            id="playground-client"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
