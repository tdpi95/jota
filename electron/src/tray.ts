import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

export interface TrayCallbacks {
  onOpen: () => void;
  /** Shows/focuses the window and navigates it to `/settings` — lets the
   * user reach the reminder-time/launch-at-login fields without the window
   * already being open (PLAN.md project scaffold: `tray.ts` — "tray icon +
   * menu (Open, Settings, Quit)"). */
  onSettings: () => void;
  onQuit: () => void;
}

/**
 * Tray icon + menu: reopen the window after a close-to-hide, jump straight
 * to Settings, or quit for real (PLAN.md "Desktop shell" — "closing the
 * window hides it... the tray menu's 'Quit' is the only real quit path").
 * The app staying alive here (rather than actually quitting on window
 * close) is what makes the reminder scheduler (milestone 17) reliable even
 * on a day the user never opens the window at all.
 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  const tray = new Tray(icon);
  tray.setToolTip('Pivot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Pivot', click: callbacks.onOpen },
      { label: 'Settings', click: callbacks.onSettings },
      { type: 'separator' },
      { label: 'Quit', click: callbacks.onQuit },
    ]),
  );
  tray.on('click', callbacks.onOpen);
  return tray;
}
