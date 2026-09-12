// Environment/capability checks that aren't scoped to any workspace —
// "is this machine set up correctly to run poco" rather than vault
// content. Backs Settings' "git not found" notice and its MCP setup
// instructions (both new, requested directly rather than in PLAN.md's
// original milestone list — see PROGRESS.md's milestone 18 notes).

import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isGitAvailable } from '../lib/vaultGit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file lives at server/src/routes/system.ts, so the MCP entrypoint is
// always one level up and over — resolved from this file's own location
// (not process.cwd()) so it's correct no matter where the server process
// was launched from (repo root, server/, or a packaged app).
const mcpEntryPath = path.resolve(__dirname, '..', 'mcp', 'index.ts');

const router = Router();

router.get('/git-available', (_req, res) => {
  res.json({ available: isGitAvailable() });
});

// Absolute path to this app's own standalone MCP server entrypoint — used
// by Settings' "Agent access" section to build copy-pasteable config
// snippets for MCP hosts (Claude Desktop, Codex, etc.) without the user
// having to hunt down the path themselves.
router.get('/mcp-info', (_req, res) => {
  res.json({ entryPath: mcpEntryPath });
});

export default router;
