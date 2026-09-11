import { dueUrgency, formatDueShort } from '../lib/date';

/** Read-only badge showing a task's due date, colored by urgency (overdue /
 * today / later) — matches design/Main.dc.html's `.due-badge` variants.
 * Renders nothing if there's no due date (callers wrap with `hasDue` checks
 * where a placeholder is wanted instead, e.g. in an edit form). */
export default function DueDateBadge({ due }: { due: string | null }) {
  if (!due) return null;
  const urgency = dueUrgency(due);
  const label = urgency === 'overdue' ? `Overdue · ${formatDueShort(due)}` : urgency === 'today' ? 'Today' : formatDueShort(due);
  return <span className={`due-badge ${urgency}`}>{label}</span>;
}
