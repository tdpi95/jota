// Electron main process. A thin wrap, not an IPC rewrite (PLAN.md "Desktop
// shell"): this spawns the existing Express server as its own process and
// points a BrowserWindow at it — the renderer keeps talking to `/api/...`
// over plain HTTP exactly as a browser tab would. Only the native folder
// picker and the login-item/reminder bridges (preload.ts) go through IPC.
//
// The server is spawned rather than imported in-process so it always runs
// under a real Node.js (>=22.5, for `node:sqlite` in milestone 4) regardless
// of which Node version a given Electron release bundles, and so this
// package's own TS project never needs to reach across into server/src.

import { app, BrowserWindow, dialog, ipcMain, type Tray } from 'electron';
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import treeKill from 'tree-kill';

import { getFreePort } from './freePort';
import { asLang, type Lang } from './i18n';
import { getLaunchAtLogin, setLaunchAtLogin } from './loginItem';
import { startReminderScheduler } from './reminder';
import { applyTrayLanguage, createTray, type TrayCallbacks } from './tray';

const isDev = !app.isPackaged;
const DEV_SERVER_PORT = 4174;
const DEV_CLIENT_URL = 'http://localhost:5173';
const repoRoot = path.resolve(__dirname, '..', '..');

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let isQuitting = false;
let stopReminderScheduler: (() => void) | null = null;
let tray: Tray | null = null;
let trayCallbacks: TrayCallbacks | null = null;

// Deliberately NOT `detached: true`: leaving the server in Electron's own
// process group means a raw Ctrl+C in the terminal running `npm run dev`
// (which sends SIGINT to the *whole foreground process group*) reaches it
// directly and it dies on its own — no orchestration required. A first
// attempt detached it so stopServer() could group-kill tsx's grandchild
// loader process, but that also removed it from the group a terminal
// Ctrl+C signals, so cleanup then depended on Electron's own JS-level
// app.quit() racing against its own Chromium helper processes receiving
// that same raw signal — unreliable, and it's exactly what caused `npm run
// dev` to hang on Ctrl+C instead of exiting. tree-kill (below) covers the
// *explicit* graceful-quit path (tray Quit, app.quit()) instead, by walking
// the process tree by PID rather than relying on process-group membership.
function spawnServer(port: number): ChildProcess {
  if (isDev) {
    // Same server, run straight from TS source via the hoisted tsx binary —
    // equivalent to `npm run dev -w server`, just with a fixed port so the
    // client's Vite dev-server proxy config can target it statically.
    const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
    return spawn(tsxBin, ['src/index.ts'], {
      cwd: path.join(repoRoot, 'server'),
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
    });
  }

  // Production: electron-builder packages server/dist alongside the app
  // (milestone 18 — not wired yet). Run it under Electron's own bundled
  // Node runtime (ELECTRON_RUN_AS_NODE) so no separate Node install is
  // required on the user's machine.
  const serverEntry = path.join(process.resourcesPath, 'server', 'dist', 'index.js');
  return spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
}

function stopServer(): void {
  if (!serverProcess?.pid) return;
  // tsx spawns its own grandchild loader process — killing only the
  // immediate child would leak that grandchild as an orphaned server, so
  // walk the whole tree by PID (works regardless of process-group
  // membership, unlike a plain `.kill()`).
  treeKill(serverProcess.pid, 'SIGTERM');
}

async function waitForServer(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`embedded server did not become ready on port ${port} within ${timeoutMs}ms`);
}

async function createWindow(port: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev: Vite's own dev server (proxying /api to the embedded server).
  // Prod: the embedded server's own URL, which also serves the built client.
  await mainWindow.loadURL(isDev ? DEV_CLIENT_URL : `http://127.0.0.1:${port}`);

  // Hide, don't quit, on close — the app stays alive via the tray so the
  // (milestone 17) reminder scheduler keeps running (PLAN.md "Desktop shell").
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Shows/focuses the window and navigates it to `path` — used by the tray's
 * "Settings" item and by the reminder notification's click handler
 * (PLAN.md: "clicking the notification shows/focuses the window and
 * navigates to /journal"). A full `loadURL` rather than an IPC
 * "navigate client-side" message: simpler, and `window.pivot` has no
 * navigation bridge in PLAN.md's own preload contract, so this reuses the
 * same URL-loading `createWindow` already does rather than inventing one. */
function navigateMainWindow(path: string): void {
  showMainWindow();
  if (!mainWindow || serverPort === null) return;
  const base = isDev ? DEV_CLIENT_URL : `http://127.0.0.1:${serverPort}`;
  void mainWindow.loadURL(`${base}${path}`);
}

/** PLAN.md "Localization": the app-wide language preference the client
 * sets directly via `PUT /api/preferences/language` (no IPC bridge needed
 * for that side — it's a plain preference, not an OS-level API). Read here
 * only for the native strings this process itself renders (tray, daily
 * reminder). Defaults to 'en' on any failure (server not up yet, etc.). */
async function fetchLanguage(port: number): Promise<Lang> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/preferences/language`);
    if (!res.ok) return 'en';
    const { language } = (await res.json()) as { language: unknown };
    return asLang(language);
  } catch {
    return 'en';
  }
}

ipcMain.handle('pivot:pick-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('pivot:get-launch-at-login', () => getLaunchAtLogin());
ipcMain.handle('pivot:set-launch-at-login', async (_event, enabled: boolean) => {
  setLaunchAtLogin(enabled);
  // Best-effort: also record the user's explicit choice in the registry, so
  // a later app start knows this was already decided and doesn't re-apply
  // the one-time "on by default" logic over it (see
  // `applyLaunchAtLoginDefaultIfUndecided` below). The OS-level toggle above
  // is what actually matters and has already happened regardless of whether
  // this succeeds.
  if (serverPort !== null) {
    try {
      await fetch(`http://127.0.0.1:${serverPort}/api/preferences/launch-at-login`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (err) {
      console.error('[main] failed to persist launch-at-login preference:', err);
    }
  }
});

/**
 * PLAN.md "Daily reminder": "Start-at-login is on by default". Applied
 * exactly once — if the registry's `launchAtLogin` preference has never
 * been explicitly set (a fresh install, or a registry written before this
 * field existed), turn it on and record that we did, so a later explicit
 * opt-out by the user is never silently re-forced back on at the next
 * app start.
 */
async function applyLaunchAtLoginDefaultIfUndecided(port: number): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/preferences/launch-at-login`);
    if (!res.ok) return;
    const { enabled } = (await res.json()) as { enabled: boolean | null };
    if (enabled !== null) return; // already decided, one way or the other — leave it alone

    setLaunchAtLogin(true);
    await fetch(`http://127.0.0.1:${port}/api/preferences/launch-at-login`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
  } catch (err) {
    console.error('[main] failed to apply launch-at-login default:', err);
  }
}

ipcMain.handle('pivot:get-reminder-settings', async () => {
  if (serverPort === null) throw new Error('embedded server is not ready yet');
  const res = await fetch(`http://127.0.0.1:${serverPort}/api/workspaces/active/reminder`);
  if (!res.ok) throw new Error(`failed to load reminder settings (${res.status})`);
  return res.json();
});

ipcMain.handle('pivot:set-reminder-settings', async (_event, settings: { enabled: boolean; time: string | null }) => {
  if (serverPort === null) throw new Error('embedded server is not ready yet');
  const res = await fetch(`http://127.0.0.1:${serverPort}/api/workspaces/active/reminder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`failed to save reminder settings (${res.status})`);
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  serverPort = isDev ? DEV_SERVER_PORT : await getFreePort();
  serverProcess = spawnServer(serverPort);
  await waitForServer(serverPort);

  await applyLaunchAtLoginDefaultIfUndecided(serverPort);

  await createWindow(serverPort);
  trayCallbacks = { onOpen: showMainWindow, onSettings: () => navigateMainWindow('/settings'), onQuit: () => app.quit() };
  tray = createTray(trayCallbacks, await fetchLanguage(serverPort));

  stopReminderScheduler = startReminderScheduler({
    getServerPort: () => serverPort,
    onNotificationClick: () => navigateMainWindow('/journal'),
    // The reminder scheduler already polls the language preference once a
    // minute for its own notification text — reuse that poll to keep the
    // tray in sync too, rather than a second independent poller.
    onLanguageChange: (lang) => {
      if (tray && trayCallbacks) applyTrayLanguage(tray, trayCallbacks, lang);
    },
  });
});

app.on('window-all-closed', () => {
  // Intentional no-op: the tray keeps the app running (see above) — only
  // the tray's Quit item calls app.quit().
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length > 0) {
    showMainWindow();
  } else if (serverPort !== null) {
    void createWindow(serverPort);
  }
});

app.on('will-quit', () => {
  stopReminderScheduler?.();
  stopServer();
});

// Best-effort: try to go through the normal quit lifecycle (hide window,
// stopServer()) if something sends SIGINT/SIGTERM to this process alone.
// Not load-bearing for the common case, though — a real terminal's Ctrl+C
// sends SIGINT to the *whole foreground process group*, which reaches the
// (non-detached) server subprocess directly regardless of whether this
// handler runs, and Electron's own JS-level signal handling isn't reliable
// enough to depend on here (its Chromium helper processes receive the same
// raw group signal independently, which can race ahead of this).
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
