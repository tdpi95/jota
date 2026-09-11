// REST routes for workspace management (PLAN.md "Routes" — Workspaces).
// Thin: all logic lives in services/workspaces.ts.

import { Router } from 'express';

import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ workspaces: workspaceService.listWorkspaces() });
});

router.get('/active', (_req, res) => {
  res.json({ workspace: workspaceService.getActiveWorkspace() });
});

router.post('/', (req, res, next) => {
  try {
    const { path: workspacePath, name } = req.body ?? {};
    if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const workspace = workspaceService.addWorkspace({ path: workspacePath, name });
    res.status(201).json({ workspace });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/open', (req, res, next) => {
  try {
    const workspace = workspaceService.openWorkspace(req.params.id);
    res.json({ workspace });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    workspaceService.removeWorkspace(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
