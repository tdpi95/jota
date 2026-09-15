// Project REST routes (PLAN.md "Routes" — Projects). Thin: all logic lives
// in services/projects.ts.

import { Router } from 'express';

import * as projectService from '../services/projects.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/', (_req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ projects: projectService.listProjects(workspace.path) });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { name, description, group, color } = req.body ?? {};
    const project = projectService.createProject(workspace.path, { name, description, group, color }, 'api');
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ project: projectService.getProject(workspace.path, req.params.slug) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { name, description, group, color, archived } = req.body ?? {};
    const project = projectService.updateProject(
      workspace.path,
      req.params.slug,
      { name, description, group, color, archived },
      'api',
    );
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

router.delete('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    projectService.deleteProject(workspace.path, req.params.slug, 'api');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
