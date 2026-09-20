import type { ProjectSummary } from '../types';

/** Most-recent-activity instant for a project — the latest of its own
 * creation date and every task's creation/completion. Not a stored field:
 * derived purely from data every consumer already has (PLAN.md doesn't track
 * a last-modified timestamp anywhere, and adding one just for this would
 * mean a write-path change for a read-only convenience). Shared by
 * DashboardPage's "Recent projects" sort and QuickAddTaskModal's default
 * project selection — both want "the project I was just working in".
 */
export function lastActivity(project: ProjectSummary): number {
  let latest = new Date(project.frontmatter.created).getTime();
  for (const task of project.tasks) {
    latest = Math.max(latest, new Date(task.created).getTime());
    if (task.doneAt) latest = Math.max(latest, new Date(task.doneAt).getTime());
  }
  return latest;
}
