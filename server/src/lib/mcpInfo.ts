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
export const APPIMAGE_MCP_SERVER_FLAG = '--poco-mcp-server';

export interface McpLaunchInfo {
  /** The executable an MCP host should invoke. */
  command: string;
  /** Complete args for `command` — already includes the entrypoint path
   * (or, for the AppImage case, just the relaunch flag) where relevant, so
   * callers never need to append anything else. */
  args: string[];
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
    return { command: appImagePath, args: [APPIMAGE_MCP_SERVER_FLAG] };
  }

  const callerDir = path.dirname(fileURLToPath(callerModuleUrl));
  const isCompiled = callerModuleUrl.endsWith('.js');
  const entryPath = path.resolve(callerDir, '..', 'mcp', isCompiled ? 'index.js' : 'index.ts');
  return isCompiled ? { command: 'node', args: [entryPath] } : { command: 'npx', args: ['tsx', entryPath] };
}
