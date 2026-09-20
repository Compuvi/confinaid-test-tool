import { Link, useRouteError } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const error = useRouteError();
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="text-lg font-semibold">{t("not_found.title")}</h1>
      {error instanceof Error && (
        <p className="text-muted-foreground max-w-md text-sm">{error.message}</p>
      )}
      <Button asChild variant="outline">
        <Link to="/connection">{t("not_found.back")}</Link>
      </Button>
    </div>
  );
}
