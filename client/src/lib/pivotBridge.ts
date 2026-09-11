// Typed accessor for the `window.pivot` bridge `electron/src/preload.ts`
// exposes via `contextBridge` (PLAN.md "Desktop shell"). Duplicated by hand
// rather than imported — `electron/` is a separate npm workspace/tsconfig
// from `client/`, same reasoning as `client/src/types.ts` duplicating
// server types.
//
// This bridge only exists inside the Electron shell; `window.pivot` is
// `undefined` when the client is opened as a plain page (e.g. hitting the
// Vite dev server directly in a browser for a quick check) — every caller
// must go through `getPivotBridge()` and handle `null` rather than assuming
// `window.pivot` is always there.

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

declare global {
  interface Window {
    pivot?: PivotBridge;
  }
}

/** `null` outside the Electron shell (or if the preload script hasn't run
 * yet) — every caller must handle that case rather than assume it's there. */
export function getPivotBridge(): PivotBridge | null {
  return typeof window !== 'undefined' && window.pivot ? window.pivot : null;
}
