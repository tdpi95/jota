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

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

import { getFreePort } from './freePort';
import { getLaunchAtLogin, setLaunchAtLogin } from './loginItem';
import { createTray } from './tray';

const isDev = !app.isPackaged;
const DEV_SERVER_PORT = 4174;
const DEV_CLIENT_URL = 'http://localhost:5173';
const repoRoot = path.resolve(__dirname, '..', '..');

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let isQuitting = false;

// `detached: true` makes the child its own process-group leader on POSIX, so
// stopServer() below can kill the *whole* tree in one shot — tsx itself
// spawns a grandchild loader process, and killing only the immediate child
// would otherwise leak that grandchild as an orphaned server on quit.
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
      detached: true,
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
    detached: true,
  });
}

function stopServer(): void {
  if (!serverProcess?.pid) return;
  try {
    // Negative pid = kill the whole process group (POSIX only; Windows
    // packaging in milestone 18 will need `taskkill /pid <pid> /t /f` instead).
    process.kill(-serverProcess.pid, 'SIGTERM');
  } catch {
    serverProcess.kill();
  }
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

ipcMain.handle('pivot:pick-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('pivot:get-launch-at-login', () => getLaunchAtLogin());
ipcMain.handle('pivot:set-launch-at-login', (_event, enabled: boolean) => setLaunchAtLogin(enabled));

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  serverPort = isDev ? DEV_SERVER_PORT : await getFreePort();
  serverProcess = spawnServer(serverPort);
  await waitForServer(serverPort);

  await createWindow(serverPort);
  createTray({ onOpen: showMainWindow, onQuit: () => app.quit() });
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
  stopServer();
});
