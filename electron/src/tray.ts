import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

export interface TrayCallbacks {
  onOpen: () => void;
  onQuit: () => void;
}

/**
 * Minimal tray for milestone 3: just enough to reopen the window after a
 * close-to-hide, plus the one real quit path (PLAN.md "Desktop shell" —
 * "closing the window hides it... the tray menu's 'Quit' is the only real
 * quit path"). The reminder-specific menu items land in milestone 17.
 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  const tray = new Tray(icon);
  tray.setToolTip('Pivot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Pivot', click: callbacks.onOpen },
      { type: 'separator' },
      { label: 'Quit', click: callbacks.onQuit },
    ]),
  );
  tray.on('click', callbacks.onOpen);
  return tray;
}
