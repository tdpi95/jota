// Task REST routes (PLAN.md "Routes" — Tasks). Mounted at
// /api/projects/:slug/tasks with mergeParams so :slug from the parent mount
// path is visible here. Thin: all logic lives in services/tasks.ts.

import { Router } from 'express';

import * as taskService from '../services/tasks.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router({ mergeParams: true });

router.post<{ slug: string }>('/', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { text, due, tags, description } = req.body ?? {};
    const task = taskService.createTask(workspace.path, req.params.slug, { text, due, tags, description }, 'api');
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

router.patch<{ slug: string; taskId: string }>('/:taskId', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { text, description, due, tags, status } = req.body ?? {};
    const task = taskService.updateTask(
      workspace.path,
      req.params.slug,
      req.params.taskId,
      { text, description, due, tags, status },
      'api',
    );
    res.json({ task });
  } catch (err) {
    next(err);
  }
});

router.delete<{ slug: string; taskId: string }>('/:taskId', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    taskService.deleteTask(workspace.path, req.params.slug, req.params.taskId, 'api');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
