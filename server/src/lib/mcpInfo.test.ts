import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { APPIMAGE_MCP_SERVER_FLAG, getMcpLaunchInfo } from './mcpInfo.js';

// Mirrors the three real shapes the Express server actually runs in: this
// module's own `.ts` source (dev, via tsx), its compiled `.js` sibling (a
// plain `node dist/index.js` production run), and a packaged Linux
// AppImage (`$APPIMAGE` set — milestone 18 part 19, fixing the ephemeral
// mount-path bug part 15's fix still had). No fs/child_process needed: the
// function under test only ever looks at the URL string and env object
// it's given.

test('a .ts caller URL (dev) resolves a .ts entrypoint launched via npx tsx', () => {
  const info = getMcpLaunchInfo('file:///repo/server/src/routes/system.ts', {});

  assert.equal(info.command, 'npx');
  assert.deepEqual(info.args, ['tsx', path.resolve('/repo/server/src/mcp/index.ts')]);
});

test('a .js caller URL (compiled, no $APPIMAGE — a plain prod run) resolves a .js entrypoint launched via plain node', () => {
  const info = getMcpLaunchInfo('file:///repo/server/dist/routes/system.js', {});

  assert.equal(info.command, 'node');
  assert.deepEqual(info.args, [path.resolve('/repo/server/dist/mcp/index.js')]);
});

test('$APPIMAGE set (packaged AppImage) ignores the ephemeral resourcesPath entirely and points at the stable AppImage file instead', () => {
  const info = getMcpLaunchInfo('file:///tmp/.mount_Poco1a2b3c/resources/server/dist/routes/system.js', {
    APPIMAGE: '/home/user/Applications/Poco-1.0.0.AppImage',
  });

  assert.equal(info.command, '/home/user/Applications/Poco-1.0.0.AppImage');
  assert.deepEqual(info.args, [APPIMAGE_MCP_SERVER_FLAG]);
  assert.equal(info.env, undefined);
});

test('$APPIMAGE takes priority even over a .ts caller URL — the AppImage case can never actually be dev, but the check is env-first regardless', () => {
  const info = getMcpLaunchInfo('file:///repo/server/src/routes/system.ts', { APPIMAGE: '/opt/Poco.AppImage' });

  assert.equal(info.command, '/opt/Poco.AppImage');
  assert.deepEqual(info.args, [APPIMAGE_MCP_SERVER_FLAG]);
});

// Milestone 18 part 20: launching the AppImage always boots Electron's
// native layer first (even for this headless relaunch flag), which
// segfaults without a real display/session-bus connection — and some MCP
// hosts (observed: Claude Desktop on Linux) spawn child processes with a
// stripped env that drops both even on a machine that has them. So the
// AppImage branch carries $DISPLAY/$DBUS_SESSION_BUS_ADDRESS along in its
// own `env`, read from this embedded server's *own* environment (it was
// launched by the real, currently-running Electron app).

test('$APPIMAGE with both $DISPLAY and $DBUS_SESSION_BUS_ADDRESS set carries both along in env', () => {
  const info = getMcpLaunchInfo('file:///tmp/.mount_Poco1a2b3c/resources/server/dist/routes/system.js', {
    APPIMAGE: '/home/user/Applications/Poco-1.0.0.AppImage',
    DISPLAY: ':0',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  });

  assert.deepEqual(info.env, { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' });
});

test('$APPIMAGE with only $DISPLAY set (no dbus session) carries just that one along, not a literal "undefined"', () => {
  const info = getMcpLaunchInfo('file:///tmp/.mount_Poco1a2b3c/resources/server/dist/routes/system.js', {
    APPIMAGE: '/home/user/Applications/Poco-1.0.0.AppImage',
    DISPLAY: ':1',
  });

  assert.deepEqual(info.env, { DISPLAY: ':1' });
});

test('$APPIMAGE with neither set (e.g. an all-Wayland session with no X display env) omits env entirely', () => {
  const info = getMcpLaunchInfo('file:///tmp/.mount_Poco1a2b3c/resources/server/dist/routes/system.js', {
    APPIMAGE: '/home/user/Applications/Poco-1.0.0.AppImage',
  });

  assert.equal(info.env, undefined);
});
