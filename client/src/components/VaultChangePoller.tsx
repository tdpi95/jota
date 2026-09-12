import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import * as api from '../api/client';

const POLL_INTERVAL_MS = 4000;

/**
 * Auto-refreshes the UI after a vault change made outside the client's own
 * mutations — most notably an MCP agent (a separate process, decoupled from
 * whichever workspace the app has open per PLAN.md's MCP section) writing
 * to the same workspace, but equally a hand-edit followed by a commit or a
 * `git pull`. Renders nothing; mounted once in `AppShell` so it's alive for
 * every routed page.
 *
 * Every write, from either front door, is a commit (PLAN.md "Backup &
 * recovery"), so the workspace's current commit hash is a cheap, reliable
 * "did anything change?" signal — no filesystem watcher needed. Polls
 * `GET /api/vault/head` on an interval and, when the hash differs from the
 * last one seen, invalidates the entire query cache (the same
 * "something changed, re-fetch everything" pattern `WorkspaceSwitcher`
 * already uses for a workspace switch — cheap enough against a personal,
 * local vault not to bother picking specific keys).
 */
export default function VaultChangePoller() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['vault', 'head'],
    queryFn: api.getVaultHead,
    refetchInterval: POLL_INTERVAL_MS,
    // A stale cached hash is meaningless here — every poll must hit the
    // server, never answer from cache.
    staleTime: 0,
  });

  // `undefined` until the first poll resolves; `null` on the very first
  // resolved value, so the initial hash is only ever recorded, never
  // treated as "changed" against nothing.
  const lastHash = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (data === undefined) return;
    const hash = data.hash;
    if (lastHash.current !== undefined && lastHash.current !== hash) {
      // Don't re-invalidate the head query itself in the same sweep — it
      // already has the fresh value that triggered this.
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'vault' || query.queryKey[1] !== 'head' });
    }
    lastHash.current = hash;
  }, [data, queryClient]);

  return null;
}
