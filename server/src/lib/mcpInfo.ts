// How to launch this app's own standalone MCP server entrypoint (PLAN.md
// "Agent access via MCP"), for Settings' "Agent access (MCP)" self-serve
// config snippets (milestone 18) — a single computation shared by that one
// route so the client never has to guess a command itself.
//
// The Express server (this code included) runs in three shapes:
//
// 1. Straight from TypeScript source via `tsx` in dev (`npm run dev`/`npm
//    run dev -w server`) — `npx tsx <path-to-mcp/index.ts>`.
// 2. Compiled to plain JS, at a *stable* path — a local production run
//    (`node dist/index.js`) — `node <path-to-mcp/index.js>`.
// 3. Compiled to plain JS, but inside a packaged Linux AppImage, where
//    that path is *not* stable — an AppImage mounts its own squashfs at a
//    fresh, randomly-named `/tmp/.mount_...` directory on every single
//    launch, so `resourcesPath` (and anything resolved from it, including
//    the MCP entrypoint's own absolute path) is different every time the
//    app restarts. A command an MCP host saved once — most hosts read
//    their config once and reuse it indefinitely — would silently start
//    pointing at a directory that no longer exists after the very next
//    restart. `$APPIMAGE`, in contrast, is set by the AppImage runtime to
//    the mounted `.AppImage` *file's own* path, which the user chose and
//    which stays put across restarts — so case 3 instead generates a
//    command that re-invokes the AppImage itself with a special flag
//    (`electron/src/main.ts` recognizes this and, before doing anything
//    else — no window, no tray, no single-instance lock — resolves *that*
//    invocation's own fresh `resourcesPath` and spawns the real MCP
//    entrypoint from it, then exits when it does). The ephemeral path
//    still exists and is still used — just resolved fresh on every
//    invocation instead of being baked into a saved config.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recognized by `electron/src/main.ts` as "run as the MCP server, not the
 * GUI app" — kept in sync by hand with that file's own copy of this exact
 * string (separate npm workspaces, no shared import between them, same as
 * every other main-process/preload constant in this codebase). */
export const APPIMAGE_MCP_SERVER_FLAG = '--jota-mcp-server';

export interface McpLaunchInfo {
  /** The executable an MCP host should invoke. */
  command: string;
  /** Complete args for `command` — already includes the entrypoint path
   * (or, for the AppImage case, just the relaunch flag) where relevant, so
   * callers never need to append anything else. */
  args: string[];
  /** Extra env vars (beyond `JOTA_WORKSPACE`, which callers already add
   * themselves from the active workspace) the launched command actually
   * needs to start reliably. Only the AppImage case populates this today —
   * see below — every other shape is a plain Node process with nothing
   * extra to add. */
  env?: Record<string, string>;
}

/**
 * Derives `McpLaunchInfo` from a module's own `import.meta.url` — takes it
 * as a parameter (rather than reading `import.meta.url` internally) so
 * this is testable against fabricated `.ts`/`.js`/AppImage-shaped URLs
 * without actually running from three different builds. `env` defaults to
 * `process.env` but is likewise injectable for the same reason.
 */
export function getMcpLaunchInfo(callerModuleUrl: string, env: NodeJS.ProcessEnv = process.env): McpLaunchInfo {
  const appImagePath = env.APPIMAGE;
  if (appImagePath) {
    return { command: appImagePath, args: [APPIMAGE_MCP_SERVER_FLAG], env: appImageDisplayEnv(env) };
  }

  const callerDir = path.dirname(fileURLToPath(callerModuleUrl));
  const isCompiled = callerModuleUrl.endsWith('.js');
  const entryPath = path.resolve(callerDir, '..', 'mcp', isCompiled ? 'index.js' : 'index.ts');
  return isCompiled ? { command: 'node', args: [entryPath] } : { command: 'npx', args: ['tsx', entryPath] };
}

// The AppImage case (only) re-invokes this app's own Electron binary
// (`--jota-mcp-server`, above) rather than a plain Node script — and
// launching Electron normally always boots its native Chromium layer
// first, *before* main.ts's own JS even gets to check that flag, no matter
// how short-lived or window-less that particular invocation turns out to
// be. That native init needs a real display/session-bus connection to
// complete; without one it doesn't just skip GUI setup, it segfaults
// outright (confirmed live: `Missing X server or $DISPLAY` →
// `aura/env.cc: The platform failed to initialize. Exiting.`, then a
// crash) rather than falling back to headless. Several MCP hosts spawn
// child processes with a stripped environment that drops exactly these
// two vars even when running on a machine that has a perfectly good
// display (observed with Claude Desktop on Linux) — so the self-serve
// snippet carries them along explicitly rather than assuming the host
// will pass through whatever this server process itself was started
// with. `DISPLAY`/`DBUS_SESSION_BUS_ADDRESS` are read from *this* embedded
// server's own env (it was launched by the real, currently-running
// Electron app, which by definition already has a working display session
// right now) and only included if actually present — an all-Wayland
// session with no `DISPLAY`, or one without a user dbus session, still
// generates a usable snippet rather than one with a literal `"undefined"`
// string baked in.
function appImageDisplayEnv(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (env.DISPLAY) extra.DISPLAY = env.DISPLAY;
  if (env.DBUS_SESSION_BUS_ADDRESS) extra.DBUS_SESSION_BUS_ADDRESS = env.DBUS_SESSION_BUS_ADDRESS;
  return Object.keys(extra).length > 0 ? extra : undefined;
}
