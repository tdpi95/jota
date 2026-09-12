// Typed accessor for the `window.poco` bridge `electron/src/preload.ts`
// exposes via `contextBridge` (PLAN.md "Desktop shell"). Duplicated by hand
// rather than imported — `electron/` is a separate npm workspace/tsconfig
// from `client/`, same reasoning as `client/src/types.ts` duplicating
// server types.
//
// This bridge only exists inside the Electron shell; `window.poco` is
// `undefined` when the client is opened as a plain page (e.g. hitting the
// Vite dev server directly in a browser for a quick check) — every caller
// must go through `getPocoBridge()` and handle `null` rather than assuming
// `window.poco` is always there.

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
}

declare global {
  interface Window {
    poco?: PocoBridge;
  }
}

/** `null` outside the Electron shell (or if the preload script hasn't run
 * yet) — every caller must handle that case rather than assume it's there. */
export function getPocoBridge(): PocoBridge | null {
  return typeof window !== 'undefined' && window.poco ? window.poco : null;
}
