import { randomUUID } from 'node:crypto';

/**
 * Generates a stable task id in the `t_xxxxxx` form used by the task-line
 * grammar's `<!-- id:t_xxxxxx -->` comment (see PLAN.md's task examples,
 * e.g. `t_9f0e21`). Backed by crypto.randomUUID() — collision-safe at this
 * app's scale (one vault, one user).
 */
export function generateTaskId(): string {
  const hex = randomUUID().replace(/-/g, '');
  return `t_${hex.slice(0, 6)}`;
}
