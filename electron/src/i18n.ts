// Small, hand-rolled dictionary for the handful of native-OS strings the
// Electron main process itself renders (tray menu, tray tooltip, the daily-
// reminder notification) — PLAN.md "Localization": these aren't part of the
// React client bundle (which uses react-i18next, `client/src/i18n/`) and
// don't need a full i18n library for four strings.
//
// The app-wide language preference lives in `~/.jota/config.json`
// (`services/workspaces.ts`'s `getLanguagePreference`/`setLanguagePreference`,
// exposed over HTTP as `GET/PUT /api/preferences/language`) and is polled
// from here the same way `reminder.ts` already polls the active workspace's
// reminder fields — no preload/IPC bridge needed, since nothing here touches
// an OS-level API the way launch-at-login does.

export type Lang = 'en' | 'vi';

export interface TrayStrings {
  tooltip: string;
  open: string;
  settings: string;
  quit: string;
}

export interface ReminderStrings {
  title: string;
  body: string;
}

const DICT: Record<Lang, TrayStrings & ReminderStrings> = {
  en: {
    tooltip: 'Jota',
    open: 'Open Jota',
    settings: 'Settings',
    quit: 'Quit',
    title: 'Time to journal',
    body: "You haven't written today's entry yet",
  },
  vi: {
    tooltip: 'Jota',
    open: 'Mở Jota',
    settings: 'Cài đặt',
    quit: 'Thoát',
    title: 'Đến giờ viết nhật ký',
    body: 'Bạn chưa viết nhật ký cho hôm nay',
  },
};

export function trayStrings(lang: Lang): TrayStrings {
  return DICT[lang];
}

export function reminderStrings(lang: Lang): ReminderStrings {
  return DICT[lang];
}

/** Normalizes anything unexpected (a fetch failure, an older/foreign value)
 * to 'en' rather than letting an invalid language wedge the tray/notifier. */
export function asLang(value: unknown): Lang {
  return value === 'vi' ? 'vi' : 'en';
}
