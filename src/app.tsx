import { useState } from "react";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider, useTheme } from "@/providers/theme-provider";
import { SplashScreen } from "@/pages/splash";
import { router } from "@/router";

/** Toaster needs the resolved theme, so it sits inside ThemeProvider. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} richColors position="bottom-right" />;
}

/**
 * Inner app — rendered inside the providers.
 *
 * Shows the splash screen EXCLUSIVELY first (nothing else mounted behind it),
 * then swaps to the main app once the splash fades out — exactly like the
 * desktop app's UpdaterModal → main window flow.
 */
function InnerApp() {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onComplete={() => setSplashDone(true)} />;
  }

  return (
    <>
      <RouterProvider router={router} />
      <ThemedToaster />
    </>
  );
}

export function App() {
  return (
    <QueryProvider>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <InnerApp />
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
