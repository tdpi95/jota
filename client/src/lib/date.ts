// Small date helpers shared by task due-badges and the journal day page.
// Deliberately string-based (YYYY-MM-DD) rather than routing through `Date`
// where avoidable — the vault's own date fields are plain strings and local
// timezone parsing of a bare "YYYY-MM-DD" is a classic off-by-one-day trap.

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type DueUrgency = 'overdue' | 'today' | 'later';

export function dueUrgency(due: string, today: string = todayStr()): DueUrgency {
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'later';
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Vietnamese has no distinct abbreviated month-name convention comparable to
// "Jan"/"Feb" — "Tháng 1" ("Month 1") is both the full and the short form in
// everyday use, so the same array covers both `formatDateLong` and
// `formatDueShort`/`monthShortLabel` below.
const MONTH_NAMES_VI = [
  'Tháng 1',
  'Tháng 2',
  'Tháng 3',
  'Tháng 4',
  'Tháng 5',
  'Tháng 6',
  'Tháng 7',
  'Tháng 8',
  'Tháng 9',
  'Tháng 10',
  'Tháng 11',
  'Tháng 12',
];

export type UiLanguage = 'en' | 'vi';

/** Month label for UI language, e.g. `monthLabel(8, 'en', true) === 'Sep'`,
 * `monthLabel(8, 'vi', true) === 'Tháng 9'`. `short` only shortens English
 * (see MONTH_NAMES_VI comment above for why Vietnamese doesn't abbreviate). */
function monthLabel(month: number, language: UiLanguage, short: boolean): string {
  if (language === 'vi') return MONTH_NAMES_VI[month];
  return short ? MONTH_NAMES[month].slice(0, 3) : MONTH_NAMES[month];
}

/** "Sep 2026" / "Tháng 9 2026" — used directly by CalendarSidebar's month
 * header (it doesn't go through formatDueShort/formatDateLong). */
export function monthShortLabel(month: number, language: UiLanguage = 'en'): string {
  return monthLabel(month, language, true);
}

/** "2026-09-10" -> "Sep 10" (badges) / "10 Tháng 9" in Vietnamese, matching
 * each language's natural day/month order. */
export function formatDueShort(due: string, language: UiLanguage = 'en'): string {
  const [, m, d] = due.split('-').map(Number);
  const label = monthLabel(m - 1, language, true);
  return language === 'vi' ? `${d} ${label}` : `${label} ${d}`;
}

/** "2026-09-10" -> "Thursday, September 10, 2026" (journal day header), or
 * "Thứ Năm, 10 Tháng 9, 2026" in Vietnamese. Weekday name comes from
 * `Intl`/`toLocaleDateString` (which already knows Vietnamese weekday names)
 * rather than a hand-rolled list. */
export function formatDateLong(date: string, language: UiLanguage = 'en'): string {
  const [y, m, d] = date.split('-').map(Number);
  const asDate = new Date(y, m - 1, d);
  const weekday = asDate.toLocaleDateString(language === 'vi' ? 'vi' : undefined, { weekday: 'long' });
  const label = monthLabel(m - 1, language, false);
  return language === 'vi' ? `${weekday}, ${d} ${label}, ${y}` : `${weekday}, ${label} ${d}, ${y}`;
}

/** Adds `delta` days to a YYYY-MM-DD string, staying in local calendar days
 * (not UTC) so journal day navigation never skips/repeats a day across a DST
 * boundary. */
export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + delta);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export function yearOf(date: string): string {
  return date.slice(0, 4);
}

function toLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Full ISO8601 timestamp (a git commit date, or a `lastSyncedAt`) -> a
 * short local date+time string, e.g. "Sep 10, 2:14 PM" — used by
 * `HistoryPanel` and the Settings page's sync status, neither of which
 * needs the full date-only string handling the rest of this file is built
 * around (these values are real instants, not bare YYYY-MM-DD strings). */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD), in local calendar days —
 * same local-`Date` convention as the rest of this file, not a UTC parse.
 * Used by the Dashboard to bucket open tasks into today/overdue/this-week. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toLocalDate(b).getTime() - toLocalDate(a).getTime()) / 86_400_000);
}
