// Cross-type full-text search route (PLAN.md "Search (cross-type
// full-text)", milestone 25). Thin: all logic lives in services/search.ts.

import { Router } from 'express';

import * as searchService from '../services/search.js';
import * as workspaceService from '../services/workspaces.js';
import type { SearchContentType } from '../services/search.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const { q, from, to, types } = req.query;
    const results = searchService.searchEverything(workspace.path, {
      query: typeof q === 'string' ? q : '',
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
      types: typeof types === 'string' ? (types.split(',').filter(Boolean) as SearchContentType[]) : undefined,
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
