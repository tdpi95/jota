import { Notification } from 'electron';

import { asLang, type Lang, reminderStrings } from './i18n';

// The daily-reminder scheduler (PLAN.md "Daily reminder"): a main-process
// interval, checked once a minute, comparing local wall-clock time against
// the active workspace's `reminderTime`. All wall-clock/local-date logic
// lives here, on purpose — the embedded server treats `reminderTime` and
// `lastReminderFiredDate` as opaque data it stores and returns, never
// computing "today" itself (see server/src/services/workspaces.ts), so
// there's no risk of the server's process (which could in principle run in
// a different TZ, though it never does here) disagreeing with the user's
// actual local clock about what day or time it is.

const CHECK_INTERVAL_MS = 60_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM", local. */
function localTimeOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD", local — same convention as the client's own `todayStr()`
 * (client/src/lib/date.ts), not a UTC parse. */
function localDateOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface ActiveWorkspaceReminderFields {
  reminderTime?: string | null;
  lastReminderFiredDate?: string | null;
}

export interface ReminderSchedulerOptions {
  /** The embedded server's current port, or `null` if it isn't up yet
   * (e.g. mid-restart) — a tick is quietly skipped rather than throwing. */
  getServerPort: () => number | null;
  /** Shows/focuses the window and navigates it to `/journal` — the
   * notification's click handler (PLAN.md: "clicking the notification
   * shows/focuses the window and navigates to /journal"). */
  onNotificationClick: () => void;
  /** Called whenever a tick observes the app-wide language preference
   * (PLAN.md "Localization") differing from what the previous tick saw —
   * lets `main.ts` rebuild the tray menu without polling for that
   * separately. Not called on the very first tick's initial read, only on
   * an actual change thereafter. */
  onLanguageChange?: (lang: Lang) => void;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Server not reachable this tick (starting up, restarting, whatever) —
    // never let a network hiccup crash the scheduler or spam an error for
    // something that'll just resolve itself on the next tick a minute later.
    return null;
  }
}

async function checkOnce(port: number, onNotificationClick: () => void, language: Lang): Promise<void> {
  const base = `http://127.0.0.1:${port}/api`;

  const workspaceRes = await fetchJson<{ workspace: ActiveWorkspaceReminderFields | null }>(`${base}/workspaces/active`);
  const workspace = workspaceRes?.workspace;
  if (!workspace) return; // no active workspace — nothing to remind about

  // `undefined` (an entry written before this field existed) means the
  // same default a newly-added workspace gets, per
  // services/workspaces.ts's own `getReminderSettings` — mirrored here
  // rather than trusting the raw field, since this reads the plain
  // workspace entry, not the normalized reminder-settings endpoint.
  const reminderTime = workspace.reminderTime === undefined ? '20:00' : workspace.reminderTime;
  if (reminderTime === null) return; // disabled for this workspace

  const now = new Date();
  const today = localDateOf(now);

  // ">=", not "===": PLAN.md's own reasoning for `lastReminderFiredDate`
  // being day-granularity ("prevents refiring... after waking from sleep
  // past the time") only makes sense if reaching-or-passing the time is
  // what triggers a fire, not landing on the exact matching minute — a
  // laptop asleep through 20:00 and waking at 20:30 should still get
  // reminded once it wakes, not silently miss the day entirely.
  if (localTimeOf(now) < reminderTime) return; // not yet time today
  if (workspace.lastReminderFiredDate === today) return; // already handled today

  const year = today.slice(0, 4);
  const entryRes = await fetchJson<{ entry: { body: string } }>(`${base}/journal/${year}/${today}`);
  if (!entryRes) return; // couldn't check — try again next tick rather than fire blind
  if (entryRes.entry.body.trim() !== '') return; // already journaled today — a smart no-op, not a nag

  const strings = reminderStrings(language);
  new Notification({ title: strings.title, body: strings.body }).on('click', onNotificationClick).show();

  // Recorded only on an actual fire (never on a skip above) so a plain
  // "haven't checked yet today" state keeps re-checking every tick until
  // either it fires or the day rolls over.
  await fetchJson(`${base}/workspaces/active/reminder/fired`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today }),
  });
}

/** Starts the once-a-minute check; returns a function that stops it. */
export function startReminderScheduler(opts: ReminderSchedulerOptions): () => void {
  // `undefined` until the first tick's read — deliberately distinct from
  // any real Lang value, so that first read never itself counts as a
  // "change" (see `onLanguageChange`'s own doc comment above).
  let lastLanguage: Lang | undefined;

  const timer = setInterval(() => {
    const port = opts.getServerPort();
    if (port === null) return;
    (async () => {
      // Polled every tick regardless of the reminder logic's own early
      // returns below (no active workspace, already journaled today, etc.)
      // — the language preference is app-wide, not tied to having an
      // active workspace, and the tray menu (via onLanguageChange) should
      // stay in sync even on a tick that fires no notification at all.
      const prefRes = await fetchJson<{ language: string }>(`http://127.0.0.1:${port}/api/preferences/language`);
      const language = asLang(prefRes?.language);
      if (lastLanguage !== undefined && language !== lastLanguage) opts.onLanguageChange?.(language);
      lastLanguage = language;

      await checkOnce(port, opts.onNotificationClick, language);
    })().catch((err) => {
      console.error('[reminder] check failed:', err);
    });
  }, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
