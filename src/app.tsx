import { RouterProvider } from "react-router";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { useTheme } from "@/providers/theme-provider";
import { router } from "@/router";

/** Toaster needs the resolved theme, so it sits inside ThemeProvider. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} richColors position="bottom-right" />;
}

export function App() {
  return (
    <QueryProvider>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
