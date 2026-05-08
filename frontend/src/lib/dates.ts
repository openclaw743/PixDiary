/**
 * Date helpers used across the four screens.
 *
 * Single source of truth for the date strings we send the backend and the
 * human-readable labels we show. Kept dependency-free — Date + Intl only.
 */

/** YYYY-MM-DD for the given date in the given timezone (default user-local). */
export function toIsoDate(date: Date, timeZone?: string): string {
  // en-CA produces YYYY-MM-DD which is what the backend wants.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** "Friday, May 8" / "Friday, May 8 2026" — used for headings. */
export function formatLongDate(
  isoDate: string,
  opts: { withYear?: boolean; timeZone?: string } = {},
): string {
  const d = parseIsoDate(isoDate);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: opts.timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(opts.withYear ? { year: 'numeric' } : {}),
  }).format(d);
}

/** "May 2026" — calendar header label. */
export function formatMonthYear(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** Human time — "14:23". */
export function formatShortTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Parse YYYY-MM-DD as a local-noon Date so DST shifts can never bump it to
 * the previous day.
 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Get the index Monday=0..Sunday=6 from a JS getDay() (Sunday=0..Saturday=6). */
export function mondayFirstWeekday(jsDay: number): number {
  return (jsDay + 6) % 7;
}
