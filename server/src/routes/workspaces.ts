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

// Daily reminder (PLAN.md milestone 17), scoped to the active workspace —
// `electron/src/main.ts`'s `window.pivot.getReminderSettings`/
// `setReminderSettings` IPC handlers proxy to these over HTTP rather than
// touching the registry file directly, keeping this the one process that
// ever writes `~/.pivot/config.json` (same reasoning as every other
// registry mutation going through this service).
router.get('/active/reminder', (_req, res, next) => {
  try {
    res.json(workspaceService.getReminderSettings());
  } catch (err) {
    next(err);
  }
});

router.put('/active/reminder', (req, res, next) => {
  try {
    const { enabled, time } = req.body ?? {};
    if (typeof enabled !== 'boolean' || (time !== null && typeof time !== 'string')) {
      res.status(400).json({ error: 'enabled (boolean) and time (string | null) are required' });
      return;
    }
    res.json(workspaceService.setReminderSettings({ enabled, time }));
  } catch (err) {
    next(err);
  }
});

// Marks today (the caller's local date — the scheduler's, not this
// process's UTC notion of "today") as already reminded, so a later tick
// the same day doesn't refire. Called by `electron/src/reminder.ts`
// immediately after it actually shows the notification.
router.post('/active/reminder/fired', (req, res, next) => {
  try {
    const { date } = req.body ?? {};
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
      return;
    }
    res.json({ lastReminderFiredDate: workspaceService.markReminderFired(date) });
  } catch (err) {
    next(err);
  }
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
