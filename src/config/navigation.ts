import {
  Activity,
  BookOpen,
  FileBarChart,
  FlaskConical,
  Gauge,
  PlugZap,
  Send,
  Settings2,
  Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  to: string;
  /** Key within `nav.*` in the translation files. */
  labelKey: string;
  /** Shown in the header under the page title (English fallback, header uses i18n too). */
  descriptionKey: string;
  icon: LucideIcon;
};

/**
 * Single source of truth for navigation. The sidebar renders it and the header
 * resolves the current title from it, so the two cannot drift.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/connection",
    labelKey: "connection",
    descriptionKey: "connection",
    icon: PlugZap,
  },
  {
    to: "/requests",
    labelKey: "requests",
    descriptionKey: "requests",
    icon: Send,
  },
  {
    to: "/playground",
    labelKey: "playground",
    descriptionKey: "playground",
    icon: Shield,
  },
  {
    to: "/suites",
    labelKey: "suites",
    descriptionKey: "suites",
    icon: FlaskConical,
  },
  {
    to: "/load",
    labelKey: "load",
    descriptionKey: "load",
    icon: Gauge,
  },
  {
    to: "/reports",
    labelKey: "reports",
    descriptionKey: "reports",
    icon: FileBarChart,
  },
  {
    to: "/monitoring",
    labelKey: "monitoring",
    descriptionKey: "monitoring",
    icon: Activity,
  },
  {
    to: "/docs",
    labelKey: "docs",
    descriptionKey: "docs",
    icon: BookOpen,
  },
  {
    to: "/settings",
    labelKey: "settings",
    descriptionKey: "settings",
    icon: Settings2,
  },
] as const;

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname.startsWith(item.to));
}
