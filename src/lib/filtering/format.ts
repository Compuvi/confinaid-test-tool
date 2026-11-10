/** `2026-11-10T12:00:00Z` -> locale date-time; falls back to the raw value. */
export function formatDateTime(value: string | null | undefined, locale?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(locale);
}
