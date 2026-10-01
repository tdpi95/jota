// Wikilink routes (milestone 32). Thin: all logic lives in services/links.ts.

import { Router } from 'express';

import * as linksService from '../services/links.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/backlinks', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { kind, id } = req.query;
    res.json({ backlinks: linksService.getBacklinks(workspace.path, typeof kind === 'string' ? kind : '', typeof id === 'string' ? id : '') });
  } catch (err) {
    next(err);
  }
});

// POST rather than GET: a preview can have many targets, and the body keeps
// them out of the URL.
router.post('/resolve', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const targets: unknown = req.body?.targets;
    const list = Array.isArray(targets) ? targets.filter((t): t is string => typeof t === 'string') : [];
    res.json({ links: linksService.resolveLinks(workspace.path, list) });
  } catch (err) {
    next(err);
  }
});

export default router;
