// Cross-type full-text search service (PLAN.md "Search (cross-type
// full-text)", milestone 25) — the one implementation both routes/search.ts
// and mcp/tools.ts's `search_everything` call, per CLAUDE.md's "business
// logic lives in services/*.ts" convention. Doesn't belong inside any one of
// services/{tasks,notes,journal,projects}.ts since it crosses all four —
// same "aggregate queries get their own isolated module" precedent as
// lib/index/queries.ts itself (milestone 9).

import { queryFullTextSearch, type SearchContentType, type SearchResult } from '../lib/index/queries.js';

export type { SearchContentType, SearchResult } from '../lib/index/queries.js';

export interface SearchInput {
  query: string;
  from?: string;
  to?: string;
  types?: SearchContentType[];
}

/** `GET /api/search` and the `search_everything` MCP tool. Empty/whitespace-
 * only query returns no results rather than the whole vault, same
 * convention as `searchTasks`/`searchNotes`. */
export function searchEverything(workspacePath: string, input: SearchInput): SearchResult[] {
  const query = input.query?.trim();
  if (!query) return [];
  return queryFullTextSearch(workspacePath, { query, from: input.from, to: input.to, types: input.types });
}
