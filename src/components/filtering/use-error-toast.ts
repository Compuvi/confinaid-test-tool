import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isRateLimitedError } from "@/lib/api/errors";
import { describeError, isFilteringApiError, isScopeError } from "@/lib/filtering/errors";

/**
 * Toast for a failed mutation. `inline` names the fields the form already
 * shows next to their inputs, so they are not repeated in the toast.
 */
export function useErrorToast() {
  const { t } = useTranslation();
  return (error: unknown, inline: readonly string[] = []) => {
    if (isScopeError(error)) {
      toast.error(t("filtering.scope.title"), { description: t("filtering.scope.toast") });
      return;
    }
    if (isRateLimitedError(error)) {
      const seconds = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : null;
      toast.error(
        seconds
          ? t("filtering.errors.rate_limited_retry", { seconds })
          : t("filtering.errors.rate_limited")
      );
      return;
    }
    const [message, ...rest] = describeError(error, inline);
    const known = isFilteringApiError(error) ? knownCodeMessage(error.apiCode, t) : null;
    toast.error(known ?? message, {
      description: rest.length > 0 ? rest.join("\n") : known ? message : undefined,
    });
  };
}

function knownCodeMessage(code: string, t: (k: string) => string): string | null {
  switch (code) {
    case "primary_profile_locked":
      return t("filtering.errors.primary_profile_locked");
    case "limit_reached":
      return t("filtering.errors.limit_reached");
    case "not_found":
      return t("filtering.errors.not_found");
    case "conflict":
      return t("filtering.errors.conflict");
    case "validation_failed":
      return t("filtering.errors.validation_failed");
    case "invalid_response":
      return t("filtering.errors.invalid_response");
    default:
      return null;
  }
}
