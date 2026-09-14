// Note REST routes (PLAN.md "Routes" — Notes). Thin: all logic lives in
// services/notes.ts. List and search share one route (`GET /?q=`) since
// they return the same `IndexedNote[]` shape — unlike tasks' separate
// `/open` and `/search`, there's no second distinct aggregate shape here to
// justify a second path.

import { Router } from 'express';

import * as noteService from '../services/notes.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const notes = q ? noteService.searchNotes(workspace.path, q) : noteService.listNotes(workspace.path);
    res.json({ notes });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { title, tags, body } = req.body ?? {};
    const note = noteService.createNote(workspace.path, { title, tags, body }, 'api');
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    res.json({ note: noteService.getNote(workspace.path, req.params.slug) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { title, tags, body } = req.body ?? {};
    const note = noteService.updateNote(workspace.path, req.params.slug, { title, tags, body }, 'api');
    res.json({ note });
  } catch (err) {
    next(err);
  }
});

router.delete('/:slug', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    noteService.deleteNote(workspace.path, req.params.slug, 'api');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
