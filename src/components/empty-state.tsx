import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What this page will do once the feature lands. */
  planned?: readonly string[];
};

export function EmptyState({ icon: Icon, title, description, planned }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="bg-muted text-muted-foreground rounded-full p-3">
          <Icon className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground max-w-md text-sm">{description}</p>
        </div>
        {planned && planned.length > 0 && (
          <ul className="text-muted-foreground space-y-1 text-sm">
            {planned.map((entry) => (
              <li key={entry}>· {entry}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
