import { app } from 'electron';

/**
 * Thin wrapper over Electron's own login-item API. Self-contained — the
 * fuller "on by default for a new install, persisted in `~/.pivot/config.json`"
 * behavior and the Settings UI toggle are milestone 17; this module has no
 * dependency on anything not yet built.
 */
export function getLaunchAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

export function setLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
}
