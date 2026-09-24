// "Add to applications menu" (Settings, Linux only): an AppImage is a
// single portable file — unlike a macOS .app dragged into /Applications or
// a Windows installer, launching it does *not* register anything with the
// desktop environment, so it never shows up in an app launcher/menu on its
// own (a well-known AppImage rough edge, not specific to this app). This
// module writes/removes the one `.desktop` file + icon that closes that
// gap, following the same freedesktop.org locations (`~/.local/share/...`)
// any other well-behaved Linux app installer would use — no root, no
// system-wide install, fully undoable by the same toggle.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ID = 'jota';

function applicationsDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'applications');
}

function iconThemeDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor');
}

function iconFilePath(): string {
  return path.join(iconThemeDir(), '512x512', 'apps', `${APP_ID}.png`);
}

function desktopFilePath(): string {
  return path.join(applicationsDir(), `${APP_ID}.desktop`);
}

/**
 * Only meaningful for a packaged Linux AppImage: `APPIMAGE` is an env var
 * the AppImage runtime itself sets (to the mounted `.AppImage` file's own
 * absolute path) on every launch — exactly what a `.desktop` entry's `Exec=`
 * needs to point at, and unavailable any other way (there's no fixed
 * install location to hardcode; the user can rename/move the file freely).
 * Not offered in dev (nothing to point at) or on macOS/Windows, which each
 * already get a real Start Menu/Dock entry from their own native installer
 * instead of needing this.
 */
export function canCreateDesktopEntry(): boolean {
  return process.platform === 'linux' && !!process.env.APPIMAGE;
}

export function isDesktopEntryInstalled(): boolean {
  return fs.existsSync(desktopFilePath());
}

// Best-effort only: most desktop environments notice a new/removed
// ~/.local/share/applications entry on their own (inotify-watched), but
// running these where available closes the gap on the ones that don't.
// Silently ignored when the tool isn't installed — the .desktop file/icon
// are already correctly in place either way, this is purely about how
// soon the change is *noticed*.
function refreshDesktopCaches(): void {
  for (const [cmd, args] of [
    ['update-desktop-database', [applicationsDir()]],
    ['gtk-update-icon-cache', ['-f', '-t', iconThemeDir()]],
  ] as const) {
    try {
      spawnSync(cmd, args, { stdio: 'ignore' });
    } catch {
      // Tool not installed on this system — nothing more to do.
    }
  }
}

// Quoted only if it needs it (spaces, etc.) — same rule electron-builder's
// own generated .desktop entries use for Exec= (confirmed by inspecting a
// built AppImage's bundled entry), per the freedesktop Exec key spec.
function quoteExecArg(value: string): string {
  return /^[/0-9A-Za-z._-]+$/.test(value) ? value : `"${value}"`;
}

/**
 * Writes `~/.local/share/applications/jota.desktop` (pointing `Exec=` at
 * this *running* AppImage's own path) and copies `iconSourcePath` into the
 * standard hicolor icon theme location, so both show up correctly in an
 * application menu. `iconSourcePath` is passed in rather than located here
 * — main.ts already knows exactly where the packaged icon lives (the same
 * PNG the `BrowserWindow` itself uses).
 */
export function createDesktopEntry(iconSourcePath: string): void {
  if (!canCreateDesktopEntry()) {
    throw new Error('Adding a desktop entry is only supported when running from a Linux AppImage.');
  }
  const appImagePath = process.env.APPIMAGE!;

  fs.mkdirSync(applicationsDir(), { recursive: true });
  fs.mkdirSync(path.dirname(iconFilePath()), { recursive: true });
  fs.copyFileSync(iconSourcePath, iconFilePath());

  // Exec deliberately does *not* hardcode --no-sandbox: launching the
  // .AppImage file directly (rather than an already-extracted AppRun)
  // re-runs the AppImage runtime's own startup, which already probes
  // whether it needs that flag and adds it itself when it does.
  const contents = [
    '[Desktop Entry]',
    'Name=Jota',
    `Exec=${quoteExecArg(appImagePath)} %U`,
    `Icon=${APP_ID}`,
    'Terminal=false',
    'Type=Application',
    'Categories=Office;',
    `StartupWMClass=${APP_ID}`,
    '',
  ].join('\n');
  fs.writeFileSync(desktopFilePath(), contents, { mode: 0o644 });

  refreshDesktopCaches();
}

/** Removes exactly what `createDesktopEntry` added — a no-op (not an
 * error) if it's already gone, so toggling off twice or uninstalling an
 * already-uninstalled entry both behave the same. */
export function removeDesktopEntry(): void {
  fs.rmSync(desktopFilePath(), { force: true });
  fs.rmSync(iconFilePath(), { force: true });
  refreshDesktopCaches();
}
