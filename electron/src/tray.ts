import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

import { type Lang, trayStrings } from './i18n';

export interface TrayCallbacks {
  onOpen: () => void;
  /** Shows/focuses the window and navigates it to `/settings` — lets the
   * user reach the reminder-time/launch-at-login fields without the window
   * already being open (PLAN.md project scaffold: `tray.ts` — "tray icon +
   * menu (Open, Settings, Quit)"). */
  onSettings: () => void;
  onQuit: () => void;
}

function buildMenu(callbacks: TrayCallbacks, language: Lang) {
  const s = trayStrings(language);
  return Menu.buildFromTemplate([
    { label: s.open, click: callbacks.onOpen },
    { label: s.settings, click: callbacks.onSettings },
    { type: 'separator' },
    { label: s.quit, click: callbacks.onQuit },
  ]);
}

/**
 * Tray icon + menu: reopen the window after a close-to-hide, jump straight
 * to Settings, or quit for real (PLAN.md "Desktop shell" — "closing the
 * window hides it... the tray menu's 'Quit' is the only real quit path").
 * The app staying alive here (rather than actually quitting on window
 * close) is what makes the reminder scheduler (milestone 17) reliable even
 * on a day the user never opens the window at all.
 *
 * `language` (PLAN.md "Localization") picks the initial menu/tooltip text;
 * pass the current value at startup and call `applyTrayLanguage` afterward
 * whenever the app-wide language preference changes so an already-running
 * tray updates without restarting the app.
 */
export function createTray(callbacks: TrayCallbacks, language: Lang): Tray {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  const tray = new Tray(icon);
  applyTrayLanguage(tray, callbacks, language);
  tray.on('click', callbacks.onOpen);
  return tray;
}

/** Rebuilds an already-created tray's tooltip + context menu in a new
 * language — the tray itself has no "language changed" signal of its own,
 * so the caller (electron/src/main.ts, via the reminder scheduler's
 * language-poll) decides when to call this. */
export function applyTrayLanguage(tray: Tray, callbacks: TrayCallbacks, language: Lang): void {
  tray.setToolTip(trayStrings(language).tooltip);
  tray.setContextMenu(buildMenu(callbacks, language));
}
