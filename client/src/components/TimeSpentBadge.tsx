import { useEffect, useState } from 'react';

import { formatDuration, liveSpentMinutes } from '../lib/duration';

/**
 * Live-ticking time-spent display (PLAN.md "Doing-timer transition": "The
 * live 'N (tracking...)' value shown in the UI is computed client-side
 * ... ticking locally"). Re-renders once a minute while `doingSince` is set
 * so the badge actually advances without polling the server — the file's
 * `@spent` token itself never changes until a real status transition.
 * Renders nothing if there's nothing to show (not doing, and zero spent).
 */
export default function TimeSpentBadge({ spentMinutes, doingSince }: { spentMinutes: number; doingSince: string | null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!doingSince) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [doingSince]);

  const live = liveSpentMinutes(spentMinutes, doingSince, now);
  if (live <= 0) return null;

  return (
    <span className="spent-badge">
      {formatDuration(live)}
      {doingSince ? ' · tracking…' : ''}
    </span>
  );
}
