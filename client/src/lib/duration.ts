// Client-side mirror of server/src/lib/markdown/taskLine.ts's `formatDuration`
// (compact "2h15m"/"45m"/"3h"/"1d2h15m" format — a day is a flat 24h), plus
// the live-elapsed math PLAN.md's
// "Doing-timer transition" section assigns to the frontend: "The live 'N
// (tracking...)' value shown in the UI is computed client-side (spentMinutes
// + elapsed-since-doingSince, ticking locally); the file's @spent token only
// updates on an actual status transition."

export function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return '';
  const d = Math.floor(totalMinutes / 1440);
  const rest = totalMinutes % 1440;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  return `${d > 0 ? `${d}d` : ''}${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}`;
}

/** Minutes elapsed since an ISO8601 timestamp, floored, never negative
 * (clock skew or a just-started timer could otherwise go slightly negative). */
export function minutesSince(isoTimestamp: string, now: Date = new Date()): number {
  const started = new Date(isoTimestamp).getTime();
  return Math.max(0, Math.floor((now.getTime() - started) / 60000));
}

/** Live total: the durable `spentMinutes` plus elapsed time in the current
 * doing-session, if any — this is what `TimeSpentBadge` ticks locally
 * without writing anything back to the file. */
export function liveSpentMinutes(spentMinutes: number, doingSince: string | null, now: Date = new Date()): number {
  return doingSince ? spentMinutes + minutesSince(doingSince, now) : spentMinutes;
}
