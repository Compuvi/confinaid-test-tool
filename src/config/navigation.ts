import { FileBarChart, FlaskConical, Gauge, PlugZap, Send, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  /** Shown in the header under the page title. */
  description: string;
  icon: LucideIcon;
};

/**
 * Single source of truth for navigation. The sidebar renders it and the header
 * resolves the current title from it, so the two cannot drift.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/connection",
    label: "Connection",
    description: "API credentials and endpoint configuration",
    icon: PlugZap,
  },
  {
    to: "/requests",
    label: "Requests",
    description: "Send single or bulk requests against the Confinaid API",
    icon: Send,
  },
  {
    to: "/suites",
    label: "Test Suites",
    description: "Saved test cases with assertions",
    icon: FlaskConical,
  },
  {
    to: "/load",
    label: "Load & Rate Limit",
    description: "Throughput, latency, and throttling behaviour",
    icon: Gauge,
  },
  {
    to: "/reports",
    label: "Reports",
    description: "Past runs and exportable results",
    icon: FileBarChart,
  },
  {
    to: "/settings",
    label: "Settings",
    description: "Appearance and application preferences",
    icon: Settings2,
  },
] as const;

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname.startsWith(item.to));
}
