import { createHashRouter, Navigate } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { ConnectionPage } from "@/pages/connection";
import { LoadPage } from "@/pages/load";
import { NotFoundPage } from "@/pages/not-found";
import { ReportsPage } from "@/pages/reports";
import { RequestsPage } from "@/pages/requests";
import { SettingsPage } from "@/pages/settings";
import { SuitesPage } from "@/pages/suites";

/**
 * Hash routing, not browser routing.
 *
 * A packaged Tauri app serves from a custom protocol whose asset resolver does
 * not reliably fall back to index.html for unknown paths, so reloading on
 * /reports can 404. The hash never reaches the protocol handler. The URLs are
 * ugly, but nobody sees them in a desktop window.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <Navigate to="/connection" replace /> },
      { path: "connection", element: <ConnectionPage /> },
      { path: "requests", element: <RequestsPage /> },
      { path: "suites", element: <SuitesPage /> },
      { path: "load", element: <LoadPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
