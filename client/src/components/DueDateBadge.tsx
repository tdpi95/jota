import { useTranslation } from 'react-i18next';

import { dueUrgency, formatDueShort } from '../lib/date';

/** Read-only badge showing a task's due date, colored by urgency (overdue /
 * today / later) — matches design/Main.dc.html's `.due-badge` variants.
 * Renders nothing if there's no due date (callers wrap with `hasDue` checks
 * where a placeholder is wanted instead, e.g. in an edit form). */
export default function DueDateBadge({ due }: { due: string | null }) {
  const { t, i18n } = useTranslation();
  if (!due) return null;
  const urgency = dueUrgency(due);
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const label =
    urgency === 'overdue'
      ? t('dueDateBadge.overdue', { date: formatDueShort(due, language) })
      : urgency === 'today'
        ? t('dueDateBadge.today')
        : formatDueShort(due, language);
  return <span className={`due-badge ${urgency}`}>{label}</span>;
}
