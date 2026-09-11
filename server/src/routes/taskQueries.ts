// Task aggregate/query routes (PLAN.md "Routes" — Aggregates: open tasks,
// search, journal-links). Mounted at /api/tasks — kept separate from
// routes/tasks.ts, which is mounted at /api/projects/:slug/tasks for
// project-scoped task CRUD, so the two path prefixes never collide. Both
// call into the same services/tasks.ts.

import { Router } from 'express';

import * as taskService from '../services/tasks.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/open', (_req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ tasks: taskService.listOpenTasks(workspace.path) });
  } catch (err) {
    next(err);
  }
});

router.get('/search', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ tasks: taskService.searchTasks(workspace.path, q) });
  } catch (err) {
    next(err);
  }
});

router.get('/:taskId/journal-links', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ dates: taskService.getJournalLinksForTask(workspace.path, req.params.taskId) });
  } catch (err) {
    next(err);
  }
});

export default router;
