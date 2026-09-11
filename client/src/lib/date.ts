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

/** "2026-09-10" -> "Sep 10" (badges) */
export function formatDueShort(due: string): string {
  const [, m, d] = due.split('-').map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}

/** "2026-09-10" -> "Thursday, September 10, 2026" (journal day header) */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const asDate = new Date(y, m - 1, d);
  const weekday = asDate.toLocaleDateString(undefined, { weekday: 'long' });
  return `${weekday}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
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

/** Whole days from `a` to `b` (both YYYY-MM-DD), in local calendar days —
 * same local-`Date` convention as the rest of this file, not a UTC parse.
 * Used by the Dashboard to bucket open tasks into today/overdue/this-week. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toLocalDate(b).getTime() - toLocalDate(a).getTime()) / 86_400_000);
}
