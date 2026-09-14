// Environment/capability checks that aren't scoped to any workspace —
// "is this machine set up correctly to run poco" rather than vault
// content. Backs Settings' "git not found" notice and its MCP setup
// instructions (both new, requested directly rather than in PLAN.md's
// original milestone list — see PROGRESS.md's milestone 18 notes).

import { Router } from 'express';

import { getMcpLaunchInfo } from '../lib/mcpInfo.js';
import { isGitAvailable } from '../lib/vaultGit.js';

const router = Router();

router.get('/git-available', (_req, res) => {
  res.json({ available: isGitAvailable() });
});

// How to launch this app's own standalone MCP server entrypoint — used by
// Settings' "Agent access" section to build copy-pasteable config snippets
// for MCP hosts (Claude Desktop, Codex, etc.) without the user having to
// hunt down a path or figure out the right command themselves. Resolved
// from *this* module's own `import.meta.url` (not process.cwd()) so it's
// correct no matter where the server process was launched from (repo
// root, server/, or a packaged app) — see lib/mcpInfo.ts.
router.get('/mcp-info', (_req, res) => {
  res.json(getMcpLaunchInfo(import.meta.url));
});

export default router;
