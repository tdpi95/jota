import { contextBridge, ipcRenderer } from 'electron';

// contextIsolation is on and nodeIntegration is off (see main.ts) — this is
// the only thing the renderer gets beyond plain HTTP to the embedded server
// (PLAN.md "Desktop shell"): the native folder picker plus login-item and
// reminder-setting bridges, none of which a browser tab could provide.
//
// getReminderSettings/setReminderSettings are declared here per the preload
// contract but have no main-process handler yet — their backing data model
// (per-workspace `reminderTime`) lands with the scheduler in milestone 17.
export interface ReminderSettings {
  enabled: boolean;
  /** 24h "HH:MM" local time, or null when disabled. */
  time: string | null;
}

export interface PocoBridge {
  pickFolder: () => Promise<string | null>;
  getLaunchAtLogin: () => Promise<boolean>;
  setLaunchAtLogin: (enabled: boolean) => Promise<void>;
  getReminderSettings: () => Promise<ReminderSettings>;
  setReminderSettings: (settings: ReminderSettings) => Promise<void>;
  /** Opens `path` in the OS's default file manager (Finder/Explorer/Nautilus).
   * Resolves `true` on success, `false` if the OS reported an error (e.g. the
   * folder was moved/deleted since it was registered) — never rejects. */
  openWorkspaceFolder: (path: string) => Promise<boolean>;
  /** `false` on macOS/Windows and in dev — only a packaged Linux AppImage
   * has anything for `setDesktopEntryInstalled` to point at (see
   * electron/src/desktopEntry.ts). Settings hides the whole control rather
   * than show one that would just throw when this is `false`. */
  canCreateDesktopEntry: () => Promise<boolean>;
  isDesktopEntryInstalled: () => Promise<boolean>;
  /** Adds or removes the `~/.local/share/applications` entry + icon.
   * Rejects if `canCreateDesktopEntry()` is `false`. */
  setDesktopEntryInstalled: (enabled: boolean) => Promise<void>;
}

const pocoBridge: PocoBridge = {
  pickFolder: () => ipcRenderer.invoke('poco:pick-folder'),
  getLaunchAtLogin: () => ipcRenderer.invoke('poco:get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('poco:set-launch-at-login', enabled),
  getReminderSettings: () => ipcRenderer.invoke('poco:get-reminder-settings'),
  setReminderSettings: (settings) => ipcRenderer.invoke('poco:set-reminder-settings', settings),
  openWorkspaceFolder: (path) => ipcRenderer.invoke('poco:open-workspace-folder', path),
  canCreateDesktopEntry: () => ipcRenderer.invoke('poco:can-create-desktop-entry'),
  isDesktopEntryInstalled: () => ipcRenderer.invoke('poco:is-desktop-entry-installed'),
  setDesktopEntryInstalled: (enabled) => ipcRenderer.invoke('poco:set-desktop-entry-installed', enabled),
};

contextBridge.exposeInMainWorld('poco', pocoBridge);
