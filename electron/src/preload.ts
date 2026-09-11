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

export interface PivotBridge {
  pickFolder: () => Promise<string | null>;
  getLaunchAtLogin: () => Promise<boolean>;
  setLaunchAtLogin: (enabled: boolean) => Promise<void>;
  getReminderSettings: () => Promise<ReminderSettings>;
  setReminderSettings: (settings: ReminderSettings) => Promise<void>;
}

const pivotBridge: PivotBridge = {
  pickFolder: () => ipcRenderer.invoke('pivot:pick-folder'),
  getLaunchAtLogin: () => ipcRenderer.invoke('pivot:get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('pivot:set-launch-at-login', enabled),
  getReminderSettings: () => ipcRenderer.invoke('pivot:get-reminder-settings'),
  setReminderSettings: (settings) => ipcRenderer.invoke('pivot:set-reminder-settings', settings),
};

contextBridge.exposeInMainWorld('pivot', pivotBridge);
